"""Track whether the dashboard needs an OpenSwarm restart to reflect app installs/deletes.

Installing from cloud or deleting locally changes what's on disk, but the running host
already read that list at boot, so the dashboard keeps showing the stale set until the
user restarts. This records that a restart is owed and clears itself once one happens.

The clear-condition is the HOST's boot time, not this app's: this backend is disposable
(frozen on card close, killed after ~15min idle), so its own uptime says nothing about
whether the user restarted OpenSwarm. Host boot time is read strictly read-only, by
finding the pid listening on the host port and asking ps when it started. Nothing here
writes to, signals, or restarts the host.
"""

import os
import re
import subprocess
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from typeguard import typechecked

from backend.apps.store.store import load_store, save_store

STORE_KEY = "restart_notice"
_PS_TIME = re.compile(r"^\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4}$")


@typechecked
def _host_port() -> int:
    raw = os.environ.get("OPENSWARM_HOST_API", "http://127.0.0.1:8324")
    try:
        return int(urlparse(raw).port or 8324)
    except (ValueError, TypeError):
        return 8324


@typechecked
def _host_pid() -> Optional[int]:
    """Pid listening on the host port, or None. Read-only: lsof only inspects."""
    try:
        out = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{_host_port()}", "-sTCP:LISTEN", "-Fp"],
            capture_output=True, text=True, timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    for line in out.splitlines():
        if line.startswith("p"):
            try:
                return int(line[1:])
            except ValueError:
                return None
    return None


@typechecked
def host_boot_epoch() -> Optional[int]:
    """Unix seconds when the host process started, or None if it can't be read.

    None is a real outcome (host down, lsof unavailable, sandboxed) and callers
    must treat it as "unknown", never as "restarted".
    """
    pid = _host_pid()
    if pid is None:
        return None
    try:
        out = subprocess.run(
            ["ps", "-o", "lstart=", "-p", str(pid)],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    if not _PS_TIME.match(out):
        return None
    try:
        return int(datetime.strptime(out, "%a %b %d %H:%M:%S %Y").timestamp())
    except ValueError:
        return None


@typechecked
def _read() -> Dict[str, Any]:
    data = load_store().get(STORE_KEY)
    return data if isinstance(data, dict) else {}


@typechecked
def mark_pending(action: str, app_name: str) -> None:
    """Record that an install/delete happened and a restart is owed.

    Stamped with the host boot epoch observed at the time, so a later boot
    reading a different epoch knows the restart already happened.
    """
    current = _read()
    events: List[Dict[str, Any]] = current.get("events") if isinstance(current.get("events"), list) else []
    events.append({"action": action, "app_name": app_name, "at": int(time.time())})
    payload = {
        "pending": True,
        # Keep the FIRST observed boot epoch: that's the process whose stale
        # view the pending changes are relative to. Overwriting it on each
        # later event would be harmless now but wrong if the host restarts
        # between two changes.
        "boot_epoch": current.get("boot_epoch") if current.get("pending") else host_boot_epoch(),
        "events": events[-20:],
    }
    save_store({**load_store(), STORE_KEY: payload})


@typechecked
def get_state() -> Dict[str, Any]:
    """Current notice state, self-clearing once the host has actually restarted."""
    current = _read()
    if not current.get("pending"):
        return {"pending": False, "events": []}

    stamped = current.get("boot_epoch")
    now_boot = host_boot_epoch()
    # Only a confidently-different boot epoch clears the notice. If either side
    # is unknown the notice stands: showing it one restart too long is a far
    # cheaper mistake than hiding a change the user can't see yet.
    if isinstance(stamped, int) and isinstance(now_boot, int) and now_boot != stamped:
        save_store({**load_store(), STORE_KEY: {"pending": False, "events": []}})
        return {"pending": False, "events": []}

    events = current.get("events")
    return {
        "pending": True,
        "events": events if isinstance(events, list) else [],
    }


@typechecked
def dismiss() -> Dict[str, Any]:
    """Clear the notice at the user's request, without a restart."""
    save_store({**load_store(), STORE_KEY: {"pending": False, "events": []}})
    return {"pending": False, "events": []}
