"""One shared .gitignore, mirrored into every tracked app.

The user edits ONE file (`gitgraph_global.gitignore` alongside the app
registry). Saving that file walks every tracked workspace and rewrites a
`# >>> openswarm-managed >>>` block at the top of its `.gitignore`; the
rest of that file — anything below the closing marker — is app-specific
and never touched. A per-app opt-out flag stored in
`gitgraph_global.opt_out.json` lets the user peel the block off a
workspace without losing the rules for the others.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from typeguard import typechecked

from backend.apps.gitgraph.discovery import (
    _run_git_result,
    list_apps,
    openswarm_data_dir,
    workspace_path,
)

_HEAD = "# >>> openswarm-managed (edit in Git Graph → Global .gitignore) >>>"
_TAIL = "# <<< openswarm-managed <<<"


@typechecked
def _global_path() -> Path:
    return openswarm_data_dir() / "gitgraph_global.gitignore"


@typechecked
def _opt_out_path() -> Path:
    return openswarm_data_dir() / "gitgraph_global.opt_out.json"


@typechecked
def _default_content() -> str:
    # Deliberately short: the value of "one shared list" is that it stays
    # readable, not that it enumerates every ecosystem on earth.
    return (
        "# Global rules shared across every tracked OpenSwarm app.\n"
        "# Edit here to add or remove rules for all of them at once.\n"
        "\n"
        ".DS_Store\n"
        "Thumbs.db\n"
        "*.log\n"
        "\n"
        "node_modules/\n"
        "dist/\n"
        "build/\n"
        ".venv/\n"
        "__pycache__/\n"
        "*.pyc\n"
        "\n"
        ".env\n"
        ".env.local\n"
        "\n"
        # A live SQLite file and its WAL are not consistent on disk without a
        # checkpoint, so a commit of the pair can capture a torn database.
        # These also grow without bound: one app reached 3.2GB here, which
        # timed out `git add` and left a stale index.lock behind.
        "*.db\n"
        "*.db-wal\n"
        "*.db-shm\n"
        "*.sqlite\n"
        "*.sqlite3\n"
    )


@typechecked
def load_global() -> str:
    path = _global_path()
    if not path.exists():
        content = _default_content()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        except OSError:
            pass
        return content
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


@typechecked
def _load_opt_out() -> Dict[str, bool]:
    path = _opt_out_path()
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {k: bool(v) for k, v in raw.items() if isinstance(k, str)}


@typechecked
def _save_opt_out(opt_out: Dict[str, bool]) -> None:
    path = _opt_out_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Only keep opted-out entries so the file doesn't grow monotonically
        # as apps come and go from the registry.
        trimmed = {k: True for k, v in opt_out.items() if v}
        path.write_text(json.dumps(trimmed, indent=2), encoding="utf-8")
    except OSError:
        pass


@typechecked
def _strip_managed(existing: str) -> str:
    """Return `existing` with any prior managed block removed.

    Deliberately tolerant of a partial or malformed block (missing tail,
    duplicate blocks from a botched previous write) so a manual edit that
    the user made in-file can be recovered from cleanly.
    """
    if _HEAD not in existing:
        return existing
    lines = existing.splitlines()
    out: List[str] = []
    skipping = False
    for line in lines:
        if line.strip() == _HEAD:
            skipping = True
            continue
        if skipping and line.strip() == _TAIL:
            skipping = False
            continue
        if not skipping:
            out.append(line)
    text = "\n".join(out).lstrip("\n")
    return text


@typechecked
def _compose(existing: str, block_body: str) -> str:
    """Prepend a managed block to whatever the user has authored below it."""
    stripped = _strip_managed(existing)
    body = block_body.strip("\n")
    block = f"{_HEAD}\n{body}\n{_TAIL}\n"
    if not stripped.strip():
        return block
    # `_strip_managed` rebuilds the tail by joining lines, which loses the
    # final newline. Reproduce whichever state the file was already in rather
    # than imposing one: either choice is a byte of difference from what the
    # user committed, so a sync would leave `.gitignore` modified forever.
    tail = stripped.lstrip().rstrip()
    ending = "\n" if existing.endswith("\n") else ""
    return f"{block}\n{tail}{ending}"


@typechecked
def _commit_untracking(path: Path, freed: List[str]) -> bool:
    """Commit the index as it stands, right after the entries were removed.

    Porcelain `git commit --only <paths>` cannot express this: it rebuilds the
    given paths from the working tree, which re-adds the very files we just
    dropped. Plumbing writes a tree straight from the index instead, so the
    deletions stick. Called immediately after `rm --cached`, so the only
    difference from HEAD is those removals plus whatever the user had already
    staged, which is committed here rather than silently discarded.
    """
    ok, tree, _ = _run_git_result(["write-tree"], path)
    if not ok or not tree.strip():
        return False
    ok, head, _ = _run_git_result(["rev-parse", "HEAD"], path)
    if not ok or not head.strip():
        return False
    listed = ", ".join(freed[:3]) + (f" (+{len(freed) - 3} more)" if len(freed) > 3 else "")
    ok, commit, _ = _run_git_result(
        [
            "commit-tree",
            tree.strip(),
            "-p",
            head.strip(),
            "-m",
            f"Stop tracking files covered by .gitignore: {listed}",
        ],
        path,
    )
    if not ok or not commit.strip():
        return False
    ok, _, _ = _run_git_result(
        ["update-ref", "HEAD", commit.strip(), head.strip()], path
    )
    return ok


@typechecked
def _untrack_now_ignored(path: Path) -> List[str]:
    """Drop files from the index that the ignore rules now cover.

    A .gitignore only governs UNtracked files, so a file already in the index
    when a rule arrives keeps showing up as an uncommitted change forever. Only
    the index entry is removed (`--cached`); the file itself stays on disk.
    """
    ok, out, _ = _run_git_result(
        ["ls-files", "-i", "-c", "--exclude-standard"], path
    )
    if not ok:
        return []
    stale = [line for line in out.splitlines() if line.strip()]
    if not stale:
        return []
    ok, _, _ = _run_git_result(["rm", "--cached", "--quiet", "--", *stale], path)
    if not ok:
        return []
    _commit_untracking(path, stale)
    return stale


@typechecked
def _write_ignore(workspace_id: str, want_block: bool) -> Tuple[bool, str]:
    path = workspace_path(workspace_id)
    if path is None:
        return False, "workspace missing"
    ignore = path / ".gitignore"
    try:
        existing = ignore.read_text(encoding="utf-8") if ignore.exists() else ""
    except OSError as exc:
        return False, str(exc)

    if want_block:
        new_content = _compose(existing, load_global())
    else:
        new_content = _strip_managed(existing)
        if not new_content.endswith("\n") and new_content:
            new_content += "\n"

    if new_content != existing:
        try:
            ignore.write_text(new_content, encoding="utf-8")
        except OSError as exc:
            return False, str(exc)

    # Runs even when the text was already correct: the rules may have landed on
    # an earlier sync while the offending files stayed in the index.
    freed = _untrack_now_ignored(path) if (path / ".git").is_dir() else []

    if new_content == existing:
        return True, f"untracked {len(freed)}" if freed else "unchanged"
    return True, f"written, untracked {len(freed)}" if freed else "written"


@typechecked
def ensure_synced_for_new_repo(workspace_id: str) -> None:
    """Called when `init_repo` succeeds so the app gets the block immediately."""
    opt_out = _load_opt_out()
    if opt_out.get(workspace_id):
        return
    _write_ignore(workspace_id, want_block=True)


@typechecked
def sync_all() -> List[Dict[str, Any]]:
    """Apply the current global text to every tracked, opted-in app.

    Returns one row per tracked app so the client can show which files
    changed and which were skipped.
    """
    opt_out = _load_opt_out()
    results: List[Dict[str, Any]] = []
    for entry in list_apps():
        if not (entry["has_git"] and entry["workspace_exists"]):
            continue
        wid = entry["workspace_id"]
        included = not opt_out.get(wid)
        ok, note = _write_ignore(wid, want_block=included)
        results.append(
            {
                "workspace_id": wid,
                "name": entry["name"],
                "included": included,
                "ok": ok,
                "detail": note,
            }
        )
    return results


@typechecked
def save_global(content: str) -> List[Dict[str, Any]]:
    path = _global_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"couldn't write global .gitignore: {exc}")
    return sync_all()


@typechecked
def _append_local_rules(path: Path, rules: List[str]) -> List[str]:
    """Add rules BELOW the managed block, where the user's own rules live.

    Returns only the rules that weren't already there. Writing above the
    closing marker would place them inside the managed region, which the
    next global sync rewrites wholesale, silently dropping them.
    """
    ignore = path / ".gitignore"
    try:
        existing = ignore.read_text(encoding="utf-8") if ignore.exists() else ""
    except OSError:
        return []

    present = {line.strip() for line in existing.splitlines()}
    fresh = [r for r in rules if r not in present]
    if not fresh:
        return []

    if existing and not existing.endswith("\n"):
        existing += "\n"
    try:
        ignore.write_text(existing + "\n".join(fresh) + "\n", encoding="utf-8")
    except OSError:
        return []
    return fresh


@typechecked
def ignore_paths(
    workspace_id: str, rules: List[str], globally: bool
) -> Dict[str, Any]:
    """Add ignore rules for one app, optionally to the shared global list.

    Two steps: the rule text lands in the app's own `.gitignore` (or in the
    global list, which mirrors into every opted-in app), then any file the
    rule now covers is dropped from the index. That second step is what
    actually makes the file leave the uncommitted list — a `.gitignore`
    only governs files git isn't already tracking, so without it a rule on
    a tracked file changes nothing the user can see.
    """
    path = workspace_path(workspace_id)
    if path is None:
        raise RuntimeError("Workspace not found")
    if not (path / ".git").is_dir():
        raise RuntimeError("This workspace isn't a git repository.")

    cleaned = [r.strip() for r in rules if r and r.strip()]
    if not cleaned:
        raise RuntimeError("No rules given.")
    # '!' re-includes rather than excludes, and a rule climbing out of the
    # workspace is never something this button should write on the user's
    # behalf. Both are legal in a hand-edited file; neither is one click.
    for rule in cleaned:
        if rule.startswith("!") or rule.startswith("../") or "/../" in rule:
            raise RuntimeError(f"Refusing to write rule: {rule}")

    if globally:
        current = load_global()
        present = {line.strip() for line in current.splitlines()}
        fresh = [r for r in cleaned if r not in present]
        if fresh:
            base = current if (not current or current.endswith("\n")) else current + "\n"
            save_global(base + "\n".join(fresh) + "\n")
        added = fresh
    else:
        added = _append_local_rules(path, cleaned)

    # Runs even when every rule was already present: a rule may have landed
    # on an earlier click while the offending file stayed in the index.
    freed = _untrack_now_ignored(path)
    return {
        "added": added,
        "untracked": freed,
        "scope": "global" if globally else "local",
    }


@typechecked
def read_state() -> Dict[str, Any]:
    """Everything the UI needs to render the sheet in one round-trip."""
    opt_out = _load_opt_out()
    apps: List[Dict[str, Any]] = []
    for entry in list_apps():
        if not (entry["has_git"] and entry["workspace_exists"]):
            continue
        wid = entry["workspace_id"]
        apps.append(
            {
                "workspace_id": wid,
                "name": entry["name"],
                "included": not opt_out.get(wid),
            }
        )
    return {"content": load_global(), "apps": apps}


@typechecked
def set_included(workspace_id: str, included: bool) -> Dict[str, Any]:
    opt_out = _load_opt_out()
    if included:
        opt_out.pop(workspace_id, None)
    else:
        opt_out[workspace_id] = True
    _save_opt_out(opt_out)
    ok, note = _write_ignore(workspace_id, want_block=included)
    return {"included": included, "ok": ok, "detail": note}
