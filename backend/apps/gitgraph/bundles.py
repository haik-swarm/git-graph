"""Bundles: user-defined groupings of apps, skills, and other bundles.

A bundle has no workspace of its own — it's pure metadata (title, description,
an inline icon, and a member list) persisted through the shared app store under
the "bundles" key. Members reference apps/skills by the same id the merged
/apps + /skills lists expose, or another bundle by its id.

Sync against the shared `openswarm-bundles` GitHub repo lives in
bundles_sync.py; this module owns only the local store and its invariants.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from typeguard import typechecked

from backend.apps.store.store import load_store, save_store

_STORE_KEY = "bundles"
_META_KEY = "bundles_meta"
# Deletions can't be represented by simply dropping a bundle from the map: the
# next sync would just re-pull it from the shared repo. We instead record a
# tombstone {bundle_id: deleted_at} that rides through the merge and removes the
# bundle on every side.
_TOMB_KEY = "bundles_deleted"

# A bundle-in-bundle graph can't nest arbitrarily deep in practice, so the
# cycle walk caps out defensively rather than trusting the data to terminate.
_MAX_WALK_DEPTH = 64

VALID_KINDS = ("app", "skill", "bundle")


@typechecked
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@typechecked
def _all() -> Dict[str, Any]:
    raw = load_store().get(_STORE_KEY)
    return raw if isinstance(raw, dict) else {}


@typechecked
def _write(
    bundles: Dict[str, Any],
    *,
    mark_dirty: bool = True,
    tombstones: Optional[Dict[str, str]] = None,
) -> None:
    store = load_store()
    patch: Dict[str, Any] = {_STORE_KEY: bundles}
    if tombstones is not None:
        patch[_TOMB_KEY] = tombstones
    # Any local mutation leaves the remote out of date until the next sync.
    if mark_dirty:
        meta = store.get(_META_KEY)
        meta = dict(meta) if isinstance(meta, dict) else {}
        meta["dirty"] = True
        patch[_META_KEY] = meta
    save_store({**store, **patch})


@typechecked
def _tombstones() -> Dict[str, str]:
    raw = load_store().get(_TOMB_KEY)
    if not isinstance(raw, dict):
        return {}
    return {k: v for k, v in raw.items() if isinstance(k, str) and isinstance(v, str)}


@typechecked
def list_tombstones() -> Dict[str, str]:
    """The {bundle_id: deleted_at} map. Sync merges these so deletions on one
    device propagate to the shared repo and every other device."""
    return _tombstones()


@typechecked
def _meta() -> Dict[str, Any]:
    raw = load_store().get(_META_KEY)
    return raw if isinstance(raw, dict) else {}


@typechecked
def sync_state() -> Dict[str, Any]:
    """What the UI needs to render the sync control: when we last synced and
    whether local bundles have changed since (so the button can disable when
    there's nothing to push)."""
    meta = _meta()
    last = meta.get("last_synced_at")
    return {
        "last_synced_at": last if isinstance(last, str) else None,
        "dirty": bool(meta.get("dirty", True)),
    }


@typechecked
def mark_synced() -> None:
    """Record a clean sync: stamp the time and clear the dirty flag."""
    store = load_store()
    meta = store.get(_META_KEY)
    meta = dict(meta) if isinstance(meta, dict) else {}
    meta["last_synced_at"] = _now()
    meta["dirty"] = False
    save_store({**store, _META_KEY: meta})


@typechecked
def list_bundles() -> List[Dict[str, Any]]:
    """Every bundle, newest-updated first."""
    items = [b for b in _all().values() if isinstance(b, dict)]
    items.sort(key=lambda b: str(b.get("updated_at", "")), reverse=True)
    return items


@typechecked
def get_bundle(bundle_id: str) -> Optional[Dict[str, Any]]:
    b = _all().get(bundle_id)
    return b if isinstance(b, dict) else None


@typechecked
def create_bundle(
    title: str, description: str = "", icon: str = "",
) -> Dict[str, Any]:
    now = _now()
    bundle = {
        "id": uuid.uuid4().hex,
        "title": title.strip() or "Untitled bundle",
        "description": description.strip(),
        "icon": icon or "",
        "members": [],
        "created_at": now,
        "updated_at": now,
    }
    bundles = _all()
    bundles[bundle["id"]] = bundle
    _write(bundles)
    return bundle


@typechecked
def update_bundle(
    bundle_id: str,
    title: Optional[str] = None,
    description: Optional[str] = None,
    icon: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    bundles = _all()
    bundle = bundles.get(bundle_id)
    if not isinstance(bundle, dict):
        return None
    if title is not None:
        bundle["title"] = title.strip() or bundle.get("title", "Untitled bundle")
    if description is not None:
        bundle["description"] = description.strip()
    if icon is not None:
        bundle["icon"] = icon
    bundle["updated_at"] = _now()
    bundles[bundle_id] = bundle
    _write(bundles)
    return bundle


@typechecked
def delete_bundle(bundle_id: str) -> bool:
    """Drop a bundle. Other bundles' refs to it are left alone — they render
    as "missing" rather than being silently rewritten."""
    bundles = _all()
    if bundle_id not in bundles:
        return False
    del bundles[bundle_id]
    tombstones = _tombstones()
    tombstones[bundle_id] = _now()
    _write(bundles, tombstones=tombstones)
    return True


@typechecked
def _member_eq(a: Dict[str, Any], kind: str, ref_id: str) -> bool:
    return a.get("kind") == kind and a.get("id") == ref_id


@typechecked
def _would_cycle(bundles: Dict[str, Any], root_id: str, target_id: str) -> bool:
    """True if adding bundle `target_id` as a member of `root_id` would make
    `root_id` reachable from itself. Only bundle→bundle edges are followed."""
    if target_id == root_id:
        return True
    # Walk the target's transitive bundle members; a hit on root_id closes a loop.
    seen: set = set()
    stack: List[Tuple[str, int]] = [(target_id, 0)]
    while stack:
        current, depth = stack.pop()
        if current == root_id:
            return True
        if current in seen or depth > _MAX_WALK_DEPTH:
            continue
        seen.add(current)
        node = bundles.get(current)
        if not isinstance(node, dict):
            continue
        for m in node.get("members", []):
            if isinstance(m, dict) and m.get("kind") == "bundle":
                stack.append((str(m.get("id", "")), depth + 1))
    return False


@typechecked
def add_member(
    bundle_id: str, kind: str, ref_id: str,
) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """Add a member. Returns (ok, error_code, bundle).

    error_code is one of: "" (ok), "not_found", "bad_kind", "cycle".
    """
    if kind not in VALID_KINDS:
        return False, "bad_kind", None
    bundles = _all()
    bundle = bundles.get(bundle_id)
    if not isinstance(bundle, dict):
        return False, "not_found", None
    if kind == "bundle" and _would_cycle(bundles, bundle_id, ref_id):
        return False, "cycle", None

    members = [m for m in bundle.get("members", []) if isinstance(m, dict)]
    if not any(_member_eq(m, kind, ref_id) for m in members):
        members.append({"kind": kind, "id": ref_id})
    bundle["members"] = members
    bundle["updated_at"] = _now()
    bundles[bundle_id] = bundle
    _write(bundles)
    return True, "", bundle


@typechecked
def remove_member(
    bundle_id: str, kind: str, ref_id: str,
) -> Optional[Dict[str, Any]]:
    bundles = _all()
    bundle = bundles.get(bundle_id)
    if not isinstance(bundle, dict):
        return None
    members = [
        m for m in bundle.get("members", [])
        if isinstance(m, dict) and not _member_eq(m, kind, ref_id)
    ]
    bundle["members"] = members
    bundle["updated_at"] = _now()
    bundles[bundle_id] = bundle
    _write(bundles)
    return bundle


@typechecked
def replace_all(
    bundles: Dict[str, Any], tombstones: Optional[Dict[str, str]] = None,
) -> None:
    """Overwrite the whole bundle map (and, when given, the tombstone map). Used
    by sync after a merge, so it leaves the dirty flag alone — sync clears it
    explicitly via mark_synced once the push lands."""
    _write(bundles, mark_dirty=False, tombstones=tombstones)
