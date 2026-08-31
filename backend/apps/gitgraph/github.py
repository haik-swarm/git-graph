"""Giving each app workspace its own private GitHub repo.

The GitHub credential is the one the user already connected to OpenSwarm
(Settings > the GitHub integration), read from the shared tools registry.
Nothing is copied into this workspace, so revoking the integration
revokes this app too.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from typeguard import typechecked

from backend.apps.gitgraph.discovery import (
    _run_git,
    _run_git_result,
    openswarm_data_dir,
)

API_ROOT = "https://api.github.com"
_HTTP_TIMEOUT = 20

# A background sync touches every app at once, so one unreachable remote
# must not hold the whole sweep open for the full network budget.
_FETCH_TIMEOUT = 25

# git asks the helper for credentials on stdin/stdout rather than reading a
# file, so the token reaches git through the environment and never lands on
# disk or in a command line that `ps` would show.
_CREDENTIAL_HELPER = (
    '!f() { test "$1" = get && '
    'echo username=x-access-token && '
    'echo "password=$GITGRAPH_GITHUB_TOKEN"; }; f'
)


@typechecked
def _credential_args() -> List[str]:
    """Force git to use OUR token and nothing else.

    Helpers are cumulative and consulted in order, so on a machine with a
    global osxkeychain entry for github.com that one answers first. If it
    holds a credential for a different account, GitHub reports a private
    repo as "not found" and the real token is never tried. The empty value
    resets the inherited list, leaving ours as the only helper.
    """
    return [
        "-c",
        "credential.helper=",
        "-c",
        f"credential.helper={_CREDENTIAL_HELPER}",
    ]


@typechecked
def read_token() -> Optional[str]:
    """The access token from the user's connected GitHub tool, if any."""
    tools_dir = openswarm_data_dir() / "tools"
    if not tools_dir.is_dir():
        return None

    for entry in sorted(tools_dir.glob("*.json")):
        try:
            tool = json.loads(entry.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(tool, dict):
            continue
        if str(tool.get("name", "")).strip().lower() != "github":
            continue
        token = (tool.get("oauth_tokens") or {}).get("access_token")
        if isinstance(token, str) and token:
            return token
    return None


@typechecked
def _account_label() -> Optional[str]:
    tools_dir = openswarm_data_dir() / "tools"
    if not tools_dir.is_dir():
        return None
    for entry in sorted(tools_dir.glob("*.json")):
        try:
            tool = json.loads(entry.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(tool, dict):
            continue
        if str(tool.get("name", "")).strip().lower() != "github":
            continue
        if (tool.get("oauth_tokens") or {}).get("access_token"):
            label = tool.get("connected_account_email")
            return label if isinstance(label, str) and label else None
    return None


@typechecked
def connection_state() -> Dict[str, Any]:
    """Whether the GitHub integration is installed at all, independent of any one
    workspace. The whole module reaches GitHub through the token the user's
    connected "github" tool exposes; with no such tool, every per-app repo action
    would fail the same way, so the Settings page surfaces this once, up front.
    """
    return {"connected": bool(read_token()), "account": _account_label()}


@typechecked
def _headers(token: str) -> Dict[str, str]:
    return {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


@typechecked
def slugify(name: str) -> str:
    """An app's display name as a repo name GitHub will accept."""
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", name).strip("-._").lower()
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:90] or "openswarm-app"


@typechecked
def parse_remote(url: str) -> Optional[Tuple[str, str]]:
    """(owner, repo) from either an https or ssh GitHub remote."""
    cleaned = url.strip()
    if cleaned.endswith(".git"):
        cleaned = cleaned[: -len(".git")]
    match = re.search(r"github\.com[:/]+([^/]+)/([^/]+)$", cleaned)
    if not match:
        return None
    return match.group(1), match.group(2)


@typechecked
def remote_url(path: Path) -> Optional[str]:
    url = _run_git(["remote", "get-url", "origin"], path)
    return (url or "").strip() or None


@typechecked
def _unpushed_count(path: Path, branch: Optional[str]) -> Optional[int]:
    """Commits on `branch` that origin doesn't have yet.

    Counted against the local remote-tracking ref, without fetching: the
    status call runs on every app switch, and a network round trip there
    would make the picker feel broken on a slow connection.
    """
    if not branch:
        return None
    if _run_git(["rev-parse", "--verify", f"refs/remotes/origin/{branch}"], path) is None:
        return None
    raw = _run_git(["rev-list", "--count", f"origin/{branch}..HEAD"], path)
    if raw is None:
        return None
    try:
        return int(raw.strip())
    except ValueError:
        return None


@typechecked
def _local_commit_count(path: Path) -> int:
    raw = _run_git(["rev-list", "--count", "HEAD"], path)
    try:
        return int((raw or "0").strip())
    except ValueError:
        return 0


@typechecked
def _behind_count(path: Path, branch: Optional[str]) -> Optional[int]:
    """Commits origin has that we don't, counted without fetching.

    Same no-network rule as `_unpushed_count`: this feeds a badge that
    renders on every app switch. `fetch_remote` is what makes it current.
    """
    if not branch:
        return None
    if _run_git(["rev-parse", "--verify", f"refs/remotes/origin/{branch}"], path) is None:
        return None
    raw = _run_git(["rev-list", "--count", f"HEAD..origin/{branch}"], path)
    if raw is None:
        return None
    try:
        return int(raw.strip())
    except ValueError:
        return None


@typechecked
def rebase_in_progress(path: Path) -> bool:
    """Whether a rebase is stopped partway, waiting on the user.

    git uses one of two state directories depending on which rebase
    backend ran, and checking only one of them reports a repo mid-conflict
    as clean, which would let the UI offer a pull that cannot start.
    """
    git_dir = path / ".git"
    return (git_dir / "rebase-merge").is_dir() or (git_dir / "rebase-apply").is_dir()


@typechecked
def _conflicted_paths(path: Path) -> List[str]:
    """Files with unresolved conflict markers, as git reports them."""
    raw = _run_git(["diff", "--name-only", "--diff-filter=U"], path)
    return [line for line in (raw or "").splitlines() if line.strip()]


@typechecked
def status(path: Path, app_name: str) -> Dict[str, Any]:
    """Everything the push UI needs for one workspace, in one call."""
    token = read_token()
    is_repo = (path / ".git").is_dir()
    branch = (_run_git(["branch", "--show-current"], path) or "").strip() or None
    url = remote_url(path) if is_repo else None
    parsed = parse_remote(url) if url else None
    commits = _local_commit_count(path) if is_repo else 0
    unpushed = _unpushed_count(path, branch) if url else None
    behind = _behind_count(path, branch) if url else None

    return {
        "connected": bool(token),
        "account": _account_label(),
        "is_repo": is_repo,
        "branch": branch,
        "remote_url": url,
        "owner": parsed[0] if parsed else None,
        "repo": parsed[1] if parsed else None,
        "html_url": f"https://github.com/{parsed[0]}/{parsed[1]}" if parsed else None,
        "commit_count": commits,
        # None means origin has never been seen locally, so every commit is
        # new to it; the UI says "push" rather than a misleading "0 to push".
        "unpushed": commits if url and unpushed is None else unpushed,
        "behind": behind or 0,
        "has_remote": bool(url),
        "rebase_in_progress": rebase_in_progress(path) if is_repo else False,
        "conflicts": _conflicted_paths(path) if is_repo else [],
    }


@typechecked
async def _repo_exists(client: httpx.AsyncClient, token: str, owner: str, name: str) -> bool:
    res = await client.get(f"{API_ROOT}/repos/{owner}/{name}", headers=_headers(token))
    return res.status_code == 200


@typechecked
async def create_repo(
    path: Path, app_name: str, requested_name: Optional[str] = None
) -> Tuple[bool, Any]:
    """Create a private repo for this workspace and wire it up as origin."""
    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."
    if not (path / ".git").is_dir():
        return False, "This workspace isn't a git repository."
    if remote_url(path):
        return False, "This workspace already has a remote."

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        me = await client.get(f"{API_ROOT}/user", headers=_headers(token))
        if me.status_code != 200:
            return False, "GitHub rejected the stored token. Reconnect the integration."
        owner = me.json().get("login")
        if not owner:
            return False, "Couldn't read the GitHub account."

        base = slugify(requested_name or app_name)
        name = base
        # A name already in use would come back as a 422 that reads like a
        # validation bug, so a free one is picked up front instead.
        for suffix in range(2, 12):
            if not await _repo_exists(client, token, owner, name):
                break
            name = f"{base}-{suffix}"
        else:
            return False, f"Every name from {base} to {base}-11 is taken."

        created = await client.post(
            f"{API_ROOT}/user/repos",
            headers=_headers(token),
            json={
                "name": name,
                "private": True,
                "description": f"OpenSwarm app: {app_name}",
                "auto_init": False,
            },
        )
        if created.status_code not in (200, 201):
            detail = ""
            try:
                detail = created.json().get("message", "")
            except ValueError:
                pass
            return False, detail or f"GitHub returned {created.status_code}."

        repo = created.json()

    ok, _, err = _run_git_result(
        ["remote", "add", "origin", repo.get("clone_url", "")], path
    )
    if not ok:
        return False, err.strip() or "Couldn't add the remote."

    return True, {
        "owner": owner,
        "repo": name,
        "html_url": repo.get("html_url", f"https://github.com/{owner}/{name}"),
        "private": bool(repo.get("private", True)),
    }


@typechecked
async def update_description(path: Path, app_name: str) -> Tuple[bool, str]:
    """Repoint the repo's description at a new display name.

    The description prefix ("OpenSwarm app: ...") is the only durable signal
    that a repo is one of ours (see list_openswarm_repos), so a rename has to
    keep it in step or the app drops out of Your cloud.
    """
    token = read_token()
    if not token:
        return False, "GitHub isn't connected."
    url = remote_url(path)
    if not url:
        return False, "This workspace has no GitHub repo yet."
    parsed = parse_remote(url)
    if not parsed:
        return False, "Couldn't read the GitHub repo from the remote URL."
    owner, repo = parsed

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        res = await client.patch(
            f"{API_ROOT}/repos/{owner}/{repo}",
            headers=_headers(token),
            json={"description": f"OpenSwarm app: {app_name}"},
        )
    if res.status_code != 200:
        detail = ""
        try:
            detail = res.json().get("message", "")
        except ValueError:
            pass
        return False, detail or f"GitHub returned {res.status_code}."
    return True, "ok"


@typechecked
async def rename_repo(path: Path, new_display_name: str) -> Tuple[bool, Any]:
    """Rename the GitHub repo to match a new display name and re-point origin.

    Safe by construction: GitHub keeps a permanent redirect from the old
    name, so collaborators' existing clones keep fetching and pushing
    untouched. The redirect only dies if the old name is later reclaimed, and
    a free slug is picked here the same way create_repo does, so this can
    never squat the name it just vacated.

    Returns ok=True with {"unchanged": True} when the slug already matches, so
    the caller can treat "nothing to do" as success rather than an error.
    """
    token = read_token()
    if not token:
        return False, "GitHub isn't connected."
    url = remote_url(path)
    if not url:
        return False, "This workspace has no GitHub repo yet."
    parsed = parse_remote(url)
    if not parsed:
        return False, "Couldn't read the GitHub repo from the remote URL."
    owner, repo = parsed

    desired = slugify(new_display_name)
    if desired == repo.lower():
        return True, {
            "owner": owner,
            "repo": repo,
            "old_repo": repo,
            "unchanged": True,
            "html_url": f"https://github.com/{owner}/{repo}",
        }

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        name = desired
        for suffix in range(2, 12):
            if not await _repo_exists(client, token, owner, name):
                break
            name = f"{desired}-{suffix}"
        else:
            return False, f"Every name from {desired} to {desired}-11 is taken."

        res = await client.patch(
            f"{API_ROOT}/repos/{owner}/{repo}",
            headers=_headers(token),
            json={"name": name},
        )
        if res.status_code != 200:
            detail = ""
            try:
                detail = res.json().get("message", "")
            except ValueError:
                pass
            return False, detail or f"GitHub returned {res.status_code}."
        data = res.json()

    # GitHub has renamed; the local remote still points at the old URL until
    # we move it. If this fails the repo is renamed but origin is stale — the
    # redirect keeps pushes working, but we report it so the user knows.
    new_url = data.get("clone_url") or f"https://github.com/{owner}/{name}.git"
    ok, _, err = _run_git_result(["remote", "set-url", "origin", new_url], path)
    if not ok:
        return False, (
            err.strip()
            or "Renamed on GitHub, but couldn't update the local remote URL."
        )

    return True, {
        "owner": owner,
        "repo": name,
        "old_repo": repo,
        "unchanged": False,
        "html_url": data.get("html_url", f"https://github.com/{owner}/{name}"),
    }


@typechecked
def push(path: Path) -> Tuple[bool, Any]:
    """Push the current branch to origin, setting upstream on first push."""
    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."
    url = remote_url(path)
    if not url:
        return False, "This workspace has no GitHub repo yet."

    branch = (_run_git(["branch", "--show-current"], path) or "").strip()
    if not branch:
        return False, "No branch is checked out."
    if _local_commit_count(path) == 0:
        return False, "Nothing to push: this repo has no commits yet."

    ok, _, err = _run_git_result(
        [
            *_credential_args(),
            "push",
            "--set-upstream",
            "origin",
            branch,
        ],
        path,
        env={"GITGRAPH_GITHUB_TOKEN": token, "GIT_TERMINAL_PROMPT": "0"},
    )
    if not ok:
        lines = [ln for ln in err.strip().splitlines() if ln.strip()]
        # git narrates the whole push on stderr; the failure is the last line.
        return False, lines[-1] if lines else "git push failed."

    parsed = parse_remote(url)
    return True, {
        "branch": branch,
        "html_url": f"https://github.com/{parsed[0]}/{parsed[1]}" if parsed else url,
    }


@typechecked
def pull(path: Path) -> Tuple[bool, Any]:
    """Fetch origin and replay local commits on top of it.

    Rebase rather than merge so a shared app's history stays a straight
    line instead of accumulating a merge commit every time two people
    touch it.

    Refuses to start on a dirty worktree. Rebase aborts on unstaged
    changes anyway, but its own error is opaque, and auto-stashing here
    would silently move work the user never asked us to touch. The UI
    turns this into "commit or discard first", which keeps the choice
    theirs.

    A conflict is NOT a failure: git stops with the rebase half-applied
    and the conflicted files marked, which is a state the user can
    legitimately finish by hand. That comes back as ok=False with
    `conflicts` populated so the UI can offer Abort rather than pretending
    the pull merely errored.
    """
    if not (path / ".git").is_dir():
        return False, "Not a git repository."
    token = read_token()
    if not token:
        return False, "Connect the GitHub integration in OpenSwarm settings first."
    url = remote_url(path)
    if not url:
        return False, "This workspace has no GitHub repo yet."

    if rebase_in_progress(path):
        return False, {
            "detail": "A rebase is already in progress here.",
            "conflicts": _conflicted_paths(path),
            "rebase_in_progress": True,
        }

    branch = (_run_git(["branch", "--show-current"], path) or "").strip()
    if not branch:
        return False, "No branch is checked out."

    dirty = _run_git(["status", "--porcelain"], path)
    if (dirty or "").strip():
        return False, "You have uncommitted changes. Commit or discard them first."

    ok, _, err = _run_git_result(
        [*_credential_args(), "fetch", "--prune", "--quiet", "origin"],
        path,
        env={"GITGRAPH_GITHUB_TOKEN": token, "GIT_TERMINAL_PROMPT": "0"},
        timeout=_FETCH_TIMEOUT,
    )
    if not ok:
        lines = [ln for ln in err.strip().splitlines() if ln.strip()]
        return False, lines[-1] if lines else "git fetch failed."

    if _run_git(["rev-parse", "--verify", f"refs/remotes/origin/{branch}"], path) is None:
        return False, f"origin has no branch called {branch} yet."

    behind = _behind_count(path, branch) or 0
    if behind == 0:
        return True, {"branch": branch, "applied": 0, "already_current": True}

    ok, _, err = _run_git_result(["rebase", f"origin/{branch}"], path)
    if not ok:
        conflicts = _conflicted_paths(path)
        if conflicts or rebase_in_progress(path):
            return False, {
                "detail": "This app changed in the same places on both sides.",
                "conflicts": conflicts,
                "rebase_in_progress": True,
            }
        lines = [ln for ln in err.strip().splitlines() if ln.strip()]
        return False, lines[-1] if lines else "git rebase failed."

    return True, {"branch": branch, "applied": behind, "already_current": False}


@typechecked
def abort_rebase(path: Path) -> Tuple[bool, Any]:
    """Unwind a conflicted rebase, putting the branch back where it was."""
    if not rebase_in_progress(path):
        return False, "No rebase is in progress."
    ok, _, err = _run_git_result(["rebase", "--abort"], path)
    if not ok:
        lines = [ln for ln in err.strip().splitlines() if ln.strip()]
        return False, lines[-1] if lines else "Couldn't abort the rebase."
    return True, {"status": "aborted"}


@typechecked
def fetch_remote(path: Path) -> Tuple[bool, str]:
    """Update origin's remote-tracking refs so `unpushed` reflects reality.

    Every other read in this module counts against the local
    `refs/remotes/origin/*`, which only moves when something fetches. Push
    or pull from another machine (or the terminal) and the local ref stays
    behind, so the grid reports commits as outstanding that GitHub already
    has. This is the only call here that touches the network on a read
    path, which is why it is deliberately NOT part of `status`.
    """
    if not (path / ".git").is_dir():
        return False, "Not a git repository."
    token = read_token()
    if not token:
        return False, "GitHub isn't connected."
    if not remote_url(path):
        return False, "This workspace has no GitHub repo yet."

    ok, _, err = _run_git_result(
        [*_credential_args(), "fetch", "--prune", "--quiet", "origin"],
        path,
        env={"GITGRAPH_GITHUB_TOKEN": token, "GIT_TERMINAL_PROMPT": "0"},
        timeout=_FETCH_TIMEOUT,
    )
    if not ok:
        lines = [ln for ln in err.strip().splitlines() if ln.strip()]
        return False, lines[-1] if lines else "git fetch failed."
    return True, "ok"


@typechecked
def disconnect(path: Path) -> Tuple[bool, str]:
    """Drop the remote locally. The GitHub repo itself is left alone."""
    if not remote_url(path):
        return False, "This workspace has no remote."
    ok, _, err = _run_git_result(["remote", "remove", "origin"], path)
    if not ok:
        return False, err.strip() or "Couldn't remove the remote."
    return True, "ok"
