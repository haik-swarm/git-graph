# Bundles — Implementation Spec

A new top-level page in Git Graph, alongside **Home**, **Releases**, and **Settings**. A **bundle** is a named, described, icon-bearing group whose members are skills, apps, or other bundles. Bundle metadata (including icons) is persisted to a single dedicated private GitHub repo so it syncs across machines.

---

## 1. Concept & decisions

| Decision | Choice |
|---|---|
| GitHub persistence | One dedicated private repo `openswarm-bundles` (description prefix `OpenSwarm bundles:`) holding `bundles.json` + icon `.webp` files. Single source of truth for cross-machine sync. |
| Member references | Store `{kind, id}` refs only. Resolve against live `/apps`, `/skills`, and in-memory bundles at render time. Unresolved refs render as greyed-out "missing" chips, never auto-pruned. |
| Icon | Auto-generated via the existing icon engine (`start_job`/`get_job`). Chosen candidate stored **inline** as a `data:image/webp;base64,...` URI on the bundle, plus written as a separate `.webp` file in the bundles repo on sync. |
| Nesting | Bundles may contain other bundles. Cycles prevented at add-member time via a graph walk. |
| Sync | Manual "Sync bundles" button. No auto-push after mutations. Conflict resolution by `updated_at`. |
| Scope | Full CRUD: create, rename, edit description/icon/members, delete, plus sync. |

---

## 2. Data model

Persisted via `store.py` (`load_store`/`save_store`), namespaced under key `"bundles"` in `backend/data/store.json`.

```jsonc
{
  "bundles": {
    "<bundleId>": {
      "id": "<bundleId>",              // stable uuid4 hex
      "title": "string",
      "description": "string",
      "icon": "data:image/webp;base64,...",  // or "" when none
      "members": [
        { "kind": "app" | "skill" | "bundle", "id": "<refId>" }
      ],
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  }
}
```

Notes:
- `id` for `kind:"app"` / `kind:"skill"` matches the `AppEntry.id` from the merged `/apps` + `/skills` lists; `kind:"bundle"` references another bundle's `id`.
- Icons are stored inline (not committed to the app's own workspace, unlike `apply_icon`), because a bundle has no workspace.

---

## 3. Backend

### 3.1 New routes (in `backend/apps/gitgraph/gitgraph.py`, prefix `/gitgraph/bundles`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/gitgraph/bundles` | List all bundles (from store). |
| POST | `/gitgraph/bundles` | Create a bundle `{title, description?, icon?}`. Returns the new bundle. |
| PATCH | `/gitgraph/bundles/{id}` | Update `title` / `description` / `icon`. Bumps `updated_at`. |
| DELETE | `/gitgraph/bundles/{id}` | Delete a bundle. Does not touch other bundles' member refs (they render "missing"). |
| POST | `/gitgraph/bundles/{id}/members` | Add a member `{kind, id}`. Runs cycle check when `kind:"bundle"`; 409 on cycle. |
| DELETE | `/gitgraph/bundles/{id}/members` | Remove a member `{kind, id}`. |
| POST | `/gitgraph/bundles/sync` | Push/pull against the `openswarm-bundles` repo. Merge by `updated_at`. |
| POST | `/gitgraph/bundles/icon` | Start an icon-generation job for a bundle. Wraps `start_job`. |
| GET | `/gitgraph/bundles/icon/{job_id}` | Poll job status/candidates. Wraps `get_job`. |

### 3.2 Cycle prevention

On add-member with `kind:"bundle"`, walk the target bundle's transitive members. Reject (HTTP 409) if adding it would make the current bundle reachable from itself. Walk only follows `kind:"bundle"` refs; caps depth defensively.

### 3.3 Icon generation reuse

- Reuse `icons.py` `start_job`/`get_job` for candidate creation (these are workspace-independent — they produce candidate data URIs).
- Do **not** call `apply_icon` (that commits into a workspace). Instead, the frontend PATCHes the chosen `data:` URI onto the bundle via `PATCH /gitgraph/bundles/{id}`.

### 3.4 New module: `backend/apps/gitgraph/bundles_sync.py`

- `ensure_repo()` — create/reuse private repo `openswarm-bundles` (description `OpenSwarm bundles: ...`), reusing the connected token and the existing `create_repo` pattern from `github.py`.
- `push_bundles()` — write `bundles.json` + one `<bundleId>.webp` per bundle (decoded from the inline data URI), commit, push.
- `pull_bundles()` — fetch remote `bundles.json`, decode icons back into inline data URIs.
- Conflict resolution: per-bundle, keep the side with the newer `updated_at`.

CRUD routes may live inline in `gitgraph.py` or in a sibling `bundles.py`; sync logic lives in `bundles_sync.py`.

---

## 4. Frontend

### 4.1 `frontend/src/pages/index.tsx`

- Extend the `mode` union: `'home' | 'app' | 'releases' | 'settings' | 'bundles'`.
- Add a `goBundles` handler that sets `mode = 'bundles'`.
- Add a render branch for `mode === 'bundles'` rendering `<BundlesPage />`.

### 4.2 `frontend/src/components/AppRail.tsx`

- Add `onBundles: () => void` and `bundlesActive: boolean` props.
- Add a `NavRow` between **Home** and **Releases**. Icon: `Inventory2Rounded` (fallback `FolderSpecialRounded`), matching the existing MUI rail style.

### 4.3 New `frontend/src/pages/BundlesPage.tsx`

- Grid of bundle cards (icon, title, description, member count).
- Detail/edit view: rename, edit description, generate/change icon (icon panel driven by the icon job endpoints), add/remove members.
- Member picker: choose from merged `/apps` + `/skills` + existing bundles; adding a bundle runs the cycle check server-side.
- Missing refs render as greyed-out "missing" chips.
- "Sync to GitHub" button calling `POST /gitgraph/bundles/sync`.
- Delete with confirmation.

### 4.4 `frontend/src/shared/state/API_ENDPOINTS.ts`

Add endpoint helpers for all routes in §3.1 (list/create/update/delete/members/sync/icon), following the existing `gitgraph*Url` naming convention.

---

## 5. Files touched

**New**
- `frontend/src/pages/BundlesPage.tsx`
- `backend/apps/gitgraph/bundles_sync.py`
- (optional) `backend/apps/gitgraph/bundles.py` for CRUD routes

**Modified**
- `frontend/src/pages/index.tsx` — mode union, `goBundles`, render branch
- `frontend/src/components/AppRail.tsx` — `onBundles`/`bundlesActive` + NavRow
- `frontend/src/shared/state/API_ENDPOINTS.ts` — new endpoint helpers
- `backend/apps/gitgraph/gitgraph.py` — new routes (or mount `bundles.py` router)
- `backend/apps/store/store.py` — reused as-is (`"bundles"` key)
- `backend/apps/gitgraph/github.py` — reuse token + `create_repo` pattern
- `backend/apps/gitgraph/icons.py` — reuse `start_job`/`get_job`

---

## 6. Build order (suggested)

1. Store schema + CRUD routes (no GitHub yet) — bundles live locally.
2. `BundlesPage` + rail nav wiring — full local CRUD in the UI.
3. Icon generation panel wired to `start_job`/`get_job`, store chosen URI inline.
4. Cycle-checked bundle nesting.
5. `bundles_sync.py` + "Sync to GitHub" button.
