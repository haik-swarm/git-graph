"""Treating GitHub as the user's OpenSwarm cloud.

Two directions here:
  - `list_openswarm_repos`: which of the user's GitHub repos are apps we
    originally created (description prefix "OpenSwarm app: ..."). That
    prefix is set by `github.create_repo` and is the only durable signal
    a repo is one of ours.
  - `install_repo`: clone one of those repos into a fresh workspace and
    register it in the outputs table so it lands on the dashboard exactly
    like a locally-built app.

Local removal lives here too because it shares the same registry read
path. It refuses to touch the currently-running app's own workspace so a
click can't yank the ground out from under this backend process.
"""
from __future__ import annotations

import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from typeguard import typechecked

from backend.apps.gitgraph.discovery import (
    _run_git_result,
    openswarm_data_dir,
    workspace_path,
)
from backend.apps.gitgraph.github import (
    API_ROOT,
    _CREDENTIAL_HELPER,
    _headers,
    read_token,
)
from backend.apps.openswarm_host.openswarm_host import HOST, host_token

_HTTP_TIMEOUT = 20
_CLONE_TIMEOUT = 180

_OPENSWARM_DESCRIPTION_PREFIX = "OpenSwarm app:"


@typechecked
def _installed_remotes() -> Dict[str, str]:
    """{owner/repo lowercased -> workspace_id} for every tracked app.

    Cheap enough to run on every cloud-list call; the picker uses it to
    grey out repos that are already installed instead of letting a second
    install fight with the first.
    """
    data_dir = openswarm_data_dir()
    outputs = data_dir / "outputs"
    workspaces = data_dir / "outputs_workspace"
    if not outputs.is_dir():
        return {}

    installed: Dict[str, str] = {}
    for entry in outputs.glob("*.json"):
        try:
            meta = json.loads(entry.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(meta, dict):
            continue
        wid = meta.get("workspace_id")
        if not isinstance(wid, str) or not wid:
            continue
        ws = workspaces / wid
        if not (ws / ".git").is_dir():
            continue
        ok, out, _ = _run_git_result(["remote", "get-url", "origin"], ws)
        if not ok:
            continue
        url = out.strip()
        slug = _slug_from_url(url)
        if slug:
            installed[slug] = wid
    return installed


@typechecked
def _slug_from_url(url: str) -> Optional[str]:
    cleaned = url.strip()
    if cleaned.endswith(".git"):
        cleaned = cleaned[: -len(".git")]
    import re

    match = re.search(r"github\.com[:/]+([^/]+)/([^/]+)$", cleaned)
    if not match:
        return None
    return f"{match.group(1).lower()}/{match.group(2).lower()}"


@typechecked
async def list_openswarm_repos() -> Dict[str, Any]:
    """Repos on the user's GitHub account whose description marks them as ours.

    Paginates through `GET /user/repos` (100 at a time, up to a safety
    ceiling) so a heavy account doesn't turn this into a 30-second stall.
    Returns `{connected, repos, installed_slugs}`; the frontend uses
    `installed_slugs` to disable install for repos we already have.
    """
    token = read_token()
    if not token:
        return {"connected": False, "repos": [], "installed": {}}

    installed = _installed_remotes()

    repos: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        page = 1
        # 500 repos worth of pages is a reasonable ceiling; anything more
        # and the picker becomes unusable anyway.
        while page <= 5:
            res = await client.get(
                f"{API_ROOT}/user/repos",
                headers=_headers(token),
                params={
                    "per_page": 100,
                    "page": page,
                    "sort": "updated",
                    "affiliation": "owner",
                },
            )
            if res.status_code != 200:
                return {"connected": True, "repos": [], "installed": installed, "error": f"GitHub returned {res.status_code}."}
            batch = res.json()
            if not isinstance(batch, list) or not batch:
                break
            for repo in batch:
                if not isinstance(repo, dict):
                    continue
                desc = repo.get("description") or ""
                if not desc.startswith(_OPENSWARM_DESCRIPTION_PREFIX):
                    continue
                slug = f"{(repo.get('owner') or {}).get('login', '').lower()}/{str(repo.get('name', '')).lower()}"
                repos.append(
                    {
                        "owner": (repo.get("owner") or {}).get("login"),
                        "name": repo.get("name"),
                        "full_name": repo.get("full_name"),
                        "description": desc[len(_OPENSWARM_DESCRIPTION_PREFIX):].strip() or None,
                        "app_name": desc[len(_OPENSWARM_DESCRIPTION_PREFIX):].strip() or repo.get("name"),
                        "html_url": repo.get("html_url"),
                        "clone_url": repo.get("clone_url"),
                        "private": bool(repo.get("private", False)),
                        "updated_at": repo.get("updated_at"),
                        "pushed_at": repo.get("pushed_at"),
                        "default_branch": repo.get("default_branch"),
                        "installed_workspace_id": installed.get(slug),
                    }
                )
            if len(batch) < 100:
                break
            page += 1

    return {"connected": True, "repos": repos, "installed": installed}


@typechecked
def _credential_env(token: str) -> Tuple[List[str], Dict[str, str]]:
    """Args + env that force git to use OUR token for a network operation."""
    return (
        [
            "-c", "credential.helper=",
            "-c", f"credential.helper={_CREDENTIAL_HELPER}",
        ],
        {"GITGRAPH_GITHUB_TOKEN": token, "GIT_TERMINAL_PROMPT": "0"},
    )


@typechecked
async def install_repo(clone_url: str, app_name: str, description: str) -> Tuple[bool, Any]:
    """Clone `clone_url` into a fresh workspace and register it as an app.

    The registry entry is deliberately minimal: it matches the shape
    OpenSwarm's own dashboard writes for locally-built apps, minus the
    fields we don't have (no session_id, no publish info). The runtime
    picks it up on its next scan.
    """
    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."

    slug = _slug_from_url(clone_url)
    if not slug:
        return False, "That doesn't look like a GitHub URL."

    if slug in _installed_remotes():
        return False, "That repo is already installed as an app."

    data_dir = openswarm_data_dir()
    workspaces_root = data_dir / "outputs_workspace"
    outputs_root = data_dir / "outputs"
    try:
        workspaces_root.mkdir(parents=True, exist_ok=True)
        outputs_root.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return False, f"Couldn't prepare data dir: {exc}"

    workspace_id = uuid.uuid4().hex
    target = workspaces_root / workspace_id

    cred_args, cred_env = _credential_env(token)
    ok, _, err = _run_git_result(
        [*cred_args, "clone", clone_url, str(target)],
        workspaces_root,
        env=cred_env,
    )
    if not ok:
        # Clean up the half-cloned directory if git left one behind.
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        detail = err.strip().splitlines()[-1] if err.strip() else "git clone failed."
        return False, detail

    # Prefer registering through the OpenSwarm host so the dashboard
    # sees the new card in real time. Fall back to writing the registry
    # JSON directly if the host is unreachable; the app then shows up
    # after the user reloads OpenSwarm.
    ok_host, output_id, host_err = _host_create_output(
        name=app_name,
        description=description,
        workspace_id=workspace_id,
    )
    if ok_host and output_id:
        return True, {
            "workspace_id": workspace_id,
            "id": output_id,
            "name": app_name,
            "via_host": True,
        }

    now = datetime.now(timezone.utc).isoformat()
    entry_id = workspace_id
    meta = {
        "id": entry_id,
        "name": app_name,
        "description": description,
        "icon": "cloud_download",
        "input_schema": {"type": "object", "properties": {}, "required": []},
        "files": {},
        "thumbnail": None,
        "preview_updated_at": None,
        "session_id": None,
        "workspace_id": workspace_id,
        "created_at": now,
        "updated_at": now,
        "installed_from": {"clone_url": clone_url, "slug": slug},
    }

    entry_path = outputs_root / f"{entry_id}.json"
    try:
        entry_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    except OSError as exc:
        shutil.rmtree(target, ignore_errors=True)
        return False, f"Couldn't write app registry entry: {exc}"

    return True, {
        "workspace_id": workspace_id,
        "id": entry_id,
        "name": app_name,
        "via_host": False,
        "host_error": host_err,
    }


@typechecked
def _host_create_output(
    name: str, description: str, workspace_id: str
) -> Tuple[bool, Optional[str], Optional[str]]:
    """Register an app with the host so the dashboard updates live.

    Returns (ok, output_id, err). On success the host owns the registry
    JSON going forward.
    """
    token = host_token()
    if not token:
        return False, None, "no host token"
    try:
        with httpx.Client(timeout=15.0) as client:
            res = client.post(
                f"{HOST}/api/outputs/create",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": name,
                    "description": description,
                    "icon": "cloud_download",
                    "input_schema": {"type": "object", "properties": {}, "required": []},
                    "files": {},
                    "workspace_id": workspace_id,
                },
            )
    except (httpx.HTTPError, OSError) as exc:
        return False, None, str(exc)
    if res.status_code >= 400:
        return False, None, f"{res.status_code}: {res.text[:200]}"
    try:
        data = res.json()
    except ValueError:
        return False, None, "host returned non-JSON"
    output_id = None
    if isinstance(data, dict):
        output_id = data.get("id") or data.get("output_id")
    return True, (output_id if isinstance(output_id, str) else None), None


@typechecked
def _self_workspace_id() -> Optional[str]:
    """Guess this backend's own workspace id from PWD, so we refuse to delete it."""
    cwd = Path(os.getcwd())
    for parent in [cwd, *cwd.parents]:
        if parent.parent.name == "outputs_workspace":
            return parent.name
    return None


@typechecked
def _entry_paths_for(workspace_id: str) -> List[Path]:
    """Every registry file that points at `workspace_id`.

    Almost always one, but we scan to be safe: a hand-edited outputs/
    directory could technically have duplicates and we want to remove
    every reference so the app doesn't reappear.
    """
    outputs = openswarm_data_dir() / "outputs"
    if not outputs.is_dir():
        return []
    matches: List[Path] = []
    for entry in outputs.glob("*.json"):
        try:
            meta = json.loads(entry.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(meta, dict) and meta.get("workspace_id") == workspace_id:
            matches.append(entry)
    return matches


@typechecked
def _output_ids_for(workspace_id: str) -> List[str]:
    """The registry entry ids (output_id) that point at `workspace_id`.

    The host indexes apps by output_id, not workspace_id, so a delete
    call has to go through those ids to actually clear the dashboard.
    """
    ids: List[str] = []
    for entry in _entry_paths_for(workspace_id):
        try:
            meta = json.loads(entry.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        output_id = meta.get("id") if isinstance(meta, dict) else None
        if isinstance(output_id, str) and output_id:
            ids.append(output_id)
    return ids


@typechecked
def _host_delete_output(output_id: str) -> Tuple[bool, str]:
    """Ask the OpenSwarm host to delete this output.

    The host owns the in-memory dashboard list, so hitting DELETE
    /api/outputs/{id} is what actually makes the app disappear from the
    user's UI in real time. The host also removes the workspace and
    registry JSON for us as a side effect.
    """
    token = host_token()
    if not token:
        return False, "no host token"
    try:
        with httpx.Client(timeout=15.0) as client:
            res = client.delete(
                f"{HOST}/api/outputs/{output_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
    except (httpx.HTTPError, OSError) as exc:
        return False, str(exc)
    if res.status_code >= 400:
        return False, f"{res.status_code}: {res.text[:200]}"
    return True, "ok"


@typechecked
def delete_local(workspace_id: str) -> Tuple[bool, Dict[str, Any]]:
    """Remove an app end-to-end: dashboard entry, registry JSON, workspace.

    Prefer the OpenSwarm host's own DELETE endpoint, because it also
    tells the running dashboard to drop the card in real time. Only if
    the host is unreachable do we fall back to filesystem-only cleanup,
    which works but leaves the dashboard showing a ghost until the user
    reloads OpenSwarm.

    The GitHub repo (if any) is left alone by design.
    """
    if workspace_id == _self_workspace_id():
        return False, {"detail": "Can't delete the app that's running this backend."}

    output_ids = _output_ids_for(workspace_id)
    host_deleted: List[str] = []
    host_errors: List[str] = []

    for output_id in output_ids:
        ok, msg = _host_delete_output(output_id)
        if ok:
            host_deleted.append(output_id)
        else:
            host_errors.append(f"{output_id}: {msg}")

    # If the host cleared everything, we're done — it already removed the
    # workspace and the registry entry as part of that call.
    if host_deleted and not host_errors and not workspace_path(workspace_id):
        return True, {
            "workspace_id": workspace_id,
            "via_host": True,
            "output_ids_deleted": host_deleted,
        }

    # Fallback path: host is down or didn't fully clean up. Do the
    # filesystem work ourselves so the on-disk state is at least honest.
    path = workspace_path(workspace_id)
    workspace_removed = False
    if path is not None:
        try:
            shutil.rmtree(path)
            workspace_removed = True
        except OSError as exc:
            return False, {"detail": f"Couldn't remove workspace: {exc}"}

    entries = _entry_paths_for(workspace_id)
    for entry in entries:
        try:
            entry.unlink()
        except OSError as exc:
            return False, {"detail": f"Couldn't remove registry entry: {exc}"}

    if not workspace_removed and not entries and not host_deleted:
        return False, {"detail": "Nothing to remove for that workspace id."}

    return True, {
        "workspace_id": workspace_id,
        "via_host": bool(host_deleted),
        "output_ids_deleted": host_deleted,
        "workspace_removed": workspace_removed,
        "registry_entries_removed": len(entries),
        "host_errors": host_errors or None,
    }
