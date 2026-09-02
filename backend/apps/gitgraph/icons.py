"""Generate an app/skill icon and commit it straight into the entity's repo.

Two engines, ported from the Swarm Admin publish app: the host LLM emitting
self-contained SVG markup, and OpenAI gpt-image-2 raster downscaled to a small
webp. Generation runs as a durable, resumable background job persisted to
jobs.json so a hard frontend/backend restart mid-generation resumes instead of
losing the work. Unlike publish, which stores the icon as an inline data URI in
a sheet, here the picked candidate is written as a real file at the repo root
and committed, so it rides along on the normal push to that repo's GitHub.

Config (the OpenAI key) and jobs live under backend/data/, which is gitignored,
so the key never lands in Git Graph's own history.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import os
import re
import time
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import httpx
from pydantic import BaseModel
from swarm_debug import debug

from backend.apps.gitgraph.discovery import commit_paths, openswarm_data_dir
from backend.apps.openswarm_host.openswarm_host import llm

# backend/data/gitgraph — gitignored (see .gitignore `backend/data/`), so the
# OpenAI key and in-flight jobs are never tracked by Git Graph's own repo.
DATA_DIR = Path(__file__).parent.parent.parent / "data" / "gitgraph"
DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = DATA_DIR / "config.json"
JOBS_PATH = DATA_DIR / "jobs.json"

# The OpenAI key lives OUTSIDE the workspace, in the OpenSwarm data dir. Being
# gitignored keeps a value out of the repo, but the .swarm exporter bundles the
# whole workspace folder (gitignored files included), so a key inside it would
# ship to anyone who installs a release. Kept here it is never swept into a
# bundle, while still surviving app restarts and reinstalls. `_openai_key`
# migrates any legacy key found in the workspace CONFIG_PATH into this file and
# blanks the original, so an app built before this split becomes exportable on
# first read without losing its key.
SECRETS_PATH = openswarm_data_dir() / "gitgraph" / "secrets.json"


# --------------------------------------------------------------------- config

class Config(BaseModel):
    # Key for the gpt-image-2 icon engine. Stored here, never returned by /config;
    # an OPENAI_API_KEY env var is honored as a fallback when this is blank.
    openai_api_key: str = ""
    # Global icon defaults the one-click button and a freshly opened panel start
    # from. Empty lists/blank fall back to the built-in defaults in config_state.
    default_styles: List[str] = []
    default_engines: List[str] = []
    default_model: str = ""
    # User-edited prompt templates. Blank = fall back to the built-in *_TEMPLATE
    # constant, so clearing a field restores the default.
    template_svg_system: str = ""
    template_svg_user: str = ""
    template_image_prompt: str = ""
    template_style_line: str = ""


def _read_config() -> Config:
    try:
        import json
        return Config(**json.loads(CONFIG_PATH.read_text()))
    except Exception:
        return Config()


def _write_config(cfg: Config) -> None:
    import json
    CONFIG_PATH.write_text(json.dumps(cfg.model_dump(), indent=2))


# --------------------------------------------------------------- durable jobs
# Icon generation is persisted the moment it's created; a background task fills
# in results, and the lifespan re-launches anything left unfinished.

_icon_tasks: Dict[str, "asyncio.Task"] = {}
_jobs_lock = asyncio.Lock()


def _read_jobs() -> dict:
    try:
        import json
        return json.loads(JOBS_PATH.read_text())
    except Exception:
        return {}


def _write_jobs(jobs: dict) -> None:
    # Atomic replace so a crash mid-write can never leave a truncated jobs.json.
    import json
    tmp = JOBS_PATH.with_name(JOBS_PATH.name + ".tmp")
    tmp.write_text(json.dumps(jobs, indent=2))
    tmp.replace(JOBS_PATH)


async def _create_job(job: dict) -> None:
    async with _jobs_lock:
        jobs = _read_jobs()
        jobs[job["id"]] = job
        _write_jobs(jobs)


async def _update_job(job_id: str, **fields) -> Optional[dict]:
    async with _jobs_lock:
        jobs = _read_jobs()
        job = jobs.get(job_id)
        if job is None:
            return None
        job.update(fields)
        job["updated_at"] = int(time.time())
        jobs[job_id] = job
        _write_jobs(jobs)
        return job


# --------------------------------------------------------------- icon (SVG) gen

# Presets the picker offers; the key is what the frontend sends, the value is the
# clause folded into the model prompt. Unknown/blank styles just add nothing.
ICON_STYLES = {
    "flat": "flat vector, solid fills, no gradients, bold simple shapes",
    "gradient": "smooth color gradients, modern, glossy",
    "line": "thin single-weight line art, outline only, no fills",
    "3d": "soft 3D look with subtle shading and depth",
    "monochrome": "single accent color on transparent background, minimal",
    "playful": "rounded friendly shapes, bright cheerful colors",
}

ICON_MODELS = {"haiku", "sonnet", "opus"}
ICON_ENGINES = {"svg", "image"}

_SVG_DANGER = re.compile(
    r"<\s*(script|foreignObject)\b|\son\w+\s*=|xlink:href\s*=\s*['\"]https?:", re.I
)


def _clean_svg(raw: str) -> str:
    """Pull a single lone <svg> element out of a model reply and reject anything
    that reaches outside itself."""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    lo = text.lower()
    start = lo.find("<svg")
    end = lo.rfind("</svg>")
    if start != -1 and end == -1:
        raise RuntimeError("The icon was cut off before it finished. Try again or simplify the prompt.")
    if start == -1 or end == -1:
        raise RuntimeError("The model didn't return an <svg> element.")
    svg = text[start:end + len("</svg>")]
    if _SVG_DANGER.search(svg):
        raise RuntimeError("The generated SVG contained disallowed content.")
    svg = _ensure_svg_namespace(svg)
    svg = _dedupe_tag_attributes(svg)
    svg = _ensure_xlink_namespace(svg)
    _validate_svg_xml(svg)
    return svg


# Models occasionally repeat an attribute on a tag (e.g. `height="128" height="128"`).
# That's fatal in strict XML image mode, so drop every repeat after the first per tag.
_TAG = re.compile(r"<([a-zA-Z][\w:.-]*)((?:\s+[^<>]*?)?)(/?)>", re.S)
_ATTR = re.compile(r"([\w:.-]+)\s*=\s*(\"[^\"]*\"|'[^']*')")


def _dedupe_tag_attributes(svg: str) -> str:
    def fix_tag(m: "re.Match[str]") -> str:
        name, attrs, close = m.group(1), m.group(2), m.group(3)
        seen: set[str] = set()
        kept: list[str] = []
        for a in _ATTR.finditer(attrs):
            key = a.group(1).lower()
            if key in seen:
                continue
            seen.add(key)
            kept.append(a.group(0))
        rebuilt = (" " + " ".join(kept)) if kept else ""
        return f"<{name}{rebuilt}{close}>"

    return _TAG.sub(fix_tag, svg)


# If any tag uses an `xlink:` attribute the xlink namespace must be declared on the
# root, or strict XML parsing fails with an unbound-prefix error.
def _ensure_xlink_namespace(svg: str) -> str:
    if "xlink:" not in svg:
        return svg
    m = _SVG_OPEN.search(svg)
    if not m:
        return svg
    attrs = m.group(1)
    if re.search(r"\bxmlns:xlink\s*=", attrs, re.I):
        return svg
    fixed = f'<svg xmlns:xlink="http://www.w3.org/1999/xlink"{attrs}>'
    return svg[:m.start()] + fixed + svg[m.end():]


def _validate_svg_xml(svg: str) -> None:
    """A data-URI SVG is parsed in strict XML mode by the browser. Parse it the
    same way here so anything still malformed fails as a clean candidate instead
    of reaching an <img> as a broken-image box."""
    import xml.etree.ElementTree as ET

    try:
        ET.fromstring(svg)
    except ET.ParseError as e:
        raise RuntimeError(f"The generated SVG was malformed ({e}).") from e


# An SVG loaded through <img src="data:image/svg+xml,..."> is parsed in strict XML
# image mode, where the SVG namespace MUST be declared or the browser shows a
# broken-image glyph. Models frequently omit xmlns, so inject it when missing.
_SVG_OPEN = re.compile(r"<svg\b([^>]*)>", re.I)


def _ensure_svg_namespace(svg: str) -> str:
    m = _SVG_OPEN.search(svg)
    if not m:
        return svg
    attrs = m.group(1)
    if re.search(r"\bxmlns\s*=", attrs, re.I):
        return svg
    fixed = f'<svg xmlns="http://www.w3.org/2000/svg"{attrs}>'
    return svg[:m.start()] + fixed + svg[m.end():]


def _icon_subject(prompt: str, title: str) -> str:
    """The plain-language subject line both engines describe, folding in the
    entity title when the user gave one so a blank prompt still produces a
    relevant mark."""
    subject = (prompt or "").strip()
    if title.strip():
        subject = f"{subject} (icon for an app called '{title.strip()}')" if subject else \
            f"an icon representing an app called '{title.strip()}'"
    return subject


# ------------------------------------------------------------- prompt templates
# The literal templates both engines fill and the panel displays. These strings
# ARE the prompt: generation calls `.format(**vars)` on them and the settings /
# gear UI shows the raw string beside the resolved variables, so nothing about
# what reaches the model is reconstructed or hidden. Keep every `{name}` here in
# sync with the keys `_template_vars` returns.
SVG_SYSTEM_TEMPLATE = (
    "You are an icon designer that outputs raw SVG markup only. "
    "Return EXACTLY ONE <svg> element and nothing else: no prose, no markdown "
    "fence, no comments. Requirements: viewBox='0 0 128 128', width and height "
    "attributes of 128, self-contained (inline attributes/styles only), no "
    "<script>, no <foreignObject>, no external or xlink http references, no "
    "embedded raster images. Keep it a clean, legible, centered app icon that "
    "reads well at 44px."
)
SVG_USER_TEMPLATE = "Design an app icon of: {subject}.{style_line} Output only the <svg>...</svg>."
IMAGE_PROMPT_TEMPLATE = (
    "A clean, centered app icon of: {subject}. Single bold subject, generous "
    "margins, no text, no lettering, no words, reads clearly when shrunk to a "
    "small size.{style_line}"
)
# Folded into {style_line} only when a style is chosen; blank styles interpolate
# to nothing so the sentence closes cleanly.
STYLE_LINE_TEMPLATE = " Style: {style_clause}."

# Which variables each default template references. Drives the settings editor's
# "you dropped {x}" warning and the variable pickers offered per field.
TEMPLATE_DEFAULTS = {
    "svg_system": SVG_SYSTEM_TEMPLATE,
    "svg_user": SVG_USER_TEMPLATE,
    "image_prompt": IMAGE_PROMPT_TEMPLATE,
    "style_line": STYLE_LINE_TEMPLATE,
}

_TOKEN = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def _template_var_names(tpl: str) -> List[str]:
    """Ordered, de-duplicated {name} tokens a template references."""
    seen: Set[str] = set()
    out: List[str] = []
    for m in _TOKEN.finditer(tpl or ""):
        name = m.group(1)
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


def _render_template(tpl: str, variables: dict) -> str:
    """Fill only known {name} tokens from `variables`; leave any other brace text
    literal. Unlike str.format this never raises on stray braces a user typed, and
    a None value renders empty (matching how a blank style_line closes cleanly)."""
    def sub(m: "re.Match[str]") -> str:
        val = variables.get(m.group(1))
        return "" if val is None else str(val)
    return _TOKEN.sub(sub, tpl or "")


def _tpl_svg_system() -> str:
    return (_read_config().template_svg_system or "").strip() or SVG_SYSTEM_TEMPLATE


def _tpl_svg_user() -> str:
    return (_read_config().template_svg_user or "").strip() or SVG_USER_TEMPLATE


def _tpl_image_prompt() -> str:
    return (_read_config().template_image_prompt or "").strip() or IMAGE_PROMPT_TEMPLATE


def _tpl_style_line() -> str:
    # Not stripped: leading whitespace before " Style:" is significant here.
    saved = _read_config().template_style_line
    return saved if (saved or "").strip() else STYLE_LINE_TEMPLATE


def _template_vars(prompt: str, style: str, title: str, model: str = "") -> dict:
    """Every value that gets interpolated into a prompt template, resolved from
    the raw form inputs. The UI shows this dict next to the raw template so the
    substitution is fully legible."""
    style_key = (style or "").strip().lower()
    style_clause = ICON_STYLES.get(style_key, (style or "").strip())
    subject = _icon_subject(prompt, title) or "an abstract mark"
    style_line = _render_template(_tpl_style_line(), {"style_clause": style_clause}) if style_clause else ""
    picked = (model or "").strip().lower()
    return {
        "prompt": (prompt or "").strip(),
        "title": (title or "").strip(),
        "style": style_key,
        "style_clause": style_clause,
        "subject": subject,
        "style_line": style_line,
        # None means the host picks its default; keep that distinction visible.
        "model": picked if picked in ICON_MODELS else None,
    }


def build_svg_request(prompt: str, style: str, title: str, model: str = "") -> dict:
    """The exact request the SVG engine hands the host LLM: the system prompt, the
    user message, and the resolved model, produced by filling the shared templates.
    `_generate_icon_svg` and the prompt preview both build from here so what's
    previewed is literally what's sent."""
    v = _template_vars(prompt, style, title, model)
    return {
        "system": _render_template(_tpl_svg_system(), v),
        "user": _render_template(_tpl_svg_user(), v),
        "model": v["model"],
    }


def _generate_icon_svg(prompt: str, style: str, title: str, model: str = "") -> str:
    """Ask the host LLM for a self-contained SVG icon and return cleaned markup."""
    req = build_svg_request(prompt, style, title, model)
    reply = llm(req["user"], system=req["system"], max_tokens=16000,
                model=req["model"])
    return _clean_svg(reply)


# gpt-image-2 returns a 1024px+ raster; we downscale to this edge and store it
# inline as a data URI exactly like the SVG path for the preview grid.
ICON_RASTER_EDGE = 128
_PLACEHOLDER_KEYS = {"", "todo", "null", "none", "changeme"}


def _read_secret_key() -> str:
    """The OpenAI key from the external (non-exported) secrets file, if present."""
    try:
        import json
        data = json.loads(SECRETS_PATH.read_text())
        return str(data.get("openai_api_key") or "").strip()
    except Exception:
        return ""


def _write_secret_key(key: str) -> None:
    """Persist the OpenAI key to the external secrets file (outside the workspace)."""
    import json
    SECRETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SECRETS_PATH.write_text(json.dumps({"openai_api_key": key.strip()}, indent=2))


def _migrate_legacy_key() -> None:
    """Move any key still sitting in the in-workspace config.json to the external
    secrets file, then blank it in config.json so the workspace no longer carries
    a secret. A one-time, idempotent step that makes older apps exportable."""
    cfg = _read_config()
    legacy = (cfg.openai_api_key or "").strip()
    if legacy.lower() in _PLACEHOLDER_KEYS:
        return
    if not _read_secret_key():
        _write_secret_key(legacy)
    cfg.openai_api_key = ""
    _write_config(cfg)


def _openai_key() -> str:
    """Key for the AI-image engine, resolved without ever reading it from a file
    the .swarm exporter would bundle. Order: the external secrets file, then
    OPENAI_API_KEY from the environment, then (legacy) the in-workspace config,
    which is migrated out on sight. Placeholder values count as absent."""
    _migrate_legacy_key()
    secret = _read_secret_key()
    if secret.lower() not in _PLACEHOLDER_KEYS:
        return secret
    env = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if env.lower() not in _PLACEHOLDER_KEYS:
        return env
    saved = (_read_config().openai_api_key or "").strip()
    return saved if saved.lower() not in _PLACEHOLDER_KEYS else ""


def build_image_prompt(prompt: str, style: str, title: str) -> str:
    """The exact prompt string the image engine sends to gpt-image-2, produced by
    filling IMAGE_PROMPT_TEMPLATE. Shared by `_generate_icon_image` and the
    preview so they can never disagree."""
    v = _template_vars(prompt, style, title)
    return _render_template(_tpl_image_prompt(), v)


def _generate_icon_image(prompt: str, style: str, title: str) -> str:
    """Generate a raster icon with gpt-image-2, downscale it to a small square
    webp, and return a `data:image/webp;base64,...` URI."""
    key = _openai_key()
    if not key:
        raise RuntimeError("Add an OpenAI API key in the icon panel to use AI-generated image icons.")
    body = {
        "model": "gpt-image-2",
        "prompt": build_image_prompt(prompt, style, title),
        "quality": "low",
        "size": "1024x1024",
        "n": 1,
    }
    with httpx.Client(timeout=180.0) as client:
        resp = client.post(
            "https://api.openai.com/v1/images/generations",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=body,
        )
    if resp.status_code >= 400:
        raise RuntimeError(_openai_error(resp))
    data = resp.json().get("data") or []
    b64 = (data[0].get("b64_json") if data else "") or ""
    if not b64:
        raise RuntimeError("The image API returned no image data.")
    return _raster_to_data_uri(base64.b64decode(b64))


def _openai_error(resp: "httpx.Response") -> str:
    """Turn an OpenAI error response into a short, user-facing sentence."""
    try:
        err = resp.json().get("error", {})
    except Exception:
        err = {}
    code = err.get("code") or ""
    msg = err.get("message") or resp.text[:200]
    if code == "moderation_blocked" or (resp.status_code == 400 and "safety" in msg.lower()):
        return "The prompt was blocked by the image safety filter. Try describing it differently."
    if resp.status_code in (401, 403):
        return "The OpenAI API key was rejected. Check the key in the icon panel."
    return f"Image generation failed ({resp.status_code}): {msg}"


def _raster_to_data_uri(raw: bytes) -> str:
    """Downscale raw image bytes to a small square webp and return a data URI."""
    from PIL import Image

    img = Image.open(BytesIO(raw)).convert("RGBA")
    img.thumbnail((ICON_RASTER_EDGE, ICON_RASTER_EDGE), Image.LANCZOS)
    out = BytesIO()
    img.save(out, format="WEBP", quality=90, method=6)
    b64 = base64.b64encode(out.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{b64}"


# ------------------------------------------------------------- job orchestration

class IconIn(BaseModel):
    prompt: str = ""
    styles: List[str] = []
    engines: List[str] = []
    title: str = ""
    model: str = ""
    # Which entity this icon is for: an app workspace id or skill:<tag>:<name>.
    # Lets the form resume the right job after a reload.
    entity_id: str = "new"


def template_reference() -> dict:
    """The raw prompt templates and the variables they reference, independent of
    any form input. The settings page renders this so the templates are legible
    even before a single character is typed."""
    return {
        "styles": ICON_STYLES,
        "variables": {
            "prompt": "What you type in the description box (trimmed).",
            "title": "The app or skill name this icon is for.",
            "subject": "prompt + title folded into one subject line; 'an abstract mark' if both are blank.",
            "style": "The chosen style key (flat, line, …), lowercased.",
            "style_clause": "The expanded style guidance for that key (see the styles list).",
            "style_line": "' Style: {style_clause}.' when a style is set, otherwise empty.",
            "model": "Chosen host model for SVG (haiku/sonnet/opus), or host default.",
        },
        "svg": {
            "system": _tpl_svg_system(),
            "user": _tpl_svg_user(),
        },
        "image": {
            "prompt": _tpl_image_prompt(),
        },
        "style_line": _tpl_style_line(),
        # Built-in constants plus the variables each references, so the editor can
        # offer "Reset to default" and warn when an edit drops a variable.
        "defaults": {
            key: {"template": tpl, "variables": _template_var_names(tpl)}
            for key, tpl in TEMPLATE_DEFAULTS.items()
        },
    }


def preview_prompts(body: IconIn) -> List[dict]:
    """The literal payload each engine×style candidate will send, built from the
    same templates generation uses, so the panel shows exactly what the model
    receives, no reconstruction. One entry per engine×style pair.

    Each entry also carries the raw `template` string(s) and the resolved `vars`
    interpolated into them, so the UI can show template-and-substitution, not
    just the final text.
    """
    engines = _dedupe(body.engines, ICON_ENGINES) or ["svg"]
    styles = _dedupe(body.styles) or [""]
    out: List[dict] = []
    for engine in engines:
        for style in styles:
            v = _template_vars(body.prompt, style, body.title, body.model)
            shown = {k: ("" if val is None else val) for k, val in v.items()}
            if engine == "image":
                out.append({
                    "engine": "image",
                    "style": style,
                    "target": "gpt-image-2",
                    "prompt": build_image_prompt(body.prompt, style, body.title),
                    "template": {"prompt": _tpl_image_prompt()},
                    "vars": shown,
                })
            else:
                req = build_svg_request(body.prompt, style, body.title, body.model)
                out.append({
                    "engine": "svg",
                    "style": style,
                    "target": req["model"] or "host default",
                    "system": req["system"],
                    "user": req["user"],
                    "template": {"system": _tpl_svg_system(), "user": _tpl_svg_user()},
                    "vars": shown,
                })
    return out


async def _one_icon(prompt: str, style: str, title: str, model: str, engine: str) -> dict:
    """Generate a single candidate for one engine×style pair. Failures are captured
    per-candidate so one bad combo never sinks the batch."""
    try:
        if engine == "image":
            data_uri = await asyncio.to_thread(_generate_icon_image, prompt, style, title)
            return {"engine": engine, "style": style, "ok": True, "error": "",
                    "svg": "", "data_uri": data_uri}
        svg = await asyncio.to_thread(_generate_icon_svg, prompt, style, title, model)
        data_uri = "data:image/svg+xml;base64," + \
            base64.b64encode(svg.encode("utf-8")).decode("ascii")
        return {"engine": engine, "style": style, "ok": True, "error": "",
                "svg": svg, "data_uri": data_uri}
    except Exception as e:
        return {"engine": engine, "style": style, "ok": False, "error": str(e),
                "svg": "", "data_uri": ""}


def _dedupe(items: list, allowed: Optional[Set[str]] = None) -> list:
    seen: Set[str] = set()
    out = []
    for x in items or []:
        if not isinstance(x, str):
            continue
        k = x.strip().lower()
        if allowed is not None and k not in allowed:
            continue
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


async def _run_icon_job(job_id: str) -> None:
    """Generate every engine×style candidate for a persisted job, writing progress
    back to jobs.json so a reload/restart can pick up the result."""
    job = await _update_job(job_id, status="running")
    if job is None:
        return
    try:
        engines = job.get("engines") or ["svg"]
        styles = job.get("styles") or [""]
        pairs = [(e, s) for e in engines for s in styles]
        results = list(await asyncio.gather(*[
            _one_icon(job.get("prompt", ""), s, job.get("title", ""),
                      job.get("model", ""), e) for (e, s) in pairs
        ]))
        ok = any(r["ok"] for r in results)
        error = "" if ok else (results[0]["error"] if results else "Generation failed.")
        debug("icon job", job_id, "done:", len(pairs), "candidates,",
              sum(1 for r in results if r["ok"]), "ok")
        await _update_job(job_id, status="done" if ok else "failed",
                          results=results, error=error)
    except Exception as e:
        debug("icon job", job_id, "crashed:", e)
        await _update_job(job_id, status="failed", error=str(e))
    finally:
        _icon_tasks.pop(job_id, None)


def _launch_icon_job(job_id: str) -> None:
    """Spawn (and hold a reference to) the background task that runs a job."""
    task = asyncio.create_task(_run_icon_job(job_id))
    _icon_tasks[job_id] = task


async def start_job(body: IconIn) -> Tuple[bool, str, Optional[dict]]:
    """Create + launch a durable job for the engine×style cross product. Returns
    (ok, error, job)."""
    if not body.prompt.strip() and not body.title.strip():
        return False, "Describe the icon first.", None
    engines = _dedupe(body.engines, ICON_ENGINES) or ["svg"]
    styles = _dedupe(body.styles) or [""]
    now = int(time.time())
    job = {
        "id": binascii.hexlify(os.urandom(8)).decode("ascii"),
        "entity_id": (body.entity_id or "new").strip() or "new",
        "prompt": body.prompt,
        "title": body.title,
        "model": body.model,
        "engines": engines,
        "styles": styles,
        "status": "queued",
        "results": [],
        "error": "",
        "created_at": now,
        "updated_at": now,
    }
    await _create_job(job)
    _launch_icon_job(job["id"])
    debug("icon job", job["id"], "queued for", job["entity_id"],
          len(engines), "engines x", len(styles), "styles")
    return True, "", job


def list_jobs(entity_id: str = "") -> List[dict]:
    jobs = list(_read_jobs().values())
    if entity_id:
        jobs = [j for j in jobs if j.get("entity_id") == entity_id]
    jobs.sort(key=lambda j: j.get("created_at", 0), reverse=True)
    return jobs


def get_job(job_id: str) -> Optional[dict]:
    return _read_jobs().get(job_id)


async def delete_job(job_id: str) -> bool:
    task = _icon_tasks.pop(job_id, None)
    if task is not None:
        task.cancel()
    async with _jobs_lock:
        jobs = _read_jobs()
        existed = jobs.pop(job_id, None) is not None
        if existed:
            _write_jobs(jobs)
    return existed


async def resume_interrupted() -> None:
    """Re-launch icon jobs that were mid-flight when the process last stopped, and
    prune finished jobs older than a week. Called from the SubApp lifespan."""
    try:
        jobs = _read_jobs()
        cutoff = int(time.time()) - 7 * 86400
        pruned = {k: v for k, v in jobs.items()
                  if not (v.get("status") in ("done", "failed")
                          and v.get("updated_at", 0) < cutoff)}
        if len(pruned) != len(jobs):
            _write_jobs(pruned)
            jobs = pruned
        stale = [j["id"] for j in jobs.values()
                 if j.get("status") in ("queued", "running")]
        for job_id in stale:
            debug("resuming interrupted icon job", job_id)
            _launch_icon_job(job_id)
    except Exception as e:
        debug("icon job resume failed", e)


# --------------------------------------------------------- write + commit icon
# The picked candidate is written as a real file at the repo root so it commits
# and pushes with the entity's repo. Only one canonical icon exists at a time;
# applying a new one removes the other variants so a repo never carries a stale
# icon.svg beside a fresh icon.webp.

_DATA_URI = re.compile(r"^data:(?P<mime>[^;,]+)(?P<b64>;base64)?,(?P<data>.*)$", re.S)
_MIME_EXT = {
    "image/svg+xml": "icon.svg",
    "image/webp": "icon.webp",
    "image/png": "icon.png",
    "image/jpeg": "icon.jpg",
}
ICON_BASENAMES = ["icon.svg", "icon.webp", "icon.png", "icon.jpg"]


def _decode_data_uri(data_uri: str) -> Tuple[str, bytes]:
    """Return (filename, raw_bytes) for a supported icon data URI, else raise."""
    m = _DATA_URI.match((data_uri or "").strip())
    if not m:
        raise RuntimeError("That icon isn't a valid data URI.")
    mime = m.group("mime").strip().lower()
    filename = _MIME_EXT.get(mime)
    if filename is None:
        raise RuntimeError(f"Unsupported icon type: {mime}")
    payload = m.group("data")
    if m.group("b64"):
        raw = base64.b64decode(payload)
    else:
        import urllib.parse
        raw = urllib.parse.unquote(payload).encode("utf-8")
    return filename, raw


def apply_icon(path: Path, data_uri: str, message: str = "") -> Tuple[bool, dict]:
    """Write the chosen icon into the repo at `path`, removing any stale icon.*
    variant, and commit just the icon files. Returns (ok, {sha, icon_path})."""
    if not (path / ".git").is_dir():
        return False, {"detail": "This workspace isn't a git repository."}
    try:
        filename, raw = _decode_data_uri(data_uri)
    except RuntimeError as exc:
        return False, {"detail": str(exc)}

    touched: List[str] = []
    # Drop the other icon variants so only one canonical icon.* survives.
    for name in ICON_BASENAMES:
        if name == filename:
            continue
        if (path / name).is_file():
            try:
                (path / name).unlink()
                touched.append(name)
            except OSError:
                pass
    (path / filename).write_bytes(raw)
    touched.append(filename)

    commit_message = (message or "").strip() or "Set app icon"
    ok, result = commit_paths(path, commit_message, touched)
    if not ok:
        return False, {"detail": result}
    return True, {"sha": result, "icon_path": filename}


# --------------------------------------------------------------------- config io

# Built-in fallbacks used when the user hasn't saved a global default yet, so a
# fresh install still opens the panel with a sensible, non-empty selection.
DEFAULT_STYLES = ["flat"]
DEFAULT_ENGINES = ["svg"]
DEFAULT_MODEL = "haiku"


def config_state() -> dict:
    """What the panel needs: whether a usable key exists (never the key itself)
    and the saved global defaults, falling back to the built-ins when unset."""
    cfg = _read_config()
    styles = _dedupe(cfg.default_styles) or DEFAULT_STYLES
    engines = _dedupe(cfg.default_engines, ICON_ENGINES) or DEFAULT_ENGINES
    model = (cfg.default_model or "").strip().lower()
    return {
        "openai_key_set": bool(_openai_key()),
        "default_styles": styles,
        "default_engines": engines,
        "default_model": model if model in ICON_MODELS else DEFAULT_MODEL,
        # Resolved templates (saved override, else built-in default) so the editor
        # loads the current value; blank in config still surfaces as the default.
        "template_svg_system": _tpl_svg_system(),
        "template_svg_user": _tpl_svg_user(),
        "template_image_prompt": _tpl_image_prompt(),
        "template_style_line": _tpl_style_line(),
    }


def save_config(
    openai_api_key: Optional[str] = None,
    default_styles: Optional[List[str]] = None,
    default_engines: Optional[List[str]] = None,
    default_model: Optional[str] = None,
    template_svg_system: Optional[str] = None,
    template_svg_user: Optional[str] = None,
    template_image_prompt: Optional[str] = None,
    template_style_line: Optional[str] = None,
) -> dict:
    """Persist the OpenAI key and/or the global icon defaults. Any field left None
    is unchanged; an empty string clears the key. For templates, a blank string
    resets that field to its built-in default. Returns config_state()."""
    cfg = _read_config()
    if openai_api_key is not None:
        # The key goes to the external secrets file, never the workspace config,
        # so it can't be swept into a release .swarm. Any stale copy in config
        # is cleared to keep the workspace free of the secret.
        _write_secret_key(openai_api_key.strip())
        cfg.openai_api_key = ""
    if default_styles is not None:
        cfg.default_styles = _dedupe(default_styles)
    if default_engines is not None:
        cfg.default_engines = _dedupe(default_engines, ICON_ENGINES)
    if default_model is not None:
        m = default_model.strip().lower()
        cfg.default_model = m if m in ICON_MODELS else ""
    # A saved value equal to the default is stored blank so a later change to the
    # built-in default flows through instead of being pinned to a stale copy.
    if template_svg_system is not None:
        v = template_svg_system.strip()
        cfg.template_svg_system = "" if v == SVG_SYSTEM_TEMPLATE else v
    if template_svg_user is not None:
        v = template_svg_user.strip()
        cfg.template_svg_user = "" if v == SVG_USER_TEMPLATE else v
    if template_image_prompt is not None:
        v = template_image_prompt.strip()
        cfg.template_image_prompt = "" if v == IMAGE_PROMPT_TEMPLATE else v
    if template_style_line is not None:
        cfg.template_style_line = "" if template_style_line == STYLE_LINE_TEMPLATE else template_style_line
    _write_config(cfg)
    return config_state()
