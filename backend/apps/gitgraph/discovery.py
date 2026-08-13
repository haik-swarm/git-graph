"""Locating the user's apps and reading their git history.

App metadata and app source live in two different places: the registry
under `data/outputs/*.json` names each app and points at a workspace id,
while the code itself sits in `data/outputs_workspace/<id>/`. Neither is
inside this app's workspace, so every path here is resolved from the
OpenSwarm data directory rather than relative to __file__.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from typeguard import typechecked

# A commit is emitted as a single line of unit-separated fields, which
# avoids trying to re-parse git's human-readable log format.
_SEP = "\x1f"
_LOG_FORMAT = _SEP.join(["%H", "%h", "%P", "%an", "%aI", "%s", "%D"])

# Enough to draw a meaningful graph without stalling the UI on a repo
# that has genuinely deep history.
MAX_COMMITS = 500

_GIT_TIMEOUT = 15

# Pushing waits on the network and on GitHub's side of the handshake, which
# a local-only budget would cut off mid-transfer.
_GIT_NETWORK_TIMEOUT = 120


@typechecked
def openswarm_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/OpenSwarm/data"
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData/Roaming")
        return Path(base) / "OpenSwarm/data"
    return Path(
        os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
    ) / "OpenSwarm/data"


@typechecked
def _run_git_result(
    args: List[str], cwd: Path, env: Optional[Dict[str, str]] = None
) -> Tuple[bool, str, str]:
    """Run git and return (succeeded, stdout, stderr).

    Writing commands need git's own diagnostics — an unset user.email or a
    pre-commit hook rejection is only explainable by quoting stderr back.
    `env` is merged over the inherited environment, which is how a token
    reaches a credential helper without appearing in the command line.
    """
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=_GIT_TIMEOUT if env is None else _GIT_NETWORK_TIMEOUT,
            env={**os.environ, **env} if env else None,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, "", str(exc)
    return (
        proc.returncode == 0,
        proc.stdout.decode("utf-8", errors="replace"),
        proc.stderr.decode("utf-8", errors="replace"),
    )


@typechecked
def _run_git(args: List[str], cwd: Path) -> Optional[str]:
    """Returns stdout, or None for any failure.

    Callers treat None as "this repo can't answer that" rather than an
    error, because a workspace with no commits is a normal state here,
    not an exceptional one.
    """
    ok, out, _ = _run_git_result(args, cwd)
    return out if ok else None


@typechecked
def list_apps() -> List[Dict[str, Any]]:
    """Every registered app, newest first, annotated with git availability.

    Apps whose workspace directory has gone missing are still listed, so
    a stale registry entry shows up as an explicitly broken row instead
    of silently vanishing from the picker.
    """
    data_dir = openswarm_data_dir()
    outputs = data_dir / "outputs"
    workspaces = data_dir / "outputs_workspace"

    apps: List[Dict[str, Any]] = []
    if not outputs.is_dir():
        return apps

    for entry in sorted(outputs.glob("*.json")):
        try:
            meta = json.loads(entry.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(meta, dict):
            continue

        workspace_id = meta.get("workspace_id")
        if not isinstance(workspace_id, str) or not workspace_id:
            continue

        ws_path = workspaces / workspace_id
        exists = ws_path.is_dir()
        has_git = exists and (ws_path / ".git").is_dir()

        apps.append(
            {
                "id": meta.get("id") or workspace_id,
                "name": meta.get("name") or "Untitled app",
                "description": meta.get("description") or "",
                "icon": meta.get("icon") or "",
                "workspace_id": workspace_id,
                "workspace_exists": exists,
                "has_git": has_git,
                "updated_at": meta.get("updated_at") or "",
            }
        )

    apps.sort(key=lambda a: a["updated_at"], reverse=True)
    return apps


@typechecked
def workspace_path(workspace_id: str) -> Optional[Path]:
    """Resolve a workspace id, refusing anything that escapes the root.

    The id arrives from the client, so it is validated as a direct child
    of the workspace root; `..` or an absolute path would otherwise let a
    caller point git at any directory on disk.
    """
    root = (openswarm_data_dir() / "outputs_workspace").resolve()
    candidate = (root / workspace_id).resolve()
    if candidate.parent != root or not candidate.is_dir():
        return None
    return candidate


@typechecked
def _parse_refs(raw: str) -> List[str]:
    """Split %D into individual ref labels, dropping the HEAD arrow."""
    refs: List[str] = []
    for part in raw.split(","):
        label = part.strip()
        if not label:
            continue
        if label.startswith("HEAD -> "):
            label = label[len("HEAD -> "):]
        refs.append(label)
    return refs


@typechecked
def read_dirty(path: Path) -> List[Dict[str, Any]]:
    """Working-tree changes, one entry per path.

    `-z` rather than plain porcelain because git otherwise quotes and
    escapes paths containing spaces or non-ASCII, and those quoted names
    won't match when they come back as a pathspec to commit.
    """
    raw = _run_git(["status", "--porcelain", "-z"], path)
    if raw is None:
        return []

    # -z emits "XY <path>\0", except renames which append the source path
    # as its own record: "R. <new>\0<old>\0".
    records = [r for r in raw.split("\0") if r]
    dirty: List[Dict[str, Any]] = []
    i = 0
    while i < len(records):
        record = records[i]
        i += 1
        if len(record) < 4:
            continue
        code = record[:2]
        entry: Dict[str, Any] = {
            "code": code.strip(),
            # Second column is the worktree: anything but a space means
            # there's a change the index hasn't picked up yet.
            "unstaged": code[1] != " ",
            "path": record[3:],
        }
        if code[0] in "RC" and i < len(records):
            entry["orig_path"] = records[i]
            i += 1
        dirty.append(entry)
    return dirty


@typechecked
def commit_paths(
    path: Path, message: str, paths: List[str]
) -> Tuple[bool, str]:
    """Commit exactly `paths`, leaving every other pending change alone.

    Only paths git currently reports as dirty are accepted: the pathspec
    reaches the command line, so restricting it to a set the repo itself
    just produced keeps a crafted request from touching unrelated files.
    """
    message = message.strip()
    if not message:
        return False, "A commit message is required."
    if not (path / ".git").is_dir():
        return False, "This workspace isn't a git repository."

    # A rename is one selectable row but two pathspecs, and its source no
    # longer exists on disk. `git add` would abort on that missing path,
    # so sources are committed without being re-added; the rename is
    # already staged in full by whatever produced it.
    addable: Dict[str, bool] = {}
    rename_sources: Dict[str, str] = {}
    for entry in read_dirty(path):
        addable[entry["path"]] = entry["unstaged"]
        if "orig_path" in entry:
            rename_sources[entry["path"]] = entry["orig_path"]

    targets: List[str] = []
    to_add: List[str] = []
    for p in paths:
        if p not in addable or p in targets:
            continue
        targets.append(p)
        if addable[p]:
            to_add.append(p)
        if p in rename_sources:
            targets.append(rename_sources[p])

    if not targets:
        return False, "None of those files have pending changes."

    if to_add:
        ok, _, err = _run_git_result(["add", "--", *to_add], path)
        if not ok:
            return False, err.strip() or "git add failed."

    ok, out, err = _run_git_result(
        ["commit", "--only", "-m", message, "--", *targets], path
    )
    if not ok:
        detail = (err.strip() or out.strip()).strip().splitlines()
        return False, detail[0] if detail else "git commit failed."

    sha = (_run_git(["rev-parse", "HEAD"], path) or "").strip()
    return True, sha


@typechecked
def read_graph(path: Path) -> Dict[str, Any]:
    """Commit list plus working-tree state for one workspace.

    `--all` so commits on other branches appear, `--date-order` so the
    result reads chronologically rather than in traversal order.
    """
    if not (path / ".git").is_dir():
        return {
            "is_repo": False,
            "commits": [],
            "branches": [],
            "current_branch": None,
            "dirty": [],
            "truncated": False,
        }

    raw = _run_git(
        [
            "log",
            "--all",
            "--date-order",
            f"--max-count={MAX_COMMITS + 1}",
            f"--pretty=format:{_LOG_FORMAT}",
        ],
        path,
    )

    commits: List[Dict[str, Any]] = []
    for line in (raw or "").splitlines():
        if not line.strip():
            continue
        fields = line.split(_SEP)
        if len(fields) < 7:
            continue
        sha, short, parents, author, date, subject, refs = fields[:7]
        commits.append(
            {
                "sha": sha,
                "short": short,
                "parents": parents.split() if parents.strip() else [],
                "author": author,
                "date": date,
                "subject": subject,
                "refs": _parse_refs(refs),
            }
        )

    truncated = len(commits) > MAX_COMMITS
    if truncated:
        commits = commits[:MAX_COMMITS]

    branch_raw = _run_git(["branch", "--format=%(refname:short)"], path)
    branches = [b.strip() for b in (branch_raw or "").splitlines() if b.strip()]

    current = _run_git(["branch", "--show-current"], path)
    current_branch = (current or "").strip() or None

    dirty = read_dirty(path)

    return {
        "is_repo": True,
        "commits": commits,
        "branches": branches,
        "current_branch": current_branch,
        "dirty": dirty,
        "truncated": truncated,
    }


@typechecked
def read_commit_detail(path: Path, sha: str) -> Optional[Dict[str, Any]]:
    """Per-file stats for one commit.

    The sha is validated as hex before being passed to git so a crafted
    value can't be read as a flag or a revision expression.
    """
    if not sha or len(sha) > 40 or not all(ch in "0123456789abcdefABCDEF" for ch in sha):
        return None
    if not (path / ".git").is_dir():
        return None

    raw = _run_git(
        ["show", "--numstat", "--format=", "--no-color", sha],
        path,
    )
    if raw is None:
        return None

    files: List[Dict[str, Any]] = []
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        added, removed, name = parts
        # Binary files report "-" instead of a count.
        files.append(
            {
                "path": name,
                "added": None if added == "-" else int(added),
                "removed": None if removed == "-" else int(removed),
            }
        )

    return {"sha": sha, "files": files}
