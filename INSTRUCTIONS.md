# Decouple the Apps/Skills toggle from the pages

## Goal

Today one global `source: 'apps' | 'skills'` switch controls **everything**: which
data is fetched, what the sidebar rail lists, and what the Home and Releases pages
show. Flipping it wipes the current view and reloads a single-source list.

We want to split that one responsibility into three independent ones:

1. **Sidebar rail** — the Apps/Skills toggle (gaining a third **All** option) controls
   only what the *rail itself* renders. Default: **All**.
2. **Home page** — becomes an "all" page with its own local Apps / Skills / All filter.
   Default: **All**.
3. **Releases page** — same: an "all" page with its own local Apps / Skills / All
   filter. Default: **All**.

Settings, Cloud-install, and Bulk-icon sheets stop reading the global toggle and each
get their **own** Apps / Skills / All control.

The core change under all of this: **fetch both sources and merge them into one list,
tagging each entry with its kind**, instead of fetching one source at a time.

---

## How it works today (read this first)

All state lives in `frontend/src/pages/index.tsx` (the `Home` component). There is no
Redux for this; it's local `useState`.

- `const [source, setSource] = useState<'apps' | 'skills'>('apps')` — `index.tsx:95`.
  This one value does two jobs:
  - **Picks the fetch URL.** `refetchApps` (`index.tsx:131`) hits
    `GITGRAPH_APPS_URL` vs `GITGRAPH_SKILLS_URL`; `refreshHomeMeta` (`index.tsx:212`)
    hits `GITGRAPH_STATUS_URL` vs `GITGRAPH_SKILLS_STATUS_URL`.
  - **Threads down as a prop** to `AppRail`, `Releases`, `SettingsPage`, `HomeGrid`,
    `CloudSheet`, `BulkIconSheet`, and as `isSkill` on `DeleteAppDialog`.
- `switchSource` (`index.tsx:373`) flips `source`, then **clears selection, wipes
  `apps`/`homeMeta`/`sharing`, and bounces to Home**. The fetch effects are keyed on
  `source`, so changing it reloads the lists.
- Apps-only behaviors gated on `source === 'apps'`:
  - Sharing/collaborator sweep — `index.tsx:276` (`if (source !== 'apps') return`).
  - Remote sync (`syncRemotes`) — `index.tsx:294`.
  - Skills have no sharing sweep, so their rail phase is forced to `'unavailable'`
    (`index.tsx:386`).
- The toggle **UI** lives in `AppRail.tsx:206-238` (a two-button `role="tablist"`),
  calling `onSwitchSource` → `switchSource`.
- **Key fact that makes this feasible:** skill ids carry a `skill:<root>:<name>`
  prefix (see `API_ENDPOINTS.ts:9-14` and `AppPicker.tsx:21-26`). Every id-keyed git
  endpoint (graph, commit, init, rename, delete) accepts that prefix untouched, so the
  **single-repo/app view is already source-agnostic**. Only the *list*, *status*, and
  *releases-sweep* endpoints are per-source. That means we can safely merge apps and
  skills into one list and route each entry by its own id.

### Consumers of `source` / `isSkill` (the full surface to touch)

- `pages/index.tsx` — owner; fetches, gating, prop threading.
- `components/AppRail.tsx` — toggle UI + filters its own list (`:112-146`).
- `components/HomeGrid.tsx` — noun labels + filter/empty states (`:73, 91, 113-114`).
- `components/Releases.tsx` — picks sweep URL (`:55, 68-70, 82`).
- `components/SettingsPage.tsx` — ignore-scope is per-source (`:37, 68, 721-767`).
- `components/CloudSheet.tsx` — install target.
- `components/BulkIconSheet.tsx` — bulk target.
- `components/DeleteAppDialog.tsx` — `isSkill` prop.

---

## Target design

### 1. Add an explicit `kind` to every entry

The cleanest merge key. In `AppPicker.tsx` `AppEntry` (`:13-32`) add:

```ts
kind: 'app' | 'skill';
```

Derive it when building the merged list: entries from the skills fetch get
`kind: 'skill'`, entries from the apps fetch get `kind: 'app'`. (You *could* infer from
the `skill:` id prefix instead, but an explicit field is clearer and avoids sprinkling
string checks.) Keep `is_flat`, `output_id`, etc. as-is.

### 2. `index.tsx` fetches BOTH sources and merges

Replace the single-source fetch model:

- **`refetchApps`** (`:130-138`): fetch `GITGRAPH_APPS_URL` **and** `GITGRAPH_SKILLS_URL`
  (in parallel, `Promise.all`), tag each list with its `kind`, concat into one `apps`
  array. If one fetch fails, keep the other's results rather than blanking everything.
- **`refreshHomeMeta`** (`:206-223`): fetch both `GITGRAPH_STATUS_URL` and
  `GITGRAPH_SKILLS_STATUS_URL`, merge the two id→meta maps into one `homeMeta`. Meta is
  keyed by (prefixed) id, so a plain object merge is safe — no collisions.
- **Sharing sweep** (`:270-304`) and **`syncRemotes`** (`:294`): run these over the
  **app-kind entries only** (`apps.filter(a => a.kind === 'app')`), not gated on a
  global `source`. Skill entries simply never enter the sharing/sync path, so their
  rail rows render as plain Tracked/Untracked (the `'unavailable'`-equivalent) while
  app rows still get Shared/Private.
- **Delete `switchSource`** (`:373-391`) and the `source` state (`:95`) entirely — with
  both sources always loaded, there is nothing global to switch. Removing it also
  removes the "wipe + bounce to Home" behavior, which is the point.

### 3. Sidebar rail owns a display-only filter (Apps / Skills / All)

In `AppRail.tsx`:

- Replace the `source` / `onSwitchSource` props with **local** state:
  `const [railKind, setRailKind] = useState<'all' | 'apps' | 'skills'>('all')`.
  (Optionally persist to `localStorage` like `HomeGrid`'s view does at
  `HomeGrid.tsx:106-112`.)
- Extend the toggle UI (`:206-238`) from two buttons to **three**: `all | apps | skills`.
  Keep the same `role="tablist"` markup and token styling; just map over
  `['all', 'apps', 'skills']`.
- Apply `railKind` as the **first** step of the existing `useMemo` (`:112-146`), before
  the search/urgency logic:
  ```ts
  const kindFiltered = railKind === 'all' ? apps : apps.filter(a => a.kind === railKind);
  ```
  then feed `kindFiltered` into the current `filtered`/`trackedApps` pipeline. The
  Shared/Private/Untracked grouping is unchanged; skills just never land in Shared.
- Empty-state copy (`:477`) should reflect `railKind` (`No skills yet` / `No apps yet` /
  `Nothing here yet`).

### 4. Home page gets its own local kind filter

Home lives in the `mode === 'home'` block of `index.tsx` (`:585-629`) and delegates to
`HomeGrid`. Since the rail no longer dictates source, Home decides for itself.

- In `HomeGrid.tsx`, add local state
  `const [kind, setKind] = useState<'all' | 'apps' | 'skills'>('all')` and a `Segmented`
  control next to the existing filter/view segments (`:301-333`). `HomeGrid` already
  imports `Segmented` and manages `filter`/`view` locally — mirror that exactly.
- Apply it inside the `rows` `useMemo` (`:116-168`) as an extra predicate:
  `if (kind !== 'all' && a.kind !== kind) return false;`.
- Replace the fixed `nounPlural`/`titleWord` (`:113-114`, currently driven by the
  removed `source` prop) with values derived from the active `kind` (All → "items"/"Your
  workspace" or similar; you choose the copy).
- Drop the `source` prop from `HomeGrid` and from where Home renders it.

### 5. Releases page gets its own local kind filter

`Releases.tsx` currently fetches only one sweep based on `source` (`:55, 68-70`).

- Fetch **both** `GITGRAPH_RELEASES_SWEEP_URL` and
  `GITGRAPH_SKILLS_RELEASES_SWEEP_URL` (parallel), tag each entry with `kind`, merge.
- Add local `const [kind, setKind] = useState<'all'|'apps'|'skills'>('all')` and a
  `Segmented`/toggle in its toolbar, then filter the merged list before the existing
  search/sort `useMemo` (`:91-99`).
- Drop the `source` prop.

### 6. Settings / Cloud / Bulk-icon — own filter each

These branch on the global `source` today; give each its own Apps / Skills / All control:

- **`SettingsPage.tsx`** — the ignore-scope is genuinely per-source (`:721-767`, the
  `scope` in the PUT body and the `gitgraphGlobalIgnoreUrl(source)` GET). Render **two
  sections** (Apps ignore + Skills ignore), or a local toggle that swaps which scope the
  one editor targets. Remove the `source` prop; drive it from local state.
- **`CloudSheet.tsx`** and **`BulkIconSheet.tsx`** — replace the incoming `source` prop
  with a local Apps / Skills / All selector that scopes the install/bulk target.
- **`DeleteAppDialog`** — `isSkill` should come from the **entry** being deleted
  (`selected.kind === 'skill'`), not the global source. This is already almost the case;
  just source it from the entry.

---

## Suggested order of work

1. Add `kind` to `AppEntry`; make `index.tsx` fetch+merge both lists and both status
   maps (steps 1–2). App keeps working with rail/pages still showing everything.
2. Move the toggle into `AppRail` as local `railKind` with the new **All** option
   (step 3); delete `switchSource` + `source` from `index.tsx`.
3. Add the local kind filter to `HomeGrid` (step 4) and `Releases` (step 5).
4. Convert Settings / Cloud / Bulk-icon / Delete to own-filter / per-entry (step 6).
5. Grep for stragglers: `rg "source" frontend/src` — every `source ===`, `source=`,
   `onSwitchSource`, and `isSkill` reference should now be either local page state or a
   per-entry `kind` check. None should point back at a global switch.

## Watch out for

- **Sharing/sync are app-only.** After merging, filter to `kind === 'app'` before the
  sweep and before `syncRemotes`, or skills will hit endpoints that don't serve them.
- **`sharingPhase`** currently gets forced to `'unavailable'` for skills
  (`index.tsx:386`). With a merged list there is no global skill mode; instead, skill
  rows should individually render as plain (no Shared/Private), while the app rows drive
  the real phase.
- **Meta map merge** is a plain object spread because ids are globally unique
  (skills are prefixed). Don't key by unprefixed name.
- **Counts/labels**: the Home toolbar app count (`index.tsx:593`) and `HomeGrid` nouns
  assume one kind. Recompute them from the active local filter.
- **`localStorage`**: if you persist `railKind`/page `kind`, follow the existing
  try/catch pattern (`HomeGrid.tsx:106-112`) so private-mode doesn't throw.
