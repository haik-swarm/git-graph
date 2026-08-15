"""Pre-publish leak scan, and an LLM loop that fixes what it finds.

Publishing flips a private repo public, so anything tracked becomes
world-readable in one click. This scans what `git ls-files` would ship —
not the working tree — because a gitignored `.env` is never published and
flagging it would train the user to click past real findings.

Two passes, deliberately in this order:

  1. Regex, over every tracked file. Catches the shapes that are secrets
     by construction (an `sk-ant-` key, a PEM block, an AWS id). No model
     is involved, so this half can't hallucinate and can't be talked out
     of a finding by surrounding prose.
  2. The local router, over files the regexes flagged as *interesting*
     but not conclusive. Judgement calls — a hardcoded home directory, a
     personal email, a private URL — need a reader, not a pattern.

The fixer edits files in place and leaves them uncommitted. That's the
whole safety story: the user reviews the diff in the graph they already
have open, and a bad edit is one Discard away.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from swarm_debug import debug
from typeguard import typechecked

from backend.apps.gitgraph.discovery import _run_git

_ROUTER_URL = "http://localhost:20128/v1/messages"
_ROUTER_KEY = "9router"

# Sonnet for the judgement passes. Haiku is fine at spotting a key that
# already matched a regex, but the whole point of the second pass is the
# calls a regex can't make, and that is where the bigger model earns it.
_MODEL_REVIEW = "cc/claude-sonnet-4-6"
_MODEL_FIX = "cc/claude-sonnet-4-6"

# A published app is source, not data. Anything past this is a vendored
# bundle or a blob, and reading it would cost more than it could find.
_MAX_FILE_BYTES = 400_000
_MAX_FILES = 600

# Per-file slice sent to the model. Findings carry line numbers from the
# regex pass, so the model never needs the whole file to judge one hit.
_CONTEXT_LINES = 4

SEVERITY_HIGH = "high"
SEVERITY_MEDIUM = "medium"
SEVERITY_LOW = "low"

_SEVERITY_RANK = {SEVERITY_HIGH: 0, SEVERITY_MEDIUM: 1, SEVERITY_LOW: 2}

# Binary and lockfile extensions. A lockfile can technically carry a
# private registry URL, but it's machine-written and rewriting it by hand
# breaks the install, so it isn't something the fixer should ever touch.
_SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf",
    ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".mov", ".mp3",
    ".wav", ".zip", ".gz", ".tar", ".bz2", ".7z", ".dmg", ".exe", ".dll",
    ".so", ".dylib", ".pyc", ".pyo", ".wasm", ".bin", ".dat", ".db",
    ".sqlite", ".sqlite3",
}
_SKIP_NAMES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
    "Cargo.lock", "composer.lock", "Gemfile.lock", "uv.lock",
}


class Rule:
    """One regex detector.

    `conclusive` is the difference between the two passes: a rule that
    matches a key's actual wire format is a finding on its own, while a
    rule that matches a *shape* (something called `api_key`, an email)
    only earns a look from the model.
    """

    def __init__(
        self,
        rule_id: str,
        title: str,
        pattern: str,
        severity: str,
        conclusive: bool,
        advice: str,
        flags: int = 0,
    ) -> None:
        self.id = rule_id
        self.title = title
        self.regex = re.compile(pattern, flags)
        self.severity = severity
        self.conclusive = conclusive
        self.advice = advice


# Ordered roughly by how badly a hit ruins someone's week.
_RULES: List[Rule] = [
    Rule(
        "private_key",
        "Private key committed",
        r"-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----",
        SEVERITY_HIGH,
        True,
        "Delete the key from the repo and rotate it. A key that reached a "
        "public commit is burned even after the file is removed.",
    ),
    Rule(
        "anthropic_key",
        "Anthropic API key",
        r"sk-ant-[A-Za-z0-9_\-]{20,}",
        SEVERITY_HIGH,
        True,
        "Move it to an environment variable and revoke the exposed key.",
    ),
    Rule(
        # `sk-ant-` keys also start `sk-`, so the Anthropic rule above would
        # match them twice and report one leak as two. Excluding that prefix
        # keeps each key to a single finding.
        "openai_key",
        "OpenAI API key",
        r"\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_\-]{32,}",
        SEVERITY_HIGH,
        True,
        "Move it to an environment variable and revoke the exposed key.",
    ),
    Rule(
        "github_token",
        "GitHub token",
        r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}",
        SEVERITY_HIGH,
        True,
        "Revoke it in GitHub settings and read it from the environment instead.",
    ),
    Rule(
        "aws_key",
        "AWS access key id",
        r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b",
        SEVERITY_HIGH,
        True,
        "Deactivate the key in IAM and use a credentials file or role.",
    ),
    Rule(
        "google_key",
        "Google API key",
        r"\bAIza[0-9A-Za-z_\-]{35}\b",
        SEVERITY_HIGH,
        True,
        "Restrict or delete the key in the Google Cloud console.",
    ),
    Rule(
        "slack_token",
        "Slack token",
        r"\bxox[abposr]-[A-Za-z0-9\-]{10,}",
        SEVERITY_HIGH,
        True,
        "Revoke it in the Slack admin console.",
    ),
    Rule(
        "stripe_key",
        "Stripe secret key",
        r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}",
        SEVERITY_HIGH,
        True,
        "Roll the key in the Stripe dashboard.",
    ),
    Rule(
        "jwt",
        "JSON Web Token",
        r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}",
        SEVERITY_HIGH,
        True,
        "Tokens are bearer credentials. Remove it and issue a fresh one.",
    ),
    Rule(
        "db_url",
        "Database URL with password",
        r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s:@/]+:[^\s:@/]+@[^\s\"'`]+",
        SEVERITY_HIGH,
        True,
        "Read the connection string from the environment.",
    ),
    # Shape rules below. These go to the model, which decides whether the
    # value is a real secret or an obvious placeholder.
    Rule(
        "assigned_secret",
        "Secret-looking assignment",
        r"(?i)\b(?:api[_-]?key|secret|passwd|password|token|auth|bearer|credential)"
        r"\w*\s*[:=]\s*[\"'][^\"'\n]{8,}[\"']",
        SEVERITY_HIGH,
        False,
        "If this is a real credential, move it to an environment variable.",
    ),
    Rule(
        "home_path",
        "Hardcoded personal path",
        r"(?:/Users/|/home/|C:\\\\Users\\\\)[A-Za-z0-9._\-]+",
        SEVERITY_MEDIUM,
        False,
        "Personal paths leak your username and break on every other machine. "
        "Derive the path at runtime.",
    ),
    Rule(
        "email",
        "Personal email address",
        r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b",
        SEVERITY_LOW,
        False,
        "Publishing an address invites scrapers. Drop it unless it's a "
        "contact address you want public.",
    ),
    Rule(
        "private_host",
        "Internal host or IP",
        r"\b(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[A-Za-z0-9\-]+\.(?:internal|local|corp|lan))\b",
        SEVERITY_LOW,
        False,
        "Internal addresses tell readers about your network. Make it configurable.",
    ),
]

# Placeholders that exist to be read as fake. Filtering them here keeps
# the model from being asked the same boring question 40 times.
_PLACEHOLDER_RE = re.compile(
    r"(?i)(your[_\-]?|my[_\-]?|the[_\-]?|some[_\-]?|a[_\-]?)?"
    r"(x{4,}|\.{3,}|<[^>]+>|\$\{[^}]+\}|\{\{[^}]+\}\}|changeme|placeholder|"
    r"example|sample|dummy|redacted|insert|todo|fixme|replace[_\-]?me|"
    r"fake|test[_\-]?key|not[_\-]?a[_\-]?real|abc123|foo|bar|baz|"
    r"process\.env|os\.environ|import\.meta\.env)"
)

# Localhost is not a leak; every dev server in this app binds to it.
_BENIGN_HOST_RE = re.compile(
    r"^(?:127\.0\.0\.1|0\.0\.0\.0|localhost|255\.255\.255\.\d+|"
    r"(?:0|1)\.(?:0|1)\.(?:0|1)\.\d+)$"
)


@typechecked
def _tracked_files(path: Path) -> List[str]:
    """What `git ls-files` says would be published.

    The working tree is deliberately not consulted: an untracked or
    ignored file cannot reach the public repo, so a finding in one would
    be a false alarm about a file the user already excluded.
    """
    out = _run_git(["ls-files", "-z"], path)
    if not out:
        return []
    return [p for p in out.split("\0") if p]


@typechecked
def _readable(path: Path, rel: str) -> Optional[str]:
    full = path / rel
    if full.suffix.lower() in _SKIP_SUFFIXES or full.name in _SKIP_NAMES:
        return None
    try:
        if full.stat().st_size > _MAX_FILE_BYTES:
            return None
        raw = full.read_bytes()
    except OSError:
        return None
    # A NUL in the first block is the same heuristic git uses for "binary".
    if b"\0" in raw[:8000]:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


@typechecked
def _redact(value: str) -> str:
    """Keep enough of a match to recognise it, not enough to use it."""
    value = value.strip()
    if len(value) <= 12:
        return value[:4] + "…"
    return f"{value[:6]}…{value[-4:]}"


@typechecked
def _is_placeholder(snippet: str) -> bool:
    return bool(_PLACEHOLDER_RE.search(snippet))


@typechecked
def _scan_text(rel: str, text: str) -> List[Dict[str, Any]]:
    lines = text.splitlines()
    findings: List[Dict[str, Any]] = []
    seen: set = set()

    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or len(line) > 2000:
            continue
        for rule in _RULES:
            for match in rule.regex.finditer(line):
                value = match.group(0)
                if rule.id == "private_host" and _BENIGN_HOST_RE.match(value):
                    continue
                if not rule.conclusive and _is_placeholder(line):
                    continue
                key = (rule.id, idx, value[:40])
                if key in seen:
                    continue
                seen.add(key)

                lo = max(0, idx - 1 - _CONTEXT_LINES)
                hi = min(len(lines), idx + _CONTEXT_LINES)
                findings.append(
                    {
                        "rule": rule.id,
                        "title": rule.title,
                        "file": rel,
                        "line": idx,
                        "severity": rule.severity,
                        "conclusive": rule.conclusive,
                        "match": _redact(value),
                        "advice": rule.advice,
                        "snippet": "\n".join(lines[lo:hi]),
                        "source": "pattern",
                    }
                )
    return findings


@typechecked
async def _call_router(
    system: str, prompt: str, max_tokens: int, model: str
) -> str:
    """POST to the local router and flatten whatever envelope comes back.

    The router answers /v1/messages with SSE frames even unstreamed, so
    a plain json.loads() on the body fails. This scans out every JSON
    object it can and gathers text from all three shapes the router is
    known to emit.
    """
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "content-type": "application/json",
        "x-api-key": _ROUTER_KEY,
        "anthropic-version": "2023-06-01",
    }
    async with httpx.AsyncClient(timeout=180.0) as client:
        res = await client.post(_ROUTER_URL, json=body, headers=headers)
    if res.status_code != 200:
        raise RuntimeError(f"router {res.status_code}: {res.text[:300]}")

    parts: List[str] = []
    dec = json.JSONDecoder()

    def absorb(obj: object) -> None:
        if not isinstance(obj, dict):
            return
        for block in obj.get("content", []) or []:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        if obj.get("type") == "content_block_delta":
            delta = obj.get("delta") or {}
            if isinstance(delta, dict) and delta.get("type") == "text_delta":
                parts.append(delta.get("text", ""))
        for choice in obj.get("choices", []) or []:
            delta = (choice or {}).get("delta") or {}
            piece = delta.get("content")
            if isinstance(piece, str):
                parts.append(piece)

    raw = res.text.strip()
    pos = 0
    while pos < len(raw):
        while pos < len(raw) and raw[pos] in " \t\r\n":
            pos += 1
        if pos >= len(raw):
            break
        if raw.startswith("data:", pos):
            pos += 5
            while pos < len(raw) and raw[pos] == " ":
                pos += 1
            if raw.startswith("[DONE]", pos):
                pos += 6
                continue
        if raw.startswith("event:", pos):
            nl = raw.find("\n", pos)
            pos = nl + 1 if nl != -1 else len(raw)
            continue
        if pos >= len(raw) or raw[pos] != "{":
            pos += 1
            continue
        try:
            obj, end = dec.raw_decode(raw, pos)
        except json.JSONDecodeError:
            break
        absorb(obj)
        pos = end

    return "".join(parts).strip()


@typechecked
def _extract_json(text: str) -> Optional[Any]:
    """Pull the first JSON array or object out of a model reply."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    dec = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch not in "[{":
            continue
        try:
            obj, _ = dec.raw_decode(text, i)
            return obj
        except json.JSONDecodeError:
            continue
    return None


_REVIEW_SYSTEM = (
    "You review source files that are about to be published to a PUBLIC "
    "app marketplace. You are given candidate findings a regex flagged.\n\n"
    "For each one, decide whether publishing it actually harms the author.\n"
    "  keep  - a real credential, a real personal detail, a real private path\n"
    "  drop  - a placeholder, an example, a public constant, a false positive\n\n"
    "Drop anything read from the environment, any obvious sample value, any "
    "documented public endpoint, localhost, and any string that only looks "
    "secret because of the variable's name.\n"
    "Keep anything you would be unhappy to see in a stranger's git clone.\n\n"
    "Judge each finding ONLY on the thing it names. Context lines are there "
    "to help you read that one thing, never to be judged themselves. A "
    "harmless line does not become a finding because a real secret sits "
    "next to it, and your 'why' must describe that finding's own value.\n\n"
    "Reply with ONLY a JSON array, one object per finding you were given:\n"
    '[{"id": <int>, "verdict": "keep"|"drop", "severity": "high"|"medium"|"low", '
    '"why": "<one short sentence, plain language>"}]\n'
    "Echo every id exactly once. No prose outside the array."
)


@typechecked
async def _review(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Ask the model which shape-matches are real.

    A router failure returns the candidates untouched rather than
    dropping them: a scan that silently forgets findings because a local
    service was asleep is worse than a scan that over-reports.
    """
    if not candidates:
        return []

    # The exact matched text is named per finding. Without it the model
    # reads the surrounding context and judges the most alarming thing in
    # it, so a benign line next to a real key inherits the key's verdict.
    blocks = []
    for i, finding in enumerate(candidates):
        blocks.append(
            f"--- finding {i} ---\n"
            f"rule: {finding['rule']} ({finding['title']})\n"
            f"file: {finding['file']}:{finding['line']}\n"
            f"the ONLY thing you are judging in finding {i} is the "
            f"{finding['title'].lower()} on line {finding['line']}: "
            f"{finding['match']}\n"
            f"surrounding lines, for context only:\n{finding['snippet']}"
        )
    prompt = "\n\n".join(blocks)

    try:
        reply = await _call_router(
            _REVIEW_SYSTEM, prompt, max_tokens=4000, model=_MODEL_REVIEW
        )
    except (RuntimeError, httpx.HTTPError) as exc:
        debug("review failed", str(exc)[:200])
        return candidates

    verdicts = _extract_json(reply)
    if not isinstance(verdicts, list):
        debug("review unparseable")
        return candidates

    by_id: Dict[int, Dict[str, Any]] = {}
    for entry in verdicts:
        if isinstance(entry, dict) and isinstance(entry.get("id"), int):
            by_id[entry["id"]] = entry

    kept: List[Dict[str, Any]] = []
    for i, finding in enumerate(candidates):
        verdict = by_id.get(i)
        # No verdict means the model skipped it; keep it and let the user
        # judge rather than quietly discarding a possible leak.
        if verdict is None:
            kept.append(finding)
            continue
        if str(verdict.get("verdict", "")).lower() == "drop":
            continue
        severity = str(verdict.get("severity", "")).lower()
        if severity in _SEVERITY_RANK:
            finding["severity"] = severity
        why = str(verdict.get("why", "")).strip()
        if why:
            finding["why"] = why
        finding["source"] = "reviewed"
        kept.append(finding)
    return kept


@typechecked
async def scan(path: Path) -> Dict[str, Any]:
    """Scan everything git would publish, and rank what turns up."""
    if not (path / ".git").is_dir():
        raise RuntimeError("This workspace isn't a git repository.")

    tracked = _tracked_files(path)
    truncated = len(tracked) > _MAX_FILES
    tracked = tracked[:_MAX_FILES]

    conclusive: List[Dict[str, Any]] = []
    candidates: List[Dict[str, Any]] = []
    scanned = 0

    for rel in tracked:
        text = _readable(path, rel)
        if text is None:
            continue
        scanned += 1
        for finding in _scan_text(rel, text):
            if finding["conclusive"]:
                conclusive.append(finding)
            else:
                candidates.append(finding)

    reviewed = await _review(candidates)
    findings = conclusive + reviewed
    findings.sort(
        key=lambda f: (_SEVERITY_RANK.get(f["severity"], 3), f["file"], f["line"])
    )

    for i, finding in enumerate(findings):
        finding["id"] = f"{finding['rule']}:{finding['file']}:{finding['line']}:{i}"
        finding.pop("conclusive", None)

    counts = {
        SEVERITY_HIGH: sum(1 for f in findings if f["severity"] == SEVERITY_HIGH),
        SEVERITY_MEDIUM: sum(1 for f in findings if f["severity"] == SEVERITY_MEDIUM),
        SEVERITY_LOW: sum(1 for f in findings if f["severity"] == SEVERITY_LOW),
    }
    debug(scanned, len(findings), counts)
    return {
        "findings": findings,
        "counts": counts,
        "files_scanned": scanned,
        "files_tracked": len(tracked),
        "truncated": truncated,
        "clean": not findings,
        "blocking": counts[SEVERITY_HIGH],
    }


_FIX_SYSTEM = (
    "You remove leaked secrets and personal details from source files that "
    "are about to be published publicly.\n\n"
    "You get one file and the findings inside it. Rewrite the file so every "
    "finding is resolved.\n\n"
    "Rules:\n"
    "- Replace a real secret with a read from the environment, in whatever "
    "way is idiomatic for the language (os.environ.get, process.env, "
    "import.meta.env). Never invent a new literal secret.\n"
    "- Replace a hardcoded personal path with a runtime-derived one "
    "(Path.home(), os.path.expanduser, __dirname).\n"
    "- Replace a personal email or internal host with a neutral placeholder.\n"
    "- Change NOTHING else. Keep every import, comment, blank line and all "
    "indentation exactly as it was. This must stay a working file.\n"
    "- If a finding cannot be fixed without breaking the code, leave that "
    "part alone.\n\n"
    "Reply with ONLY the complete new file contents. No code fences, no "
    "explanation, no preamble."
)


@typechecked
async def _fix_file(path: Path, rel: str, findings: List[Dict[str, Any]]) -> bool:
    """Rewrite one file to resolve its findings. True if the file changed."""
    original = _readable(path, rel)
    if original is None:
        return False

    listing = "\n".join(
        f"- line {f['line']}: {f['title']} ({f['severity']}). {f.get('why') or f['advice']}"
        for f in findings
    )
    prompt = f"File: {rel}\n\nFindings:\n{listing}\n\nCurrent contents:\n{original}"

    # Room for the file to come back whole, plus slack for a rewrite that
    # runs slightly longer than the original.
    budget = min(64_000, max(4_000, len(original) // 2 + 2_000))
    try:
        reply = await _call_router(
            _FIX_SYSTEM, prompt, max_tokens=budget, model=_MODEL_FIX
        )
    except (RuntimeError, httpx.HTTPError) as exc:
        debug("fix failed", rel, str(exc)[:200])
        return False

    if reply.startswith("```"):
        reply = re.sub(r"^```[a-zA-Z]*\n?", "", reply)
        reply = re.sub(r"\n?```$", "", reply)

    updated = reply.strip("\n")
    if not updated.strip() or updated.strip() == original.strip():
        return False

    # A reply far shorter than the original means the model summarised the
    # file instead of rewriting it. Writing that would delete the user's
    # code to fix a leak, which is a worse outcome than the leak.
    if len(updated) < len(original) * 0.5:
        debug("fix rejected, too short", rel, len(original), len(updated))
        return False

    try:
        (path / rel).write_text(
            updated + ("\n" if original.endswith("\n") else ""), encoding="utf-8"
        )
    except OSError as exc:
        debug("write failed", rel, str(exc)[:200])
        return False
    return True


@typechecked
async def autofix(path: Path, max_rounds: int = 3) -> Dict[str, Any]:
    """Fix, rescan, repeat until clean or out of rounds.

    Nothing is committed. The user reviews the diff in the graph they
    already have open, and a bad edit is one Discard away.
    """
    if not (path / ".git").is_dir():
        raise RuntimeError("This workspace isn't a git repository.")

    rounds: List[Dict[str, Any]] = []
    result = await scan(path)

    for round_no in range(1, max_rounds + 1):
        if result["clean"]:
            break

        by_file: Dict[str, List[Dict[str, Any]]] = {}
        for finding in result["findings"]:
            by_file.setdefault(finding["file"], []).append(finding)

        changed: List[str] = []
        for rel, group in by_file.items():
            if await _fix_file(path, rel, group):
                changed.append(rel)

        before = len(result["findings"])
        result = await scan(path)
        rounds.append(
            {
                "round": round_no,
                "files_changed": changed,
                "before": before,
                "after": len(result["findings"]),
            }
        )

        # No file changed means the model had nothing left it was willing
        # to touch. Another identical round would just cost tokens.
        if not changed:
            break

    debug(len(rounds), result["counts"])
    return {"rounds": rounds, "scan": result}
