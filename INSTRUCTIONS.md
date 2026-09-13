# INSTRUCTIONS: Remove the Marketplace concept from Git Graph

## Goal

Rip out the entire "marketplace" concept: the idea that there is one big **shared
public GitHub org** (`os-marketplace`) that apps get published/submitted to,
browsed from, and taken down from. After this work there should be no browse
tab, no publish/submit flow, no takedown flow, no pre-publish audit gate, and no
"Published" grouping anywhere. Remove the backend modules, the frontend
components, the routes, the state, and any dead code left behind.

This document is a plan and an inventory, **not** an implementation. Nothing here
has been changed yet.

---

## CRITICAL: "publish" means TWO different things here. Only ONE is the marketplace.

Before touching anything, understand this distinction, because a naive
find-and-replace on "publish" will delete a feature you probably want to keep.

**(A) Marketplace publish — REMOVE.**
Submitting an app to the shared `os-marketplace` GitHub org so other people can
browse and install it. This is the "big shared repo anyone can publish to" the
user wants gone. Signals: `marketplace`, `os-marketplace`, `submissions`,
`listings`, `takedown`, `PublishPanel`, `AuditSection`, the `Published`
rail group, the `published` sweep/state, the Marketplace nav tab.

**(B) "Never published to GitHub" — KEEP (recommended).**
A local repo that has commits but **no GitHub remote at all**. The UI calls the
first push "publishing" it. This is purely about backing up *your own* app to
*your own* GitHub via the Cloud feature. It is NOT a shared repo. Signals:
`needsPublish` (derived from `is_repo && has_remote === false && commit_count > 0`),
the StatRow `"unpublished" / "never published"` stat, and the BulkActionBar
`'publish'` mode (which just creates a remote + first push).

> **Decision needed from the user before implementing:** keep (B) as-is, or
> rename it to avoid the word "publish" now that the marketplace is gone
> (e.g. "Back up to GitHub" / "push to GitHub"). Default recommendation: **keep
> the feature, optionally rename the copy.** Do NOT delete (B) as part of the
> marketplace removal.

Everything below is scoped to **(A) only** unless explicitly noted.

---

## Adjacent features that are NOT the marketplace — DO NOT remove

These share prefixes/icons/words with the marketplace but are independent. Leave
them working:

- **Cloud** (`backend/apps/gitgraph/cloud.py`, `CloudSheet.tsx`, `/cloud/*`
  routes): "treat GitHub as the user's own cloud" — list/install/restore *your
  own* OpenSwarm repos. The old marketplace Install button reused
  `cloud.install_repo()`, but Cloud stands on its own. Keep.
- **Releases** (`release.py`, `Releases.tsx`, `ReleasePanel.tsx`, `/release/*`,
  `/releases-sweep`): cuts a versioned GitHub Release with a `.swarm` asset on
  the app's *own* repo. Keep.
- **Collaborators** (`collab.py`, `CollaboratorsPanel.tsx`, `/collab/*`): GitHub
  collaborators on the app's own repo. Keep.
- **GitHub panel / connection** (`github.py`, `GitHubPanel.tsx`): keep.
- **Discovery** (`discovery.py`): on-disk app/skill discovery + restore. Keep.
- **Store** (`backend/apps/store/store.py`, `backend/data/store.json`): generic
  disk-backed KV state helper. Only matched the search on the substring "store".
  Keep.
- **Redux store** (`frontend/src/shared/state/store.ts`) and `hooks.ts`: matched
  on "store"/"cloud"/"release", not marketplace. Keep.
- **citation toolui** (`toolui/components/citation/*`): matched on "publisher".
  Unrelated. Keep.

---

## Removal inventory

### Backend — files to DELETE outright
- `backend/apps/gitgraph/marketplace.py` — the entire marketplace module
  (list listings, published sweep, publish status, submit, request takedown).
- `backend/apps/gitgraph/audit.py` — the pre-publish secret/exposure scanner.
  It exists solely to gate marketplace publishing (`audit.scan`, `audit.autofix`
  are only called from the `/marketplace/audit/*` routes). Confirm no other
  caller before deleting (grep `audit\.` across backend).
- `backend/apps/gitgraph/__pycache__/*.pyc` for the above (regenerated anyway).

### Backend — edits in `backend/apps/gitgraph/gitgraph.py`
- Remove `audit,` and `marketplace,` from the package import block (lines ~12-24).
- Delete these route handlers and their functions:
  - `GET  /marketplace/listings`            (`marketplace_listings`, ~790)
  - `GET  /marketplace/published`           (`marketplace_published`, ~799)
  - `POST /marketplace/audit/{workspace_id}`      (`marketplace_audit`, ~808)
  - `POST /marketplace/audit/{workspace_id}/fix`  (`marketplace_audit_fix`, ~821)
  - `GET  /marketplace/publish/{workspace_id}`     (`marketplace_publish_status`, ~839)
  - `POST /marketplace/publish/{workspace_id}`     (`marketplace_publish`, ~849)
  - `POST /marketplace/takedown/{workspace_id}`    (`marketplace_takedown`, ~866)
- Delete any request models used only by those routes (e.g. `SubmitRequest`,
  `TakedownRequest`, `AutofixRequest`) — grep each to confirm it has no other
  user before removing.
- Fix the stale comment near line ~668 that mentions "published release".

### Backend — incidental comment cleanup (code can stay)
- `cloud.py` ~1215 and ~1243-1250 (`_refresh_installed_from_slug`): comments
  reference the marketplace "is mine published" husk-match. The function itself
  keeps `installed_from.slug` fresh and is still useful for Cloud install
  dedup, so **keep the function**; just update the now-stale comments so they no
  longer describe the marketplace.

### Frontend — files to DELETE outright
- `frontend/src/components/Marketplace.tsx` — the browse-the-marketplace tab.
- `frontend/src/components/PublishPanel.tsx` — the per-app publish/submit/takedown
  popover (this is the (A) publish, safe to delete).
- `frontend/src/components/AuditSection.tsx` — only imported by `PublishPanel`.

### Frontend — edits in `frontend/src/shared/state/API_ENDPOINTS.ts`
Delete the whole "MARKETPLACE - Endpoints" block:
- `GITGRAPH_MARKETPLACE_LISTINGS_URL`
- `GITGRAPH_MARKETPLACE_PUBLISHED_URL`
- `marketplaceAuditUrl`
- `marketplaceAuditFixUrl`
- `marketplacePublishUrl`
- `marketplaceTakedownUrl`
Keep everything under CLOUD, RELEASE, COLLAB.

### Frontend — edits in `frontend/src/pages/index.tsx`
- Remove imports: `Marketplace`, `PublishPanel`, and the `type Published`
  re-export from `AppRail`.
- `mode` union (~102): drop `'marketplace'`, keep `'home' | 'app' | 'releases' | 'settings'`.
- Remove `published` state + setter (~124), the published sweep in the
  collab/published `Promise.all` (~242-258) — revert it to fetching only collab
  — and the `setPublished({})` reset (~401).
- Remove `goMarketplace` (~412) and the `if (mode === 'marketplace')` render
  branch (~590) that mounts `<Marketplace>`.
- Remove the `<PublishPanel>` mount (~766).
- Remove props passed to `<AppRail>`: `marketplaceActive`, `onMarketplace`,
  `published`.
- Leave `needsPublish` derivation (~470-473) and its `repoState` usage — that is
  concept (B). (Or rename per the user decision above.)

### Frontend — edits in `frontend/src/components/AppRail.tsx`
- Delete the `Published` interface (~41-43) and the `published` prop (~74, ~117,
  ~601, ~612).
- Delete the `marketplaceActive` / `onMarketplace` props (~62, ~65, ~105, ~108).
- Remove the "Marketplace" `NavRow` (~374-379).
- Remove the "Published" rail group: the `publishedApps` split in the `useMemo`
  (~127, ~155-166) and its rendered section (~435-447). Fold those apps back
  into the Private/Shared split.
- Remove the `published` prop threaded into `RailAppRow`.
- Drop the now-unused `StorefrontRoundedIcon` import (~13) **only if** nothing
  else uses it. Keep `needsPublish` on `RepoState` (concept B).

### Frontend — edits in `frontend/src/components/StatRow.tsx`
Concept (B). Recommended: **keep** the "never published" stat but consider
renaming its label to match whatever (B) is called after the decision above. If
kept as-is, no change needed. The `PublishRoundedIcon` and the
`unpublished`/`onFocusUnpublished` wiring belong to (B), not the marketplace.

### Frontend — edits in `frontend/src/components/BulkActionBar.tsx`
Concept (B). The `'publish'` bulk mode = "create remote + first push for local
repos". Recommended: **keep** (optionally rename to "back up"/"push"). Only touch
if the user decides to rename (B). It is NOT marketplace submission.

### Frontend — copy-only edits in `frontend/src/components/SettingsPage.tsx`
Just doc strings: the header comment (~28 "parallel to Home and Marketplace")
and two subtitles (~153, ~200) mention "publishing"/"Marketplace". Reword so
they no longer imply a marketplace. No logic.

### Frontend — `HomeGrid.tsx`
Has ~24 publish/marketplace references — audit each against the (A) vs (B) test.
Any "Published" section / marketplace badge = remove (A). Any "never published to
GitHub" empty-state / count = keep (B). Read the file and classify before
editing; do not bulk-delete.

---

## Suggested order of work (safe, testable in stages)

1. **Backend first.** Delete `marketplace.py` + `audit.py`, strip the imports and
   the 7 routes + request models from `gitgraph.py`, fix the stray comments in
   `cloud.py`. Restart backend, confirm it boots and `/api/gitgraph/apps`,
   `/status`, `/cloud/*`, `/release/*`, `/collab/*` still respond.
2. **Frontend endpoints.** Delete the MARKETPLACE block in `API_ENDPOINTS.ts`.
   The TypeScript build will now flag every remaining consumer — use those
   compile errors as your removal checklist.
3. **Delete components.** `Marketplace.tsx`, `PublishPanel.tsx`, `AuditSection.tsx`.
4. **Rewire navigation & state.** `index.tsx` and `AppRail.tsx`: drop the tab,
   the mode, the `published` state/sweep/group, the panel mount, the props.
5. **Reclassify the survivors.** Go through `HomeGrid.tsx`, `StatRow.tsx`,
   `BulkActionBar.tsx` and keep only concept (B). Apply the user's rename
   decision if any.
6. **Copy cleanup.** `SettingsPage.tsx` doc strings.
7. **Dead-code sweep.** Re-grep for `marketplace|Marketplace|MARKETPLACE|
   Storefront|takedown|listings|Published|os-marketplace|submissions` across
   `frontend/src` and `backend/apps/gitgraph`. Every remaining hit should be
   either concept (B) or a false positive (citation "publisher"). Remove any
   now-orphaned imports, types, icons, and unused MUI icon imports the build
   warns about.
8. **Verify.** `npm run build` (or the app's build) clean with no unused-symbol
   errors; app boots; Home / Releases / Settings / per-app view all render; Cloud
   install, Releases, and Collaborators still work; no "Marketplace" or
   "Published" appears anywhere in the UI.

---

## Definition of done
- No `marketplace.py` / `audit.py`; no `/marketplace/*` routes.
- No `Marketplace.tsx` / `PublishPanel.tsx` / `AuditSection.tsx`; no MARKETPLACE
  endpoints; no `Published` rail group or nav tab; no `published` state/sweep.
- Cloud, Releases, Collaborators, and GitHub connection unchanged and working.
- Concept (B) ("never published to GitHub" = first push) either untouched or
  cleanly renamed per the user's decision — never deleted as collateral.
- Clean build, no dead imports/types/icons.
