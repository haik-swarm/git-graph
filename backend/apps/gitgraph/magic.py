"""One-shot: stage everything dirty, ask the local LLM to write the
message from the actual diff, commit, and push.

The LLM is OpenSwarm's own bundled router (9Router at
localhost:20128), so no external key is needed and no data leaves the
machine other than what the user chose to push to GitHub anyway. If
the router is asleep or the diff is empty, the caller sees a plain
error string rather than a fabricated commit.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple

import httpx

from backend.apps.gitgraph.discovery import (
    _run_git,
    _run_git_result,
    read_dirty,
)

# 9Router listens here in every OpenSwarm install; the "9router" api-key is
# a fixed sentinel the router accepts on localhost.
_ROUTER_URL = "http://localhost:20128/v1/messages"
_ROUTER_KEY = "9router"

# Haiku is fast enough that the button feels instant on small diffs and
# still handles multi-file refactors coherently.
_MODEL = "cc/claude-haiku-4-5-20251001"

# Truncation guards a runaway paste (say, someone regenerated a lockfile)
# from blowing out the model's context or the router's request cap.
_MAX_DIFF_CHARS = 60_000

_SYSTEM = (
    "You write short, precise git commit messages from a diff.\n"
    "Format:\n"
    "  <one-line summary in the imperative, <=72 chars, no trailing period>\n"
    "  <blank line>\n"
    "  <optional bullets explaining the WHY, not the WHAT>\n"
    "Rules: no code fences, no preamble like 'Here is', no 'this commit',\n"
    "no emojis. If the diff is tiny (a typo, a rename), one line is fine."
)


def _collect_paths_and_diff(path: Path) -> Tuple[List[str], str, str]:
    """Return (paths, staged_diff, unstaged_diff) for everything dirty.

    Staged and unstaged are read separately so a partial `git add` still
    yields a full picture, and untracked files are included by name plus
    a synthetic /dev/null diff so the model sees them.
    """
    dirty = read_dirty(path)
    paths = [entry["path"] for entry in dirty]

    staged = _run_git(["diff", "--staged", "--no-color"], path) or ""
    unstaged = _run_git(["diff", "--no-color"], path) or ""

    untracked = [e["path"] for e in dirty if e["code"] == "??"]
    extras: List[str] = []
    for u in untracked:
        try:
            body = (path / u).read_text(errors="replace")
        except (OSError, UnicodeDecodeError):
            body = "<binary or unreadable>"
        # A minimal unified header the model already knows how to read.
        extras.append(f"diff --git a/{u} b/{u}\nnew file\n--- /dev/null\n+++ b/{u}\n{body}")
    if extras:
        unstaged = (unstaged + "\n" + "\n".join(extras)).strip()

    combined = (staged + "\n" + unstaged).strip()
    if len(combined) > _MAX_DIFF_CHARS:
        combined = combined[:_MAX_DIFF_CHARS] + "\n\n[...diff truncated for length...]"
    return paths, combined, unstaged


async def _ask_llm(diff: str, file_list: List[str], app_name: str) -> str:
    """Call the local router and return the message string.

    Streaming is on (the endpoint's default) so we join deltas as they
    arrive; a small server on the same box is fast, but reading the whole
    body in one shot would still block on the final flush.
    """
    listing = "\n".join(f"  {p}" for p in file_list) or "  (none)"
    prompt = (
        f"App: {app_name}\n"
        f"Changed files:\n{listing}\n\n"
        f"Diff:\n{diff or '(no textual diff, only file additions)'}"
    )
    body = {
        "model": _MODEL,
        "max_tokens": 400,
        "system": _SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "content-type": "application/json",
        "x-api-key": _ROUTER_KEY,
        "anthropic-version": "2023-06-01",
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        r = await client.post(_ROUTER_URL, json=body, headers=headers)
    if r.status_code != 200:
        raise RuntimeError(f"router {r.status_code}: {r.text[:300]}")

    # 9Router's /v1/messages returns a full Anthropic message envelope
    # AND, on longer completions, appends SSE stop frames after it. Bare
    # json.loads() on that whole blob fails with "Extra data", so we scan
    # for every JSON object we can raw_decode out, plus every "data: ..."
    # SSE frame, and gather text from whichever shape is present.
    import json as _json
    text_parts: List[str] = []
    dec = _json.JSONDecoder()

    def _absorb(obj: object) -> None:
        if not isinstance(obj, dict):
            return
        # Anthropic full message.
        for block in obj.get("content", []) or []:
            if isinstance(block, dict) and block.get("type") == "text":
                text_parts.append(block.get("text", ""))
        # Anthropic streaming delta.
        if obj.get("type") == "content_block_delta":
            delta = obj.get("delta") or {}
            if isinstance(delta, dict) and delta.get("type") == "text_delta":
                text_parts.append(delta.get("text", ""))
        # OpenAI-style stream chunk.
        for choice in obj.get("choices", []) or []:
            delta = (choice or {}).get("delta") or {}
            piece = delta.get("content")
            if isinstance(piece, str):
                text_parts.append(piece)

    raw = r.text.strip()
    pos = 0
    while pos < len(raw):
        # Skip whitespace and any SSE noise like "event: ..." / "data: ".
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
            # Unrecognized filler; skip a char and keep scanning.
            pos += 1
            continue
        try:
            obj, end = dec.raw_decode(raw, pos)
        except _json.JSONDecodeError:
            break
        _absorb(obj)
        pos = end

    message = "".join(text_parts).strip()
    if message.startswith("```"):
        message = message.strip("`").split("\n", 1)[-1].rstrip("`").strip()
    return message


async def draft_message(path: Path, app_name: str) -> Tuple[str, List[str]]:
    """Write a commit message for the current diff without touching the repo.

    This is the read-only half of the old one-shot button: the single-app UI
    drafts first and lets the user read and edit the message before anything
    is committed, so drafting must not stage, commit, or push.
    """
    if not (path / ".git").is_dir():
        raise RuntimeError("This workspace isn't a git repository.")

    paths, diff, _ = _collect_paths_and_diff(path)
    if not paths:
        raise RuntimeError("Nothing to commit.")

    message = await _ask_llm(diff, paths, app_name)
    if not message:
        raise RuntimeError("The model returned an empty message.")
    return message, paths


async def magic_update(path: Path, app_name: str, do_push: bool) -> Dict[str, object]:
    """Draft a message from the current diff, commit everything dirty, push.

    Still one shot, because bulk across many apps has no room to review each
    message. Returns the pieces the UI needs to render a receipt (message,
    sha, file list, whether push happened). Raises with a plain string on
    the first failure so the caller can surface it directly.
    """
    message, paths = await draft_message(path, app_name)

    # Stage everything dirty in one shot; -A also catches deletions that
    # a bare `add <paths>` would miss.
    ok, _, err = _run_git_result(["add", "-A"], path)
    if not ok:
        raise RuntimeError(f"git add failed: {err.strip() or 'unknown'}")

    ok, _, err = _run_git_result(["commit", "-m", message], path)
    if not ok:
        raise RuntimeError(f"git commit failed: {err.strip() or 'unknown'}")

    sha = (_run_git(["rev-parse", "HEAD"], path) or "").strip()

    pushed = False
    push_error = ""
    if do_push:
        from backend.apps.gitgraph import github
        ok, result = github.push(path)
        if ok:
            pushed = True
        else:
            push_error = str(result)

    return {
        "sha": sha,
        "message": message,
        "paths": paths,
        "pushed": pushed,
        "push_error": push_error,
    }
