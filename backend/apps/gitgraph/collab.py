"""Letting other people into an app's repo.

An app's repo is private to the account that made it, so sharing one means
adding a GitHub collaborator: `PUT /repos/{owner}/{repo}/collaborators`
sends an invite, the other person accepts on GitHub, and the repo then
shows up in their Cloud sheet and installs like any other app.

Invites and collaborators are different resources on GitHub's side. Someone
invited but not yet accepted appears ONLY in `/invitations`, never in
`/collaborators`, so listing just the latter makes a pending invite look
like it silently failed. Both are read here and merged into one list with a
`pending` flag.

The credential is the user's connected GitHub integration, same as
everywhere else in this app; nothing is stored in the workspace.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from typeguard import typechecked

from backend.apps.gitgraph.github import (
    API_ROOT,
    _headers,
    parse_remote,
    read_token,
    remote_url,
)

_HTTP_TIMEOUT = 20

# GitHub's permission values for a personal (non-org) repo.
_VALID_PERMISSIONS = ("pull", "push", "admin")


@typechecked
def _repo_slug(path: Path) -> Optional[Tuple[str, str]]:
    url = remote_url(path)
    if not url:
        return None
    return parse_remote(url)


@typechecked
async def _viewer_login(client: httpx.AsyncClient, token: str) -> Optional[str]:
    res = await client.get(f"{API_ROOT}/user", headers=_headers(token))
    if res.status_code != 200:
        return None
    login = res.json().get("login")
    return login if isinstance(login, str) and login else None


@typechecked
async def list_people(path: Path) -> Dict[str, Any]:
    """Everyone with access to this app's repo, accepted and pending.

    Returns `{connected, has_remote, people, viewer, can_manage}`. Only an
    admin can invite or remove, so `can_manage` decides whether the UI
    offers those controls at all rather than letting the user discover it
    through a 403.
    """
    token = read_token()
    if not token:
        return {"connected": False, "has_remote": False, "people": [], "viewer": None, "can_manage": False}

    slug = _repo_slug(path)
    if not slug:
        return {"connected": True, "has_remote": False, "people": [], "viewer": None, "can_manage": False}

    owner, repo = slug
    people: List[Dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        viewer = await _viewer_login(client, token)

        res = await client.get(
            f"{API_ROOT}/repos/{owner}/{repo}/collaborators",
            headers=_headers(token),
            params={"per_page": 100},
        )
        if res.status_code == 404:
            return {
                "connected": True,
                "has_remote": True,
                "people": [],
                "viewer": viewer,
                "can_manage": False,
                "error": "That repo is gone, or this account can't see it.",
            }
        if res.status_code != 200:
            return {
                "connected": True,
                "has_remote": True,
                "people": [],
                "viewer": viewer,
                "can_manage": False,
                "error": f"GitHub returned {res.status_code}.",
            }

        for user in res.json() if isinstance(res.json(), list) else []:
            if not isinstance(user, dict):
                continue
            perms = user.get("permissions") or {}
            people.append(
                {
                    "login": user.get("login"),
                    "avatar_url": user.get("avatar_url"),
                    "html_url": user.get("html_url"),
                    "role": user.get("role_name") or ("admin" if perms.get("admin") else "write"),
                    "is_owner": user.get("login") == owner,
                    "is_viewer": bool(viewer and user.get("login") == viewer),
                    "pending": False,
                    "invitation_id": None,
                }
            )

        # Pending invites live on a separate resource and are invisible above.
        inv = await client.get(
            f"{API_ROOT}/repos/{owner}/{repo}/invitations",
            headers=_headers(token),
            params={"per_page": 100},
        )
        if inv.status_code == 200 and isinstance(inv.json(), list):
            for invite in inv.json():
                if not isinstance(invite, dict):
                    continue
                invitee = invite.get("invitee") or {}
                people.append(
                    {
                        "login": invitee.get("login"),
                        "avatar_url": invitee.get("avatar_url"),
                        "html_url": invitee.get("html_url"),
                        "role": invite.get("permissions") or "write",
                        "is_owner": False,
                        "is_viewer": False,
                        "pending": True,
                        "invitation_id": invite.get("id"),
                    }
                )

    viewer_entry = next((p for p in people if p["is_viewer"]), None)
    can_manage = bool(viewer and (viewer == owner or (viewer_entry or {}).get("role") == "admin"))

    return {
        "connected": True,
        "has_remote": True,
        "owner": owner,
        "repo": repo,
        "html_url": f"https://github.com/{owner}/{repo}",
        "people": people,
        "viewer": viewer,
        "can_manage": can_manage,
    }


@typechecked
async def _repo_sharing(
    client: httpx.AsyncClient, token: str, viewer: Optional[str], owner: str, repo: str
) -> Dict[str, Any]:
    """Sharing summary for one repo: who else is on it, and whose it is.

    Pending invites count as shared. Someone invited but not yet accepted
    is intent to share, and hiding those would make an app flip groups
    only once the other person got round to clicking accept.
    """
    others: List[str] = []
    pending = 0

    res = await client.get(
        f"{API_ROOT}/repos/{owner}/{repo}/collaborators",
        headers=_headers(token),
        params={"per_page": 100},
    )
    if res.status_code != 200:
        return {"known": False, "shared": False, "owner": owner, "theirs": False, "people": [], "pending": 0}

    for user in res.json() if isinstance(res.json(), list) else []:
        if not isinstance(user, dict):
            continue
        login = user.get("login")
        if login and login != viewer:
            others.append(login)

    inv = await client.get(
        f"{API_ROOT}/repos/{owner}/{repo}/invitations",
        headers=_headers(token),
        params={"per_page": 100},
    )
    if inv.status_code == 200 and isinstance(inv.json(), list):
        for invite_row in inv.json():
            if not isinstance(invite_row, dict):
                continue
            login = (invite_row.get("invitee") or {}).get("login")
            if login and login != viewer:
                others.append(login)
                pending += 1

    # Dedupe while keeping order: a person can appear as both a collaborator
    # and a leftover invitation row.
    seen: Dict[str, None] = {}
    for login in others:
        seen.setdefault(login, None)
    people = list(seen)

    return {
        "known": True,
        "shared": bool(people),
        "owner": owner,
        "theirs": bool(viewer and owner != viewer),
        "people": people,
        "pending": pending,
    }


@typechecked
async def sharing_all(paths: Dict[str, Path]) -> Dict[str, Any]:
    """Batch sharing state for every tracked app, keyed by workspace id.

    The rail groups Private vs Shared, which is a property of the GitHub
    repo rather than of the workspace, so it can only be read over the
    network. One client and one viewer lookup are shared across all apps
    and the per-repo reads run concurrently, since doing this serially for
    N apps would take longer than the user is willing to watch the rail
    sit ungrouped.

    Apps with no remote are answered locally as private without spending a
    request. Failures are per-app: an app whose read fails comes back
    `known: false` and the rail leaves it where it was rather than
    misfiling it as private.
    """
    token = read_token()
    if not token:
        return {"connected": False, "sharing": {}, "viewer": None}

    slugs: Dict[str, Optional[Tuple[str, str]]] = {
        wid: _repo_slug(path) for wid, path in paths.items()
    }
    # No remote means nobody else can be on it: private, no request needed.
    result: Dict[str, Any] = {
        wid: {"known": True, "shared": False, "owner": None, "theirs": False, "people": [], "pending": 0}
        for wid, slug in slugs.items()
        if slug is None
    }
    remote_apps = {wid: slug for wid, slug in slugs.items() if slug is not None}
    if not remote_apps:
        return {"connected": True, "sharing": result, "viewer": None}

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        viewer = await _viewer_login(client, token)

        async def one(wid: str, slug: Tuple[str, str]) -> Tuple[str, Dict[str, Any]]:
            owner, repo = slug
            try:
                return wid, await _repo_sharing(client, token, viewer, owner, repo)
            except httpx.HTTPError:
                # Unreachable or slow: unknown, not "private".
                return wid, {
                    "known": False,
                    "shared": False,
                    "owner": owner,
                    "theirs": False,
                    "people": [],
                    "pending": 0,
                }

        pairs = await asyncio.gather(*(one(wid, slug) for wid, slug in remote_apps.items()))

    for wid, data in pairs:
        result[wid] = data
    return {"connected": True, "sharing": result, "viewer": viewer}


@typechecked
async def invite(path: Path, username: str, permission: str = "push") -> Tuple[bool, Any]:
    """Invite `username` to this app's repo.

    GitHub answers 201 with an invitation for a new person and 204 when the
    user already had access; both are success, but only the first means an
    invite is now waiting to be accepted, and the UI says different things
    for each.
    """
    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."

    handle = username.strip().lstrip("@")
    if not handle:
        return False, "Enter a GitHub username."
    if permission not in _VALID_PERMISSIONS:
        return False, f"Unknown permission '{permission}'."

    slug = _repo_slug(path)
    if not slug:
        return False, "Publish this app to GitHub before inviting anyone."
    owner, repo = slug

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        exists = await client.get(f"{API_ROOT}/users/{handle}", headers=_headers(token))
        if exists.status_code == 404:
            return False, f"No GitHub user called '{handle}'."

        res = await client.put(
            f"{API_ROOT}/repos/{owner}/{repo}/collaborators/{handle}",
            headers=_headers(token),
            json={"permission": permission},
        )

    if res.status_code == 204:
        return True, {"login": handle, "pending": False, "already": True}
    if res.status_code in (200, 201):
        body = res.json() if res.content else {}
        return True, {
            "login": handle,
            "pending": True,
            "already": False,
            "invitation_id": body.get("id") if isinstance(body, dict) else None,
        }
    if res.status_code == 403:
        return False, "This account isn't an admin on that repo."
    detail = ""
    try:
        detail = res.json().get("message", "")
    except ValueError:
        pass
    return False, detail or f"GitHub returned {res.status_code}."


@typechecked
async def remove_person(path: Path, username: str) -> Tuple[bool, Any]:
    """Revoke access for an existing collaborator."""
    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."

    handle = username.strip().lstrip("@")
    if not handle:
        return False, "No username given."

    slug = _repo_slug(path)
    if not slug:
        return False, "This app has no GitHub repo."
    owner, repo = slug

    if handle == owner:
        return False, "The repo owner can't be removed."

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        res = await client.delete(
            f"{API_ROOT}/repos/{owner}/{repo}/collaborators/{handle}",
            headers=_headers(token),
        )
    if res.status_code in (204, 404):
        return True, {"login": handle}
    if res.status_code == 403:
        return False, "This account isn't an admin on that repo."
    return False, f"GitHub returned {res.status_code}."


@typechecked
async def revoke_invitation(path: Path, invitation_id: int) -> Tuple[bool, Any]:
    """Cancel an invite that hasn't been accepted yet.

    Pending invites aren't collaborators, so `remove_person` can't touch
    them; they have their own endpoint keyed by invitation id.
    """
    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."

    slug = _repo_slug(path)
    if not slug:
        return False, "This app has no GitHub repo."
    owner, repo = slug

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        res = await client.delete(
            f"{API_ROOT}/repos/{owner}/{repo}/invitations/{invitation_id}",
            headers=_headers(token),
        )
    if res.status_code in (204, 404):
        return True, {"invitation_id": invitation_id}
    if res.status_code == 403:
        return False, "This account isn't an admin on that repo."
    return False, f"GitHub returned {res.status_code}."
