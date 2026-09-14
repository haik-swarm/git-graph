"""Syncing bundles against a single shared `openswarm-bundles` GitHub repo.

Bundles have no workspace, so unlike apps they can't each own a repo. Instead
every bundle round-trips through one private repo on the connected account:

    bundles.json        the bundle map, icons stripped to keep it diffable
    <bundleId>.webp     one file per bundle that has an icon

The inline data-URI icon is decoded to a real .webp on push and re-inlined on
pull, so the JSON stays small and the images diff as binaries.

Conflict resolution is per-bundle by `updated_at`: whichever side edited a
given bundle most recently wins. The token, headers and credential-helper
plumbing are all reused from github.py so this repo authenticates exactly like
an app repo does.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx
from typeguard import typechecked

from backend.apps.gitgraph import bundles as bundles_store
from backend.apps.gitgraph.discovery import (
    _run_git,
    _run_git_result,
    openswarm_data_dir,
)
from backend.apps.gitgraph.github import (
    API_ROOT,
    _HTTP_TIMEOUT,
    _credential_args,
    _headers,
    read_token,
)

REPO_NAME = "openswarm-bundles"
REPO_DESCRIPTION = "OpenSwarm bundles: shared app, skill and bundle groupings"
_MANIFEST = "bundles.json"
_ICON_PREFIX = "data:image/webp;base64,"
_NET_TIMEOUT = 30


@typechecked
def _clone_dir() -> Path:
    """Where the local mirror of the bundles repo lives (outside any workspace)."""
    return openswarm_data_dir() / "gitgraph" / "bundles-repo"


@typechecked
def _git_env(token: str) -> Dict[str, str]:
    return {"GITGRAPH_GITHUB_TOKEN": token, "GIT_TERMINAL_PROMPT": "0"}


@typechecked
async def _current_login(client: httpx.AsyncClient, token: str) -> Tuple[Optional[str], Optional[str]]:
    """Resolve the connected account's login. Returns (login, error): on success
    (login, None); on failure (None, human-readable reason) so callers can tell a
    rate-limit or auth failure apart from a genuinely empty account."""
    resp = await client.get(f"{API_ROOT}/user", headers=_headers(token))
    if resp.status_code == 200:
        login = resp.json().get("login")
        if isinstance(login, str) and login:
            return login, None
        return None, "GitHub didn't return an account login."

    message = ""
    try:
        message = resp.json().get("message", "") or ""
    except Exception:
        pass
    remaining = resp.headers.get("x-ratelimit-remaining")
    if resp.status_code == 403 and (remaining == "0" or "rate limit" in message.lower()):
        reset = resp.headers.get("x-ratelimit-reset")
        when = ""
        if reset and reset.isdigit():
            import datetime as _dt
            mins = max(0, round((int(reset) - _dt.datetime.now(_dt.timezone.utc).timestamp()) / 60))
            when = f" Try again in about {mins} min." if mins else " Try again shortly."
        return None, f"GitHub API rate limit reached.{when}"
    if resp.status_code in (401, 403):
        return None, "GitHub rejected the token. Reconnect the GitHub integration in OpenSwarm settings."
    return None, f"GitHub returned {resp.status_code} reading the connected account."


@typechecked
async def ensure_repo() -> Tuple[bool, Any]:
    """Create or reuse the private `openswarm-bundles` repo on the connected
    account. Returns (ok, {"owner", "repo", "clone_url"}) or (False, error)."""
    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        owner, login_err = await _current_login(client, token)
        if not owner:
            return False, login_err or "Couldn't read the connected GitHub account."

        existing = await client.get(
            f"{API_ROOT}/repos/{owner}/{REPO_NAME}", headers=_headers(token)
        )
        if existing.status_code == 200:
            data = existing.json()
            return True, {
                "owner": owner,
                "repo": REPO_NAME,
                "clone_url": data.get("clone_url", f"https://github.com/{owner}/{REPO_NAME}.git"),
            }
        if existing.status_code not in (404, 403):
            return False, f"GitHub returned {existing.status_code} checking for the bundles repo."

        created = await client.post(
            f"{API_ROOT}/user/repos",
            headers=_headers(token),
            json={
                "name": REPO_NAME,
                "description": REPO_DESCRIPTION,
                "private": True,
                "auto_init": True,
            },
        )
        if created.status_code not in (200, 201):
            detail = ""
            try:
                detail = created.json().get("message", "")
            except Exception:
                pass
            return False, detail or f"GitHub returned {created.status_code} creating the bundles repo."
        data = created.json()
        return True, {
            "owner": owner,
            "repo": REPO_NAME,
            "clone_url": data.get("clone_url", f"https://github.com/{owner}/{REPO_NAME}.git"),
        }


@typechecked
def _ensure_clone(clone_url: str, token: str) -> Tuple[bool, str]:
    """Make sure a local clone exists and is current. Returns (ok, error)."""
    path = _clone_dir()
    env = _git_env(token)
    if (path / ".git").is_dir():
        ok, _, err = _run_git_result(
            [*_credential_args(), "fetch", "--prune", "--quiet", "origin"],
            path, env=env, timeout=_NET_TIMEOUT,
        )
        if not ok:
            lines = [ln for ln in err.strip().splitlines() if ln.strip()]
            return False, lines[-1] if lines else "git fetch failed."
        branch = (_run_git(["branch", "--show-current"], path) or "main").strip() or "main"
        # The remote is the source of truth for the tree; hard-reset onto it and
        # let the per-bundle merge (not git) decide the final content.
        _run_git_result(
            ["reset", "--hard", f"origin/{branch}"], path, env=env,
        )
        return True, ""

    path.parent.mkdir(parents=True, exist_ok=True)
    ok, _, err = _run_git_result(
        [*_credential_args(), "clone", "--quiet", clone_url, str(path)],
        path.parent, env=env, timeout=_NET_TIMEOUT,
    )
    if not ok:
        lines = [ln for ln in err.strip().splitlines() if ln.strip()]
        return False, lines[-1] if lines else "git clone failed."
    return True, ""


@typechecked
def _read_remote_bundles() -> Dict[str, Any]:
    """Read bundles.json from the local clone, re-inlining each bundle's icon
    from its <id>.webp file. Returns {} when the manifest is absent."""
    path = _clone_dir()
    manifest = path / _MANIFEST
    if not manifest.is_file():
        return {}
    try:
        raw = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    bundles = raw.get("bundles") if isinstance(raw, dict) else None
    if not isinstance(bundles, dict):
        return {}

    for bundle_id, bundle in bundles.items():
        if not isinstance(bundle, dict):
            continue
        icon_file = path / f"{bundle_id}.webp"
        if icon_file.is_file():
            try:
                encoded = base64.b64encode(icon_file.read_bytes()).decode("ascii")
                bundle["icon"] = _ICON_PREFIX + encoded
            except OSError:
                bundle["icon"] = ""
        else:
            bundle["icon"] = ""
    return bundles


@typechecked
def _merge(local: Dict[str, Any], remote: Dict[str, Any]) -> Dict[str, Any]:
    """Per-bundle union; on collision keep the newer `updated_at`."""
    merged: Dict[str, Any] = dict(remote)
    for bundle_id, local_bundle in local.items():
        if not isinstance(local_bundle, dict):
            continue
        remote_bundle = merged.get(bundle_id)
        if not isinstance(remote_bundle, dict):
            merged[bundle_id] = local_bundle
            continue
        if str(local_bundle.get("updated_at", "")) >= str(remote_bundle.get("updated_at", "")):
            merged[bundle_id] = local_bundle
    return merged


@typechecked
def _write_tree(bundles: Dict[str, Any]) -> None:
    """Write the merged map to the clone as bundles.json + one .webp per icon,
    stripping icons out of the JSON and removing stale image files."""
    path = _clone_dir()
    json_safe: Dict[str, Any] = {}
    keep_icons: set = set()

    for bundle_id, bundle in bundles.items():
        if not isinstance(bundle, dict):
            continue
        icon = bundle.get("icon", "")
        if isinstance(icon, str) and icon.startswith(_ICON_PREFIX):
            b64 = icon[len(_ICON_PREFIX):]
            try:
                (path / f"{bundle_id}.webp").write_bytes(base64.b64decode(b64))
                keep_icons.add(bundle_id)
            except (OSError, ValueError):
                pass
        stripped = {**bundle, "icon": ""}
        json_safe[bundle_id] = stripped

    (path / _MANIFEST).write_text(
        json.dumps({"bundles": json_safe}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    # Drop icon files for bundles that no longer carry an image.
    for stale in path.glob("*.webp"):
        if stale.stem not in keep_icons:
            try:
                stale.unlink()
            except OSError:
                pass


@typechecked
def _commit_and_push(token: str) -> Tuple[bool, str]:
    path = _clone_dir()
    env = _git_env(token)
    _run_git_result(["add", "-A"], path, env=None)
    status = _run_git(["status", "--porcelain"], path)
    if not (status or "").strip():
        return True, ""  # nothing changed; remote already matches

    ok, _, err = _run_git_result(
        ["commit", "-m", "Sync bundles from OpenSwarm"], path, env=None,
    )
    if not ok:
        lines = [ln for ln in err.strip().splitlines() if ln.strip()]
        return False, lines[-1] if lines else "git commit failed."

    branch = (_run_git(["branch", "--show-current"], path) or "main").strip() or "main"
    ok, _, err = _run_git_result(
        [*_credential_args(), "push", "--set-upstream", "origin", branch],
        path, env=env, timeout=_NET_TIMEOUT,
    )
    if not ok:
        lines = [ln for ln in err.strip().splitlines() if ln.strip()]
        return False, lines[-1] if lines else "git push failed."
    return True, ""


@typechecked
async def sync() -> Tuple[bool, Any]:
    """Full round trip: ensure the repo, pull the remote tree, merge it with the
    local store by `updated_at`, write the merge back to the store and the repo,
    then push. Returns (ok, {"bundles": <merged list>}) or (False, error)."""
    import asyncio

    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."

    ok, info = await ensure_repo()
    if not ok:
        return False, info

    ok, err = await asyncio.to_thread(_ensure_clone, info["clone_url"], token)
    if not ok:
        return False, err

    remote = await asyncio.to_thread(_read_remote_bundles)
    local = {b["id"]: b for b in bundles_store.list_bundles() if isinstance(b, dict) and b.get("id")}

    merged = _merge(local, remote)
    bundles_store.replace_all(merged)

    await asyncio.to_thread(_write_tree, merged)
    ok, err = await asyncio.to_thread(_commit_and_push, token)
    if not ok:
        return False, err

    return True, {"bundles": bundles_store.list_bundles()}
