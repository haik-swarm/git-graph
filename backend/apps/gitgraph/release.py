"""Cutting an official release of an app: a versioned GitHub Release whose
asset is the app's `.swarm` bundle.

This sits a step past `marketplace.py`. Publishing asks the marketplace org to
list a repo; a release is the author stamping a point in their OWN repo's
history with an installable artifact. The two are independent — an app can be
released without ever being submitted to the marketplace.

The `.swarm` is built by the same host endpoint the export skill uses
(`/api/swarm/export`), reached through the app-runtime host token. That endpoint
refuses to bundle a workspace carrying a secret, which is a feature here: a
release that would leak a key fails loudly at build time instead of shipping it.

A release is only allowed off a clean, fully-pushed tree. The Release points at
a commit on GitHub, so anything uncommitted or unpushed would tag a state the
world can't actually check out.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from swarm_debug import debug
from typeguard import typechecked

from backend.apps.gitgraph import github
from backend.apps.gitgraph.discovery import _run_git, list_apps, read_dirty
from backend.apps.openswarm_host.openswarm_host import HOST, host_token

# Where an app's version series starts. Patch-increments from here on every
# subsequent release unless the caller overrides the version explicitly.
_FIRST_VERSION = "v0.1.0"

# A release tag we recognise as ours to auto-increment from. Anything not
# matching (a date tag, a hand-written "beta") is ignored when picking the
# next version rather than guessed at.
_SEMVER_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")

_UPLOAD_TEMPLATE_RE = re.compile(r"\{\?[^}]*\}$")


@typechecked
def _output_id_for(workspace_id: str) -> Optional[str]:
    """The registry (output) id for a workspace, needed to call the export API.

    The export endpoint keys on the app's output id, not its workspace id, and
    the two only meet in the outputs registry that `list_apps` reads.
    """
    for entry in list_apps():
        if entry.get("workspace_id") == workspace_id:
            oid = entry.get("output_id") or entry.get("id")
            return oid if isinstance(oid, str) and oid else None
    return None


@typechecked
def _parse_semver(tag: str) -> Optional[Tuple[int, int, int]]:
    match = _SEMVER_RE.match(tag.strip())
    if not match:
        return None
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


@typechecked
def _next_version(tags: List[str]) -> str:
    """The next patch version above the highest semver tag seen, or the first.

    Only tags shaped like vX.Y.Z count toward the max; the bump is always to
    the patch component, matching the "auto-increment" the panel promises.
    """
    best: Optional[Tuple[int, int, int]] = None
    for tag in tags:
        parsed = _parse_semver(tag)
        if parsed and (best is None or parsed > best):
            best = parsed
    if best is None:
        return _FIRST_VERSION
    major, minor, patch = best
    return f"v{major}.{minor}.{patch + 1}"


@typechecked
def normalize_version(raw: str) -> Optional[str]:
    """A user-typed version coerced to a `vX.Y.Z` tag, or None if unusable.

    Accepts "1.2.3" or "v1.2.3"; anything else is rejected so a malformed
    override can't become a garbage git tag.
    """
    cleaned = raw.strip()
    if not cleaned:
        return None
    if not cleaned.startswith("v"):
        cleaned = f"v{cleaned}"
    return cleaned if _SEMVER_RE.match(cleaned) else None


@typechecked
def _head_sha(path: Path) -> Optional[str]:
    sha = (_run_git(["rev-parse", "HEAD"], path) or "").strip()
    return sha or None


@typechecked
def _list_releases(
    client: httpx.Client, token: str, owner: str, repo: str
) -> List[Dict[str, Any]]:
    """Existing releases, newest first, trimmed to what the panel renders."""
    res = client.get(
        f"{github.API_ROOT}/repos/{owner}/{repo}/releases",
        headers=github._headers(token),
        params={"per_page": 30},
    )
    if res.status_code != 200:
        return []
    out: List[Dict[str, Any]] = []
    for rel in res.json():
        assets = rel.get("assets") or []
        swarm = next(
            (a for a in assets if str(a.get("name", "")).endswith(".swarm")), None
        )
        out.append(
            {
                "tag": rel.get("tag_name"),
                "name": rel.get("name") or rel.get("tag_name"),
                "html_url": rel.get("html_url"),
                "created_at": rel.get("published_at") or rel.get("created_at"),
                "draft": bool(rel.get("draft")),
                "asset_url": swarm.get("browser_download_url") if swarm else None,
                "asset_name": swarm.get("name") if swarm else None,
            }
        )
    return out


@typechecked
def _preflight(output_id: str) -> Tuple[bool, str]:
    """Ask the host whether this app is exportable right now (secret scan et al).

    Surfaced in status so the panel can warn BEFORE the user clicks release,
    rather than failing the whole cut halfway through. A host that can't be
    reached is reported as "unknown-but-not-blocking" (True) so a transient
    outage doesn't grey out the button on an app that's actually fine.
    """
    try:
        with httpx.Client(timeout=60.0) as client:
            res = client.post(
                f"{HOST}/api/swarm/export/preflight",
                json={"type": "app", "id": output_id},
                headers={"Authorization": f"Bearer {host_token()}"},
            )
    except httpx.HTTPError:
        return True, ""
    if res.status_code >= 400:
        return False, _export_error(res)
    body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    if isinstance(body, dict) and body.get("ok") is False:
        reqs = body.get("summary", {}).get("requirements") or []
        return False, "; ".join(str(r) for r in reqs) or "This app can't be exported yet."
    return True, ""


@typechecked
def _export_error(res: "httpx.Response") -> str:
    """A short sentence from a failed export/preflight response."""
    try:
        detail = res.json().get("detail")
    except ValueError:
        detail = None
    if isinstance(detail, dict):
        detail = detail.get("message") or detail.get("detail")
    return str(detail) if detail else f"Export failed ({res.status_code})."


@typechecked
def _build_swarm(output_id: str) -> Tuple[bytes, str]:
    """Build the `.swarm` for an app via the host export API.

    Returns (bytes, filename). Raises RuntimeError with the host's own
    explanation on failure — most importantly the secret-scan refusal, which
    the caller turns into a blocking message rather than a stack trace.
    """
    with httpx.Client(timeout=300.0) as client:
        res = client.post(
            f"{HOST}/api/swarm/export",
            json={"type": "app", "id": output_id},
            headers={"Authorization": f"Bearer {host_token()}"},
        )
    if res.status_code >= 400:
        raise RuntimeError(_export_error(res))
    disposition = res.headers.get("content-disposition", "")
    match = re.search(r'filename="?([^"]+)"?', disposition)
    filename = match.group(1) if match else f"{output_id}.swarm"
    return res.content, filename


@typechecked
def status(path: Path, workspace_id: str, app_name: str) -> Dict[str, Any]:
    """Everything the Release panel needs to render, in one call.

    Reports the release-readiness gates (connected, has repo, clean tree, fully
    pushed, exportable) plus the computed next version and the existing
    releases. `blocked` is the single reason the button is disabled, or None.
    """
    token = github.read_token()
    is_repo = (path / ".git").is_dir()
    gh = github.status(path, app_name) if is_repo else {}
    owner = gh.get("owner")
    repo = gh.get("repo")
    dirty = read_dirty(path) if is_repo else []
    clean = not dirty
    unpushed = gh.get("unpushed") if gh.get("has_remote") else None
    output_id = _output_id_for(workspace_id)

    releases: List[Dict[str, Any]] = []
    next_version = _FIRST_VERSION
    if token and owner and repo:
        try:
            with httpx.Client(timeout=20.0) as client:
                releases = _list_releases(client, token, owner, repo)
        except httpx.HTTPError:
            releases = []
        next_version = _next_version([r["tag"] for r in releases if r.get("tag")])

    exportable = True
    export_reason = ""
    if output_id:
        exportable, export_reason = _preflight(output_id)

    blocked: Optional[str] = None
    if not token:
        blocked = "Connect the GitHub integration in OpenSwarm settings first."
    elif not is_repo:
        blocked = "Track this app with git before releasing it."
    elif not gh.get("has_remote"):
        blocked = "Create a GitHub repo for this app first."
    elif not clean:
        blocked = "Commit or discard your changes — a release must be a clean tree."
    elif unpushed:
        blocked = f"Push your {unpushed} unpushed commit(s) before releasing."
    elif not output_id:
        blocked = "This app isn't in the registry, so it can't be exported."
    elif not exportable:
        blocked = export_reason or "This app can't be exported yet."

    return {
        "connected": bool(token),
        "is_repo": is_repo,
        "has_remote": bool(gh.get("has_remote")),
        "owner": owner,
        "repo": repo,
        "html_url": gh.get("html_url"),
        "branch": gh.get("branch"),
        "head_sha": _head_sha(path) if is_repo else None,
        "clean": clean,
        "dirty_count": len(dirty),
        "unpushed": unpushed or 0,
        "exportable": exportable,
        "export_reason": export_reason,
        "next_version": next_version,
        "latest_release": releases[0] if releases else None,
        "releases": releases,
        "can_release": blocked is None,
        "blocked": blocked,
    }


@typechecked
def cut_release(
    path: Path,
    workspace_id: str,
    app_name: str,
    version_override: str = "",
    notes: str = "",
) -> Tuple[bool, Any]:
    """Build the `.swarm`, tag the pushed HEAD, and create a GitHub Release.

    Re-checks every gate server-side rather than trusting the panel: the tree
    can go dirty between a status read and the click. Ordering is deliberate —
    the bundle is built FIRST, so a secret-scan refusal aborts before any tag
    or release exists on GitHub to clean up.
    """
    token = github.read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."
    if not (path / ".git").is_dir():
        return False, "This app isn't a git repository."

    url = github.remote_url(path)
    parsed = github.parse_remote(url) if url else None
    if not parsed:
        return False, "This app has no GitHub repo yet."
    owner, repo = parsed

    if read_dirty(path):
        return False, "You have uncommitted changes. Commit or discard them first."

    branch = (_run_git(["branch", "--show-current"], path) or "").strip() or None
    unpushed = github._unpushed_count(path, branch)
    # None means origin's ref isn't known locally; treat every commit as
    # unpushed rather than releasing a HEAD GitHub may not have.
    if unpushed is None or unpushed > 0:
        return False, "Push your latest commits before releasing."

    head = _head_sha(path)
    if not head:
        return False, "This repo has no commits to release."

    output_id = _output_id_for(workspace_id)
    if not output_id:
        return False, "This app isn't in the registry, so it can't be exported."

    if version_override.strip():
        version = normalize_version(version_override)
        if not version:
            return False, "That version isn't a valid vX.Y.Z tag."
    else:
        try:
            with httpx.Client(timeout=20.0) as client:
                existing = _list_releases(client, token, owner, repo)
        except httpx.HTTPError as exc:
            return False, f"Couldn't reach GitHub: {exc}"
        version = _next_version([r["tag"] for r in existing if r.get("tag")])

    # Build the bundle before touching GitHub. A secret-scan refusal (or any
    # export error) stops here, leaving no half-made tag or release behind.
    try:
        blob, filename = _build_swarm(output_id)
    except RuntimeError as exc:
        return False, str(exc)

    try:
        with httpx.Client(timeout=120.0) as client:
            body = notes.strip() or f"Official release {version} of {app_name}."
            created = client.post(
                f"{github.API_ROOT}/repos/{owner}/{repo}/releases",
                headers=github._headers(token),
                json={
                    "tag_name": version,
                    "target_commitish": head,
                    "name": version,
                    "body": body,
                    "draft": False,
                    "prerelease": False,
                },
            )
            if created.status_code == 422:
                return False, f"A release tagged {version} already exists."
            if created.status_code not in (200, 201):
                return False, _github_message(created, f"GitHub returned {created.status_code}.")
            release = created.json()

            upload_url = _UPLOAD_TEMPLATE_RE.sub("", release.get("upload_url", ""))
            if not upload_url:
                return False, "GitHub didn't return an asset upload URL."
            asset = client.post(
                f"{upload_url}?name={filename}",
                headers={
                    **github._headers(token),
                    "Content-Type": "application/zip",
                },
                content=blob,
            )
            if asset.status_code not in (200, 201):
                # The release exists but the .swarm didn't attach. Report it so
                # the user can retry rather than believing the artifact shipped.
                return False, _github_message(
                    asset,
                    f"Release {version} was created, but attaching the .swarm failed "
                    f"({asset.status_code}). You can delete it on GitHub and retry.",
                )
            asset_data = asset.json()
    except httpx.HTTPError as exc:
        return False, f"Couldn't reach GitHub: {exc}"

    debug(owner, repo, version, len(blob))
    return True, {
        "version": version,
        "tag": version,
        "html_url": release.get("html_url"),
        "asset_url": asset_data.get("browser_download_url"),
        "asset_name": asset_data.get("name"),
        "asset_size": asset_data.get("size"),
        "sha": head,
    }


@typechecked
def _github_message(res: "httpx.Response", fallback: str) -> str:
    try:
        msg = res.json().get("message")
    except ValueError:
        msg = None
    return str(msg) if msg else fallback
