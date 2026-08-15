"""Reload the OpenSwarm desktop app so it re-reads the installed app list.

Quitting and relaunching is unnecessary here. The host's `/api/outputs/list`
calls `load_all()`, which does a fresh `os.listdir` + read of the records
directory on every request, with no caching anywhere in that path. The stale
list therefore lives only in the renderer's memory, and a window reload is
enough to pick up installs and deletes.

The reload is the same Cmd+R the App Restarter app sends: activate the app,
then dispatch the keystroke through System Events. Unlike a quit this leaves
the process (and this backend) alive, so no detached helper is needed. Nothing
here modifies the OpenSwarm bundle.
"""

import os
import subprocess
from typing import Any, Dict, List, Optional

from typeguard import typechecked

APP_PATH = "/Applications/OpenSwarm.app"
EXEC_PATH = os.path.join(APP_PATH, "Contents", "MacOS", "OpenSwarm")

# The app name is passed as argv, never interpolated into the script.
# `activate` first because System Events delivers the keystroke to whatever is
# frontmost, so skipping it would send Cmd+R to the wrong application.
RELOAD_SCRIPT = """on run argv
tell application (item 1 of argv) to activate
delay 0.4
tell application "System Events" to keystroke "r" using {command down}
end run"""


@typechecked
def app_pids() -> List[int]:
    """PID of OpenSwarm's root process: the one launchd owns.

    Deliberately not `pgrep -f "^<exec>$"`. Two things break that: the trailing
    `$` never matches (argv carries content `ps` doesn't print), and several
    processes share the exec path anyway. The real app root is the one whose
    argv is EXACTLY the executable with no trailing arguments and whose parent
    is launchd; the lookalike sibling is a child running crash-watchdog.js.
    """
    try:
        out = subprocess.run(
            ["ps", "-Ao", "pid=,ppid=,command="], capture_output=True, text=True, timeout=10
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []

    roots: List[int] = []
    fallback: List[int] = []
    for line in out.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        pid, ppid, command = int(parts[0]), int(parts[1]), parts[2].strip()
        if command != EXEC_PATH:
            continue
        (roots if ppid == 1 else fallback).append(pid)

    return sorted(roots) or sorted(fallback)


@typechecked
def _permission_hint(stderr: str) -> Optional[str]:
    if "-1743" in stderr or "Not authorized" in stderr:
        return (
            "macOS blocked the reload. Grant OpenSwarm permission under System Settings > "
            "Privacy & Security > Accessibility (and Automation), then try again."
        )
    return None


@typechecked
def reload_app() -> Dict[str, Any]:
    """Send Cmd+R to OpenSwarm so the dashboard re-reads what's installed."""
    if not os.path.isdir(APP_PATH):
        return {"ok": False, "detail": f"OpenSwarm isn't installed at {APP_PATH}."}

    pids = app_pids()
    if not pids:
        return {"ok": False, "detail": "Couldn't find the running OpenSwarm process."}

    try:
        proc = subprocess.run(
            ["osascript", "-e", RELOAD_SCRIPT, "OpenSwarm"],
            capture_output=True, text=True, timeout=20,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "detail": "The reload request timed out."}
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "detail": f"Couldn't send the reload request: {exc}"}

    if proc.returncode != 0:
        err = (proc.stderr or "").strip()
        return {"ok": False, "detail": _permission_hint(err) or f"Reload failed: {err or 'unknown error'}"}

    return {"ok": True, "pids": pids, "detail": "Reloaded OpenSwarm."}
