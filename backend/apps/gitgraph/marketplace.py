"""The public side of the marketplace: browse it, and submit to it.

The marketplace IS a GitHub org. Every public repo under `os-marketplace`
whose description carries the usual `OpenSwarm app:` prefix is a listing,
so there's no index to maintain and no server of ours in the path, and
installing one is the same `cloud.install_repo()` call the Cloud sheet
already makes.

Submitting is deliberately lopsided: this app can only *ask*. It files an
issue on `os-marketplace/submissions` using the author's own token, which
is why attribution is free and why no org permission is needed (anyone
can open an issue on a public repo). Approving that issue happens in a
different app holding a different credential; nothing here can approve
anything, and that's enforced by GitHub rather than by us.

An app's repo is created private (`github.create_repo`), so publishing
also has to flip it public: the org has to be able to read it to fork it,
and it's headed for a public marketplace regardless.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from swarm_debug import debug
from typeguard import typechecked

from backend.apps.gitgraph import cloud
from backend.apps.gitgraph.github import (
    API_ROOT,
    _headers,
    parse_remote,
    read_token,
    remote_url,
)

MARKETPLACE_ORG = "os-marketplace"
SUBMISSIONS_REPO = "submissions"

# Shared with the management app. The label is the queue: an issue with
# `pending` is awaiting review, and approve/deny swap it for a terminal
# one. Kept as plain strings because GitHub labels are the only storage.
LABEL_PENDING = "pending"
LABEL_APPROVED = "approved"
LABEL_DENIED = "denied"

# What an issue is asking for. Submissions predate this field, so a
# payload without a `kind` is a submission; only takedowns say so.
KIND_SUBMISSION = "submission"
KIND_TAKEDOWN = "takedown"

# The submission body is written as a fenced JSON block so both a human
# reading the issue on github.com and the management app parse the same
# thing. Anything outside the block is prose for the reviewer.
_PAYLOAD_RE = re.compile(r"```json\s*\n(.*?)\n```", re.DOTALL)


@typechecked
def _slug(url: str) -> Optional[str]:
    parsed = parse_remote(url)
    return f"{parsed[0]}/{parsed[1]}" if parsed else None


@typechecked
def submission_payload(body: str) -> Optional[Dict[str, Any]]:
    """The JSON block an issue body carries, if it parses."""
    match = _PAYLOAD_RE.search(body or "")
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


@typechecked
async def list_listings() -> Dict[str, Any]:
    """Every public app repo in the marketplace org.

    Unauthenticated callers get 60 requests/hour from GitHub, which is
    enough to browse; the token is used when present purely for the
    higher ceiling. Browsing therefore works with no GitHub connected,
    though installing still needs one.
    """
    token = read_token()
    headers = _headers(token) if token else {"Accept": "application/vnd.github+json"}
    installed = cloud._installed_remotes()

    listings: List[Dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            page = 1
            while page <= 10:
                res = await client.get(
                    f"{API_ROOT}/orgs/{MARKETPLACE_ORG}/repos",
                    headers=headers,
                    params={"per_page": 100, "page": page, "type": "public"},
                )
                if res.status_code == 404:
                    return {
                        "ok": False,
                        "listings": [],
                        "error": f"The {MARKETPLACE_ORG} org isn't reachable.",
                    }
                if res.status_code == 403:
                    return {
                        "ok": False,
                        "listings": [],
                        "error": "GitHub rate-limited this request. Connect GitHub to raise the limit.",
                    }
                if res.status_code >= 400:
                    return {
                        "ok": False,
                        "listings": [],
                        "error": f"GitHub said {res.status_code}.",
                    }

                batch = res.json()
                if not isinstance(batch, list) or not batch:
                    break

                for repo in batch:
                    if repo.get("private") or repo.get("archived"):
                        continue
                    # The submissions repo lives in the same org but isn't a
                    # listing; the description prefix excludes it for free.
                    desc = repo.get("description") or ""
                    if not desc.startswith(cloud._OPENSWARM_DESCRIPTION_PREFIX):
                        continue
                    name = desc[len(cloud._OPENSWARM_DESCRIPTION_PREFIX):].strip()
                    full = (repo.get("full_name") or "").lower()
                    listings.append(
                        {
                            "name": name or repo.get("name"),
                            "repo": repo.get("name"),
                            "full_name": repo.get("full_name"),
                            "html_url": repo.get("html_url"),
                            "clone_url": repo.get("clone_url"),
                            "description": name or None,
                            "stars": repo.get("stargazers_count", 0),
                            "updated_at": repo.get("pushed_at") or repo.get("updated_at"),
                            "default_branch": repo.get("default_branch"),
                            # Filled in below; the list endpoint omits `parent`.
                            "author": None,
                            "author_url": None,
                            "fork": bool(repo.get("fork")),
                            "installed_workspace_id": installed.get(full),
                        }
                    )

                if len(batch) < 100:
                    break
                page += 1

            # `parent` only comes back from a single-repo GET, never from
            # the org listing, so author attribution costs one extra call
            # per fork. Failures here leave `author` null rather than
            # sinking the whole page: an unattributed listing still
            # installs fine.
            for listing in listings:
                if not listing["fork"]:
                    continue
                try:
                    res = await client.get(
                        f"{API_ROOT}/repos/{listing['full_name']}", headers=headers
                    )
                    if res.status_code != 200:
                        continue
                    owner = (res.json().get("parent") or {}).get("owner") or {}
                    listing["author"] = owner.get("login")
                    listing["author_url"] = owner.get("html_url")
                except httpx.HTTPError:
                    continue
    except httpx.HTTPError as exc:
        return {"ok": False, "listings": [], "error": f"Couldn't reach GitHub: {exc}"}

    listings.sort(key=lambda item: (item["updated_at"] or ""), reverse=True)
    debug(MARKETPLACE_ORG, len(listings))
    return {"ok": True, "listings": listings, "org_url": f"https://github.com/{MARKETPLACE_ORG}"}


@typechecked
async def _open_takedown(
    client: httpx.AsyncClient, token: str, slug: str
) -> Optional[Dict[str, Any]]:
    """An already-filed takedown request for `slug`, if one is open.

    Lists the issues rather than searching them. `/search/issues` is indexed
    asynchronously, so an issue filed seconds ago isn't findable yet, and a
    guard that can't see the request it's guarding against lets a duplicate
    straight through. The list endpoint reads the repo itself, so it's
    current the moment the issue exists.
    """
    res = await client.get(
        f"{API_ROOT}/repos/{MARKETPLACE_ORG}/{SUBMISSIONS_REPO}/issues",
        headers=_headers(token),
        params={"state": "open", "per_page": 100},
    )
    if res.status_code != 200:
        return None
    for item in res.json():
        if item.get("pull_request"):
            continue
        payload = submission_payload(item.get("body") or "")
        if not payload or payload.get("kind") != KIND_TAKEDOWN:
            continue
        if (payload.get("repo") or "").lower() == slug.lower():
            return {"number": item.get("number"), "url": item.get("html_url")}
    return None


@typechecked
async def request_takedown(path: Path, app_name: str, reason: str) -> tuple[bool, Any]:
    """Ask for this app to be pulled from the marketplace.

    The author can't do it themselves, and that isn't an oversight we can
    code around: the listing is a *fork owned by the org*, so the author's
    token reads it and nothing more. Only the org side can archive it.

    So this files a request the same way publishing does, which keeps the
    asymmetry honest: this app can ask, and the management app decides.
    """
    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."

    url = remote_url(path)
    slug = _slug(url) if url else None
    if not slug:
        return False, "This app has no GitHub remote, so it isn't listed."

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            existing = await _open_takedown(client, token, slug)
            if existing:
                return False, "You've already asked for this app to be taken down."

            note = reason.strip() or "No reason given."
            payload = {
                "kind": KIND_TAKEDOWN,
                "repo": slug,
                "app_name": app_name,
                "reason": note,
            }
            body = (
                f"The author is asking for this app to be removed from the "
                f"marketplace.\n\n**Reason:** {note}\n\n"
                f"**Repo:** https://github.com/{slug}\n\n"
                "<!-- Machine-readable payload; the management app reads this. -->\n"
                f"```json\n{json.dumps(payload, indent=2)}\n```\n"
            )
            res = await client.post(
                f"{API_ROOT}/repos/{MARKETPLACE_ORG}/{SUBMISSIONS_REPO}/issues",
                headers=_headers(token),
                json={"title": f"[takedown] {app_name}", "body": body},
            )
            if res.status_code == 404:
                return False, "The marketplace isn't accepting requests right now."
            if res.status_code >= 400:
                return False, f"GitHub said {res.status_code} filing the request."
            issue = res.json()
    except httpx.HTTPError as exc:
        return False, f"Couldn't reach GitHub: {exc}"

    debug(slug, issue.get("number"))
    return True, {"number": issue.get("number"), "html_url": issue.get("html_url")}


@typechecked
async def published_sweep() -> Dict[str, Any]:
    """{workspace_id -> listing} for every local app that's in the org.

    The join runs the opposite way to `installed_workspace_id`: that says
    "this listing is already on disk", whereas the rail needs "this app of
    mine is out there". A listing is a fork, so its `parent.full_name` is
    the author's own slug, which is exactly what a local app's origin
    remote points at.

    Archived listings are skipped, matching what shoppers see: an app the
    reviewer took down shouldn't still claim to be published.
    """
    token = read_token()
    headers = _headers(token) if token else {"Accept": "application/vnd.github+json"}
    installed = cloud._installed_remotes()
    if not installed:
        return {"connected": bool(token), "published": {}}

    published: Dict[str, Any] = {}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            page = 1
            while page <= 10:
                res = await client.get(
                    f"{API_ROOT}/orgs/{MARKETPLACE_ORG}/repos",
                    headers=headers,
                    params={"per_page": 100, "page": page, "type": "public"},
                )
                if res.status_code >= 400:
                    return {"connected": bool(token), "published": {}, "error": True}
                batch = res.json()
                if not isinstance(batch, list) or not batch:
                    break

                for repo in batch:
                    desc = repo.get("description") or ""
                    if repo.get("archived") or not desc.startswith(
                        cloud._OPENSWARM_DESCRIPTION_PREFIX
                    ):
                        continue
                    if not repo.get("fork"):
                        continue
                    # `parent` is absent from list responses, so the author's
                    # slug costs one GET per listing.
                    detail = await client.get(
                        f"{API_ROOT}/repos/{repo.get('full_name')}", headers=headers
                    )
                    if detail.status_code != 200:
                        continue
                    parent = (detail.json().get("parent") or {}).get("full_name") or ""
                    workspace_id = installed.get(parent.lower())
                    if not workspace_id:
                        continue
                    published[workspace_id] = {
                        "name": desc[len(cloud._OPENSWARM_DESCRIPTION_PREFIX):].strip()
                        or repo.get("name"),
                        "full_name": repo.get("full_name"),
                        "html_url": repo.get("html_url"),
                        "stars": repo.get("stargazers_count", 0),
                    }

                if len(batch) < 100:
                    break
                page += 1
    except httpx.HTTPError:
        return {"connected": bool(token), "published": {}, "error": True}

    debug(len(published))
    return {"connected": bool(token), "published": published}


@typechecked
async def _publish_state(
    client: httpx.AsyncClient, token: str, slug: str
) -> Dict[str, Any]:
    """Whether `slug` is already listed, or has an open request of either kind."""
    owner, repo = slug.split("/", 1)
    listed = False
    res = await client.get(
        f"{API_ROOT}/repos/{MARKETPLACE_ORG}/{repo}", headers=_headers(token)
    )
    if res.status_code == 200:
        body = res.json()
        parent = (body.get("parent") or {}).get("full_name") or ""
        # An archived fork is a fork that was taken down. Shoppers don't see
        # it, so the author shouldn't be told they're still listed and left
        # unable to re-submit; "listed" has to mean the same thing on both
        # sides of the glass.
        listed = parent.lower() == slug.lower() and not body.get("archived")

    # Listed, not searched: `/search/issues` lags behind by seconds to
    # minutes, so a request filed moments ago would read as absent and the
    # panel would offer to file it again.
    pending = None
    takedown = None
    res = await client.get(
        f"{API_ROOT}/repos/{MARKETPLACE_ORG}/{SUBMISSIONS_REPO}/issues",
        headers=_headers(token),
        params={"state": "open", "per_page": 100},
    )
    if res.status_code == 200:
        for item in res.json():
            if item.get("pull_request"):
                continue
            payload = submission_payload(item.get("body") or "")
            if not payload or (payload.get("repo") or "").lower() != slug.lower():
                continue
            ref = {"number": item.get("number"), "url": item.get("html_url")}
            if payload.get("kind") == KIND_TAKEDOWN:
                takedown = takedown or ref
            else:
                pending = pending or ref

    return {"listed": listed, "pending": pending, "takedown": takedown}


@typechecked
async def publish_status(path: Path) -> Dict[str, Any]:
    """Can this app be submitted, and has it been already?"""
    token = read_token()
    if not token:
        return {"connected": False, "eligible": False, "reason": "Connect GitHub first."}

    url = remote_url(path)
    if not url:
        return {
            "connected": True,
            "eligible": False,
            "reason": "Push this app to GitHub before submitting it.",
        }
    slug = _slug(url)
    if not slug:
        return {"connected": True, "eligible": False, "reason": "That remote isn't GitHub."}

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.get(f"{API_ROOT}/repos/{slug}", headers=_headers(token))
            if res.status_code >= 400:
                return {
                    "connected": True,
                    "eligible": False,
                    "reason": "This account can't read that repo.",
                }
            repo = res.json()
            # Only an admin can flip a repo public or accept a fork, so
            # someone else's shared app isn't theirs to submit.
            if not (repo.get("permissions") or {}).get("admin"):
                return {
                    "connected": True,
                    "eligible": False,
                    "slug": slug,
                    "reason": "Only the repo's owner can submit it.",
                }
            state = await _publish_state(client, token, slug)
    except httpx.HTTPError as exc:
        return {"connected": True, "eligible": False, "reason": f"Couldn't reach GitHub: {exc}"}

    return {
        "connected": True,
        "eligible": not state["listed"] and not state["pending"],
        "slug": slug,
        "is_public": not repo.get("private", True),
        "listed": state["listed"],
        "pending": state["pending"],
        "takedown": state["takedown"],
        "html_url": repo.get("html_url"),
    }


@typechecked
async def submit(path: Path, app_name: str, pitch: str) -> tuple[bool, Any]:
    """Make the repo public, then file a submission issue for review.

    Public-first ordering is deliberate: the reviewer can't evaluate a
    repo they can't open, so a submission that arrives before the repo is
    readable is just noise in the queue.
    """
    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."

    url = remote_url(path)
    slug = _slug(url) if url else None
    if not slug:
        return False, "Push this app to GitHub before submitting it."

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            state = await _publish_state(client, token, slug)
            if state["listed"]:
                return False, "That app is already in the marketplace."
            if state["pending"]:
                return False, "That app already has a submission awaiting review."

            res = await client.patch(
                f"{API_ROOT}/repos/{slug}",
                headers=_headers(token),
                json={"private": False},
            )
            if res.status_code >= 400:
                detail = ""
                try:
                    detail = res.json().get("message", "")
                except ValueError:
                    pass
                return False, f"Couldn't make the repo public. {detail}".strip()

            payload = {
                "kind": KIND_SUBMISSION,
                "repo": slug,
                "clone_url": f"https://github.com/{slug}.git",
                "app_name": app_name,
                "pitch": pitch,
            }
            body = (
                f"{pitch}\n\n"
                f"**Repo:** https://github.com/{slug}\n\n"
                "<!-- Machine-readable payload; the management app reads this. -->\n"
                f"```json\n{json.dumps(payload, indent=2)}\n```\n"
            )
            res = await client.post(
                f"{API_ROOT}/repos/{MARKETPLACE_ORG}/{SUBMISSIONS_REPO}/issues",
                headers=_headers(token),
                json={
                    "title": f"[app] {app_name}",
                    "body": body,
                    "labels": [LABEL_PENDING],
                },
            )
            if res.status_code == 404:
                return False, (
                    "The marketplace isn't accepting submissions yet "
                    f"({MARKETPLACE_ORG}/{SUBMISSIONS_REPO} doesn't exist)."
                )
            if res.status_code == 410:
                return False, "Submissions are closed on the marketplace repo."
            if res.status_code >= 400:
                return False, f"GitHub said {res.status_code} filing the request."
            issue = res.json()
    except httpx.HTTPError as exc:
        return False, f"Couldn't reach GitHub: {exc}"

    debug(slug, issue.get("number"))
    return True, {
        "number": issue.get("number"),
        "html_url": issue.get("html_url"),
        "slug": slug,
    }
