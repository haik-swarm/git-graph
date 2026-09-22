import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from swarm_debug import debug
from typeguard import typechecked

from backend.apps.gitgraph import (
    bundles as bundles_store,
    bundle_ai,
    bundles_sync,
    cloud,
    collab,
    github,
    global_ignore,
    icons,
    magic,
    release,
    restart_app,
    restart_notice,
)
from backend.apps.openswarm_host.openswarm_host import runtime_status
from backend.apps.gitgraph.discovery import (
    commit_paths,
    convert_flat_skill,
    discard_dirty,
    init_repo,
    is_flat_skill_id,
    is_skill_id,
    list_apps,
    list_skills,
    read_commit_detail,
    read_file_diff,
    read_graph,
    read_status,
    resolve_entity,
    restore_to,
    workspace_path,
)
from backend.config.Apps import SubApp


class CommitRequest(BaseModel):
    message: str
    paths: List[str]
    # Commit and push are one button in the dirty-work card, so the push
    # rides along on the same request instead of the UI firing two.
    push: bool = False


class CreateRepoRequest(BaseModel):
    name: Optional[str] = None


class MagicUpdateRequest(BaseModel):
    push: bool = True


class GlobalIgnoreSaveRequest(BaseModel):
    content: str
    # Which shared list to write: "apps" (default, back-compatible) or "skills".
    scope: str = "apps"


class GlobalIgnoreIncludeRequest(BaseModel):
    included: bool


class IgnorePathsRequest(BaseModel):
    rules: List[str]
    # False writes to this app's own .gitignore; True writes to the shared
    # list, which then mirrors into every opted-in app.
    globally: bool = False


class InstallRepoRequest(BaseModel):
    clone_url: str
    app_name: str
    description: Optional[str] = ""
    kind: Optional[str] = None


class InviteRequest(BaseModel):
    username: str
    permission: str = "push"


class ReleaseRequest(BaseModel):
    # Blank auto-increments from the latest release (or v0.1.0). Otherwise a
    # vX.Y.Z (or X.Y.Z) override the backend validates before tagging.
    version: str = ""
    notes: str = ""
    # Workspace-relative paths the author chose to leave OUT of the .swarm.
    # A directory path drops everything under it. Empty ships the whole app.
    exclude: List[str] = []


class RenamePreviewRequest(BaseModel):
    new_name: str


class RenameRequest(BaseModel):
    new_name: str
    # Move the GitHub repo slug + origin URL too. Off by default: it's the
    # one irreversible-ish surface, so the UI opts into it explicitly.
    rename_remote: bool = False
    # Tracked files the user chose to rewrite the old name/slug inside. Left
    # empty, no file contents are touched — the rename stays pure metadata.
    rewrite_paths: List[str] = []


class ApplyIconRequest(BaseModel):
    # A supported icon data URI (image/svg+xml, image/webp, image/png, image/jpeg).
    data_uri: str
    message: str = ""


class IconConfigRequest(BaseModel):
    # None leaves the stored key unchanged; "" clears it.
    openai_api_key: Optional[str] = None
    # Global icon defaults; None leaves each unchanged.
    default_styles: Optional[List[str]] = None
    default_engines: Optional[List[str]] = None
    default_model: Optional[str] = None
    # Edited prompt templates; None leaves each unchanged, blank/default resets it.
    template_svg_system: Optional[str] = None
    template_svg_user: Optional[str] = None
    template_image_prompt: Optional[str] = None
    template_style_line: Optional[str] = None


class BundleIn(BaseModel):
    title: str
    description: str = ""
    # A supported icon data URI, or "" for none.
    icon: str = ""


class BundleUpdate(BaseModel):
    # None leaves the stored field unchanged.
    title: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None


class SuggestMember(BaseModel):
    kind: str
    name: str
    description: str = ""


class BundleSuggestRequest(BaseModel):
    # field is "title" | "description".
    field: str
    members: List[SuggestMember] = []
    title: str = ""
    description: str = ""


class MemberIn(BaseModel):
    # kind is one of "app" | "skill" | "bundle"; id references that entity.
    kind: str
    id: str


class MembersIn(BaseModel):
    # Add one or many in a single request; the UI batches a multi-select.
    members: List[MemberIn]


@typechecked
def _resolve(workspace_id: str) -> Path:
    # resolve_entity handles both app workspace ids (bare) and skill ids
    # (skill:<tag>:<name>); every git endpoint reaches git through here, so
    # supporting skills is a one-function change rather than N.
    path = resolve_entity(workspace_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return path


@typechecked
def _app_name(workspace_id: str) -> str:
    for entry in list_apps():
        if entry["workspace_id"] == workspace_id:
            return str(entry["name"])
    for entry in list_skills():
        if entry["workspace_id"] == workspace_id:
            return str(entry["name"])
    return workspace_id


@asynccontextmanager
async def gitgraph_lifespan():
    debug("gitgraph SubApp lifespan starting")
    # Relaunch any icon-generation jobs left mid-flight by a previous process so
    # generation survives a hard restart instead of stalling forever.
    await icons.resume_interrupted()
    yield


gitgraph = SubApp("gitgraph", gitgraph_lifespan)


@gitgraph.router.get("/apps")
@typechecked
async def apps() -> dict:
    found = list_apps()
    debug(len(found))
    return {"apps": found}


@gitgraph.router.get("/status")
@typechecked
async def status_all() -> dict:
    """Batch dirty/head summary for every registered app.

    Runs each app's status probe on a thread so shelling out to git for
    N apps happens concurrently instead of one-at-a-time; the home grid
    calls this on entry and on window focus, and can't afford N round
    trips per refresh.
    """
    entries = list_apps()

    async def probe(entry: Dict) -> tuple:
        wid = entry["workspace_id"]
        path = workspace_path(wid)
        if path is None:
            git_data = {
                "is_repo": False,
                "commit_count": 0,
                "dirty_count": 0,
                "current_branch": None,
                "head_subject": None,
                "head_date": None,
                "head_sha": None,
                "has_remote": False,
                "unpushed": 0,
                "behind": 0,
            }
        else:
            git_data = await asyncio.to_thread(read_status, path)
        # Ask the host if the preview runtime is up. Runs alongside the git
        # probe so the batch endpoint still finishes in one round trip.
        rt = await asyncio.to_thread(runtime_status, wid)
        git_data["runtime_running"] = bool(rt.get("running"))
        git_data["runtime_ready"] = bool(rt.get("ready"))
        return wid, git_data

    pairs = await asyncio.gather(*(probe(e) for e in entries))
    return {"status": {wid: data for wid, data in pairs}}


@gitgraph.router.get("/skills")
@typechecked
async def skills() -> dict:
    """Every skill directory across both trees, same shape as /apps."""
    found = list_skills()
    debug(len(found))
    return {"apps": found}


@gitgraph.router.get("/skills-status")
@typechecked
async def skills_status_all() -> dict:
    """Batch dirty/head summary for every skill.

    The skill twin of /status. Skills have no preview runtime, so the
    runtime flags are always false — kept in the payload so the home grid
    renders skill cards through the identical code path as app cards.
    """
    entries = list_skills()

    async def probe(entry: Dict) -> tuple:
        eid = entry["workspace_id"]
        path = resolve_entity(eid)
        if path is None:
            git_data = {
                "is_repo": False,
                "commit_count": 0,
                "dirty_count": 0,
                "current_branch": None,
                "head_subject": None,
                "head_date": None,
                "head_sha": None,
                "has_remote": False,
                "unpushed": 0,
                "behind": 0,
            }
        else:
            git_data = await asyncio.to_thread(read_status, path)
        git_data["runtime_running"] = False
        git_data["runtime_ready"] = False
        return eid, git_data

    pairs = await asyncio.gather(*(probe(e) for e in entries))
    return {"status": {eid: data for eid, data in pairs}}


@gitgraph.router.post("/sync-remotes")
@typechecked
async def sync_remotes() -> dict:
    """Fetch every remote-backed app, then re-read status.

    `/status` stays local-only and instant; this is the network half, run
    in the background by the home grid so a slow or unreachable remote
    delays only the freshness badge and never the grid itself. Each fetch
    is capped and failures are per-app, so one dead remote can't sink the
    sweep.
    """
    entries = list_apps()

    async def sync(entry: Dict) -> tuple:
        wid = entry["workspace_id"]
        path = workspace_path(wid)
        if path is None:
            return wid, None, None
        ok, detail = await asyncio.to_thread(github.fetch_remote, path)
        # Re-read after the fetch so the caller gets the corrected count in
        # the same round trip rather than racing a second /status call.
        data = await asyncio.to_thread(read_status, path)
        return wid, data, (None if ok else str(detail))

    results = await asyncio.gather(*(sync(e) for e in entries))
    status: Dict[str, Dict] = {}
    errors: Dict[str, str] = {}
    for wid, data, err in results:
        if data is not None:
            status[wid] = data
        if err:
            errors[wid] = err
    debug(len(status), len(errors))
    return {"status": status, "errors": errors}


@gitgraph.router.get("/graph/{workspace_id}")
@typechecked
async def graph(workspace_id: str) -> dict:
    path = _resolve(workspace_id)
    result = read_graph(path)
    debug(workspace_id, len(result["commits"]))
    return result


@gitgraph.router.get("/commit/{workspace_id}/{sha}")
@typechecked
async def commit(workspace_id: str, sha: str) -> dict:
    path = _resolve(workspace_id)
    detail = read_commit_detail(path, sha)
    if detail is None:
        raise HTTPException(status_code=404, detail="Commit not found")
    return detail


@gitgraph.router.get("/diff/{workspace_id}")
@typechecked
async def file_diff(workspace_id: str, path: str, sha: Optional[str] = None) -> dict:
    """A unified patch for one file, uncommitted or from a commit.

    The file path arrives as a query parameter rather than in the URL path
    because it contains slashes; encoding those into a path segment fights
    both the router and every proxy in between.
    """
    ws = _resolve(workspace_id)
    result = await asyncio.to_thread(read_file_diff, ws, path, sha)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("detail", "Diff failed."))
    debug(workspace_id, path, len(result["patch"]))
    return result


@gitgraph.router.post("/ignore/{workspace_id}")
@typechecked
async def ignore_paths(workspace_id: str, body: IgnorePathsRequest) -> dict:
    """Write ignore rules and stop tracking whatever they now cover."""
    _resolve(workspace_id)
    try:
        result = await asyncio.to_thread(
            global_ignore.ignore_paths, workspace_id, body.rules, body.globally
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    debug(workspace_id, result["added"], len(result["untracked"]))
    return result


@gitgraph.router.post("/commit/{workspace_id}")
@typechecked
async def create_commit(workspace_id: str, body: CommitRequest) -> dict:
    path = _resolve(workspace_id)
    ok, result = commit_paths(path, body.message, body.paths)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)

    # A failed push is reported alongside a successful commit rather than as
    # an error: the commit landed, and losing that fact would be worse than
    # the push not happening.
    pushed = False
    push_error = ""
    if body.push:
        pushed, push_result = github.push(path)
        if not pushed:
            push_error = str(push_result)
    return {"sha": result, "pushed": pushed, "push_error": push_error}


@gitgraph.router.post("/magic-draft/{workspace_id}")
@typechecked
async def magic_draft(workspace_id: str) -> dict:
    """Write a commit message for the current diff. Touches nothing."""
    path = _resolve(workspace_id)
    try:
        message, paths = await magic.draft_message(path, _app_name(workspace_id))
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    debug(workspace_id, len(paths), message.split("\n")[0])
    return {"message": message, "paths": paths}


@gitgraph.router.post("/magic-update/{workspace_id}")
@typechecked
async def magic_update(workspace_id: str, body: MagicUpdateRequest) -> dict:
    path = _resolve(workspace_id)
    try:
        result = await magic.magic_update(path, _app_name(workspace_id), body.push)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    debug(workspace_id, result["sha"][:7], result["pushed"])
    return result


@gitgraph.router.post("/init/{workspace_id}")
@typechecked
async def init(workspace_id: str) -> dict:
    # A flat `<name>.md` skill has no folder to git-init, so tracking it means
    # first promoting it to a `<name>/SKILL.md` folder. That conversion inits
    # the repo itself, so Track and Convert are one action from the client's
    # side; the new folder-skill id rides back so it can re-select the record.
    if is_flat_skill_id(workspace_id):
        ok, result = convert_flat_skill(workspace_id)
        debug(workspace_id, ok, result)
        if not ok:
            raise HTTPException(
                status_code=400, detail=result.get("error", "Convert failed.")
            )
        return result
    path = _resolve(workspace_id)
    ok, result = init_repo(path, workspace_id)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result.get("detail", "Init failed."))
    # The global .gitignore block is applied inside init_repo, before its
    # first `add`, so there is nothing left to sync here.
    return result


@typechecked
def _norm_scope(scope: str) -> str:
    # Only two lists exist; anything unrecognized falls back to apps so a
    # stale client can't write to a phantom scope file.
    return "skills" if scope == "skills" else "apps"


@gitgraph.router.get("/global-ignore")
@typechecked
async def global_ignore_read(scope: str = "apps") -> dict:
    return global_ignore.read_state(_norm_scope(scope))


@gitgraph.router.post("/global-ignore")
@typechecked
async def global_ignore_save(body: GlobalIgnoreSaveRequest) -> dict:
    try:
        results = global_ignore.save_global(body.content, _norm_scope(body.scope))
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    debug(len(results))
    return {"results": results}


@gitgraph.router.post("/global-ignore/sync")
@typechecked
async def global_ignore_sync(scope: str = "apps") -> dict:
    return {"results": global_ignore.sync_all(_norm_scope(scope))}


@gitgraph.router.post("/global-ignore/apps/{workspace_id}")
@typechecked
async def global_ignore_toggle(
    workspace_id: str, body: GlobalIgnoreIncludeRequest
) -> dict:
    _resolve(workspace_id)
    return global_ignore.set_included(workspace_id, body.included)


@gitgraph.router.post("/restore/{workspace_id}/{sha}")
@typechecked
async def restore(workspace_id: str, sha: str) -> dict:
    path = _resolve(workspace_id)
    ok, result = restore_to(path, sha)
    debug(workspace_id, sha[:7], ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result.get("detail", "Restore failed."))
    return result


@gitgraph.router.post("/discard/{workspace_id}")
@typechecked
async def discard(workspace_id: str) -> dict:
    path = _resolve(workspace_id)
    ok, result = discard_dirty(path)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result.get("detail", "Discard failed."))
    return result


@gitgraph.router.get("/github-connection")
@typechecked
async def github_connection() -> dict:
    """Whether the GitHub integration is installed at all, workspace-independent.

    Every per-app GitHub action reads the same connected-tool token, so the
    Settings page checks this once and warns the user to install the integration
    rather than letting each repo action fail on its own.
    """
    return await asyncio.to_thread(github.connection_state)


@gitgraph.router.get("/github/{workspace_id}")
@typechecked
async def github_status(workspace_id: str) -> dict:
    path = _resolve(workspace_id)
    result = github.status(path, _app_name(workspace_id))
    debug(workspace_id, result["has_remote"], result["unpushed"])
    return result


@gitgraph.router.post("/github/{workspace_id}/create")
@typechecked
async def github_create(workspace_id: str, body: CreateRepoRequest) -> dict:
    path = _resolve(workspace_id)
    ok, result = await github.create_repo(path, _app_name(workspace_id), body.name)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result


@gitgraph.router.post("/github/{workspace_id}/push")
@typechecked
async def github_push(workspace_id: str) -> dict:
    path = _resolve(workspace_id)
    ok, result = github.push(path)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result


@gitgraph.router.post("/github/{workspace_id}/disconnect")
@typechecked
async def github_disconnect(workspace_id: str) -> dict:
    path = _resolve(workspace_id)
    ok, result = github.disconnect(path)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return {"status": result}


@gitgraph.router.post("/github/{workspace_id}/pull")
@typechecked
async def github_pull(workspace_id: str) -> dict:
    """Rebase this app onto whatever collaborators have pushed.

    A conflict comes back as 409 with the file list rather than 400: it
    isn't a bad request, it's a state the user has to resolve, and the UI
    keys its Abort affordance off that distinction.
    """
    path = _resolve(workspace_id)
    ok, result = await asyncio.to_thread(github.pull, path)
    debug(workspace_id, ok, result)
    if not ok:
        if isinstance(result, dict) and result.get("rebase_in_progress"):
            raise HTTPException(status_code=409, detail=result)
        raise HTTPException(status_code=400, detail=result)
    return result


@gitgraph.router.post("/github/{workspace_id}/abort-rebase")
@typechecked
async def github_abort_rebase(workspace_id: str) -> dict:
    path = _resolve(workspace_id)
    ok, result = await asyncio.to_thread(github.abort_rebase, path)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result


@gitgraph.router.get("/release/{workspace_id}")
@typechecked
async def release_status(workspace_id: str) -> dict:
    """Release readiness, next version, and past releases for one app."""
    path = _resolve(workspace_id)
    result = await asyncio.to_thread(
        release.status, path, workspace_id, _app_name(workspace_id)
    )
    debug(workspace_id, result["can_release"], result["next_version"])
    return result


@gitgraph.router.get("/release/{workspace_id}/files")
@typechecked
async def release_files(workspace_id: str) -> dict:
    """The workspace file tree the release exclude-picker lists, plus the app's
    saved exclude selection. Locked rows are files that never reach the .swarm."""
    path = _resolve(workspace_id)
    result = await asyncio.to_thread(release.list_workspace_files, path, workspace_id)
    debug(workspace_id, len(result["files"]), len(result["excluded"]))
    return result


@gitgraph.router.post("/release/{workspace_id}")
@typechecked
async def release_cut(workspace_id: str, body: ReleaseRequest) -> dict:
    """Build the .swarm, tag the pushed HEAD, and create the GitHub Release."""
    path = _resolve(workspace_id)
    ok, result = await asyncio.to_thread(
        release.cut_release,
        path,
        workspace_id,
        _app_name(workspace_id),
        body.version,
        body.notes,
        body.exclude,
    )
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result


@gitgraph.router.get("/releases-sweep")
@typechecked
async def releases_sweep() -> dict:
    """Every app that has cut at least one GitHub Release, keyed by workspace.

    Feeds the Releases tab: the reverse of the per-app release panel. Each
    app's remote is queried on a thread so N apps resolve concurrently, and
    apps with no releases (or no remote) are dropped rather than listed
    empty. `connected` gates the tab's "connect GitHub" empty state.
    """
    token = github.read_token()
    entries = list_apps()

    async def probe(entry: Dict) -> tuple:
        wid = entry["workspace_id"]
        path = workspace_path(wid)
        if path is None:
            return wid, entry, None
        data = await asyncio.to_thread(
            release.app_releases, path, str(entry.get("name") or wid)
        )
        return wid, entry, data

    pairs = await asyncio.gather(*(probe(e) for e in entries))
    released: Dict[str, Dict] = {}
    for wid, entry, data in pairs:
        if data is not None:
            released[wid] = {
                "name": entry.get("name"),
                "description": entry.get("description"),
                "has_icon": bool(entry.get("has_icon")),
                **data,
            }
    debug(len(released))
    return {"connected": bool(token), "released": released}


@gitgraph.router.get("/skills-releases-sweep")
@typechecked
async def skills_releases_sweep() -> dict:
    """The skill twin of /releases-sweep, keyed by skill id.

    Iterates the on-disk skill trees instead of the app registry and resolves
    each through `resolve_entity` (skills carry a `skill:<tag>:<name>` id, not
    a bare workspace path). Otherwise identical: skills with no remote or no
    GitHub release are dropped rather than listed empty.
    """
    token = github.read_token()
    entries = list_skills()

    async def probe(entry: Dict) -> tuple:
        eid = entry["workspace_id"]
        path = resolve_entity(eid)
        if path is None:
            return eid, entry, None
        data = await asyncio.to_thread(
            release.app_releases, path, str(entry.get("name") or eid)
        )
        return eid, entry, data

    pairs = await asyncio.gather(*(probe(e) for e in entries))
    released: Dict[str, Dict] = {}
    for eid, entry, data in pairs:
        if data is not None:
            released[eid] = {
                "name": entry.get("name"),
                "description": entry.get("description"),
                "has_icon": bool(entry.get("has_icon")),
                **data,
            }
    debug(len(released))
    return {"connected": bool(token), "released": released}


@gitgraph.router.get("/collab/{workspace_id}")
@typechecked
async def collab_list(workspace_id: str) -> dict:
    """Everyone with access to this app, accepted invites and pending both."""
    path = _resolve(workspace_id)
    result = await collab.list_people(path)
    debug(workspace_id, len(result.get("people", [])))
    return result


@gitgraph.router.get("/collab-sweep")
@typechecked
async def collab_sweep() -> dict:
    """Sharing state for every tracked app, for the rail's Private/Shared split.

    Separate from `/status` on purpose: that one stays local-only and
    instant, this one is network-bound. The rail can't group its tracked
    apps until this answers, so it holds placeholders until then rather
    than guessing and reshuffling.
    """
    paths: Dict[str, Path] = {}
    for entry in list_apps():
        wid = entry["workspace_id"]
        path = workspace_path(wid)
        if path is not None and (path / ".git").is_dir():
            paths[wid] = path
    result = await collab.sharing_all(paths)
    debug(len(paths), result.get("connected"))
    return result


@gitgraph.router.post("/collab/{workspace_id}/invite")
@typechecked
async def collab_invite(workspace_id: str, body: InviteRequest) -> dict:
    path = _resolve(workspace_id)
    ok, result = await collab.invite(path, body.username, body.permission)
    debug(workspace_id, body.username, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result


@gitgraph.router.post("/collab/{workspace_id}/remove")
@typechecked
async def collab_remove(workspace_id: str, body: InviteRequest) -> dict:
    path = _resolve(workspace_id)
    ok, result = await collab.remove_person(path, body.username)
    debug(workspace_id, body.username, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result


@gitgraph.router.post("/collab/{workspace_id}/revoke/{invitation_id}")
@typechecked
async def collab_revoke(workspace_id: str, invitation_id: int) -> dict:
    """Cancel an invite nobody accepted; those aren't collaborators yet."""
    path = _resolve(workspace_id)
    ok, result = await collab.revoke_invitation(path, invitation_id)
    debug(workspace_id, invitation_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result


@gitgraph.router.get("/cloud/repos")
@typechecked
async def cloud_repos() -> dict:
    """OpenSwarm-tagged repos on the user's GitHub, ready to one-click install."""
    data = await cloud.list_openswarm_repos()
    debug(len(data.get("repos", [])))
    return data


@gitgraph.router.post("/cloud/install")
@typechecked
async def cloud_install(body: InstallRepoRequest) -> dict:
    name = body.app_name.strip() or "Installed app"
    desc = (body.description or "").strip()
    # Trust the client's classification when it sends one; otherwise fall back
    # to the description prefix so a skill never silently installs as an app.
    kind = body.kind
    if kind not in ("app", "skill"):
        classified = cloud._classify(desc)
        kind = classified[0] if classified else "app"
    ok, result = await cloud.install_repo(body.clone_url, name, desc, kind)
    debug(name, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    restart_notice.mark_pending("installed", name)
    return result


@gitgraph.router.get("/icon/config")
@typechecked
async def icon_config() -> dict:
    """Whether an OpenAI key is usable for the image engine. Never leaks the key."""
    return icons.config_state()


@gitgraph.router.post("/icon/config")
@typechecked
async def icon_config_save(body: IconConfigRequest) -> dict:
    return icons.save_config(
        openai_api_key=body.openai_api_key,
        default_styles=body.default_styles,
        default_engines=body.default_engines,
        default_model=body.default_model,
        template_svg_system=body.template_svg_system,
        template_svg_user=body.template_svg_user,
        template_image_prompt=body.template_image_prompt,
        template_style_line=body.template_style_line,
    )


@gitgraph.router.get("/icon/template")
@typechecked
async def icon_template() -> dict:
    """The raw prompt templates and the variables they reference, so the settings
    page can show exactly what gets sent to the model, template and all."""
    return icons.template_reference()


@gitgraph.router.post("/icon")
async def icon_generate(body: icons.IconIn) -> dict:
    """Kick off a durable icon-generation job for the engine×style cross product
    and return immediately with the job record. Poll /icon/jobs/{id} for results."""
    ok, error, job = await icons.start_job(body)
    debug("icon generate", ok, error or (job or {}).get("id"))
    return {"ok": ok, "error": error, "job": job}


@gitgraph.router.post("/icon/preview")
async def icon_preview(body: icons.IconIn) -> dict:
    """The literal prompt payload each candidate will send, assembled by the same
    builders generation uses. Lets the panel show exactly what the model sees."""
    return {"prompts": icons.preview_prompts(body)}


@gitgraph.router.get("/icon/jobs")
@typechecked
async def icon_jobs(entity_id: str = "") -> dict:
    return {"jobs": icons.list_jobs(entity_id)}


@gitgraph.router.get("/icon/jobs/{job_id}")
@typechecked
async def icon_job(job_id: str) -> dict:
    job = icons.get_job(job_id)
    if job is None:
        return {"ok": False, "error": "No such job.", "job": None}
    return {"ok": True, "error": "", "job": job}


@gitgraph.router.delete("/icon/jobs/{job_id}")
@typechecked
async def icon_job_delete(job_id: str) -> dict:
    return {"ok": await icons.delete_job(job_id)}


@gitgraph.router.post("/icon/apply/{workspace_id}")
@typechecked
async def icon_apply(workspace_id: str, body: ApplyIconRequest) -> dict:
    """Write the chosen icon into the entity's repo and commit it, so it pushes
    to GitHub with the next push (or immediately if a remote is set)."""
    path = _resolve(workspace_id)
    ok, result = await asyncio.to_thread(icons.apply_icon, path, body.data_uri, body.message)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result.get("detail", "Apply failed."))
    return result


_ICON_MEDIA_TYPES = {
    "icon.svg": "image/svg+xml",
    "icon.webp": "image/webp",
    "icon.png": "image/png",
    "icon.jpg": "image/jpeg",
}


@gitgraph.router.get("/icon/raw/{workspace_id}")
@typechecked
async def icon_raw(workspace_id: str) -> FileResponse:
    """Stream the committed icon.* at the repo root so avatars can render it.

    404s when the entity has no icon file; the frontend falls back to the
    letter tile on that status.
    """
    path = _resolve(workspace_id)
    for name in icons.ICON_BASENAMES:
        candidate = path / name
        if candidate.is_file():
            # no-store so re-applying a different icon under the same URL never
            # shows the browser's cached copy of the old one.
            return FileResponse(
                candidate,
                media_type=_ICON_MEDIA_TYPES[name],
                headers={"Cache-Control": "no-store"},
            )
    raise HTTPException(status_code=404, detail="No icon set for this app.")


# Path is "/release-asset", not "/release/asset": the latter collides with the
# "/release/{workspace_id}" template above (FastAPI matches it first and treats
# "asset" as a workspace id -> 404 "Workspace not found"), which silently made
# the download save an error page instead of the bundle.
@gitgraph.router.get("/release-asset")
@typechecked
async def release_asset(owner: str, repo: str, tag: str) -> Response:
    """Stream a published release's `.swarm` bundle as an attachment.

    The Releases tab links here instead of at github.com directly: the sweep
    lists releases with the user's token, so private-repo assets show up, but a
    naked <a href> to the asset hits github.com anonymously and 404s. This route
    re-fetches the asset with the same token and hands the bytes back with a
    download disposition.
    """
    resolved = release.resolve_asset(owner, repo, tag)
    if resolved is None:
        raise HTTPException(status_code=404, detail="Release asset not found.")
    blob, name = resolved
    return Response(
        content=blob,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@gitgraph.router.post("/local-delete/{workspace_id}")
@typechecked
async def local_delete(workspace_id: str) -> dict:
    # Resolve the name before the delete; afterwards there's no record to read it from.
    name = _app_name(workspace_id)
    # Skills share this endpoint (their id lands in workspace_id), but they have
    # no registry/host/workspace triple for delete_local to key on, so route them
    # to the skill remover, which deletes the folder or flat file directly.
    if is_skill_id(workspace_id):
        ok, result = cloud.delete_skill(workspace_id)
    else:
        ok, result = cloud.delete_local(workspace_id)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result.get("detail", "Delete failed."))
    restart_notice.mark_pending("deleted", name)
    return result


@gitgraph.router.post("/rename-preview/{workspace_id}")
@typechecked
async def rename_preview(workspace_id: str, body: RenamePreviewRequest) -> dict:
    """What a rename would touch, without changing anything.

    Feeds the rename dialog: current name, whether the GitHub slug moves, and
    the tracked files that mention the old name/slug so the user can pick
    which to rewrite.
    """
    ok, result = await asyncio.to_thread(
        cloud.rename_preview, workspace_id, body.new_name
    )
    debug(workspace_id, ok, result.get("slug_would_change") if ok else result)
    if not ok:
        raise HTTPException(status_code=400, detail=result.get("detail", "Preview failed."))
    return result


@gitgraph.router.post("/rename/{workspace_id}")
@typechecked
async def rename(workspace_id: str, body: RenameRequest) -> dict:
    """Rename an app across registry, host, meta.json, GitHub, and picked files.

    Best-effort, reversibility-ordered; returns a per-step checklist rather
    than failing on the first hiccup (same contract as local-delete).
    """
    ok, result = await cloud.rename_app(
        workspace_id,
        body.new_name,
        rename_remote=body.rename_remote,
        rewrite_paths=body.rewrite_paths,
    )
    debug(workspace_id, ok, result.get("new_name") if isinstance(result, dict) else result)
    if not ok and "detail" in result and "steps" not in result:
        # A hard precondition failure (bad name, missing workspace) — nothing ran.
        raise HTTPException(status_code=400, detail=result.get("detail", "Rename failed."))
    # Only owe a restart when a registry write fell back to disk because the
    # host was unreachable; a host-path rename already updated the live
    # dashboard, so a "reload OpenSwarm" banner there would just be noise.
    steps = result.get("steps", []) if isinstance(result, dict) else []
    if any(str(s.get("step", "")).startswith("registry:") for s in steps):
        restart_notice.mark_pending("renamed", result.get("new_name", workspace_id))
    return result


@gitgraph.router.post("/orphan-delete/{output_id}")
@typechecked
async def orphan_delete(output_id: str) -> dict:
    """Remove a dashboard record that has no workspace behind it.

    Separate from local-delete because a husk has no workspace id to key
    on; without this there is no way to get rid of one at all.
    """
    # Read the display name off the record first; the delete removes the only copy.
    name = cloud.orphan_record_name(output_id)
    ok, result = cloud.delete_orphan_record(output_id)
    debug(output_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result.get("detail", "Delete failed."))
    restart_notice.mark_pending("deleted", name)
    return result


@gitgraph.router.get("/restart-notice")
@typechecked
async def restart_notice_state() -> dict:
    """Whether installs/deletes are waiting on an OpenSwarm restart."""
    return await asyncio.to_thread(restart_notice.get_state)


@gitgraph.router.post("/restart-notice/dismiss")
@typechecked
async def restart_notice_dismiss() -> dict:
    return await asyncio.to_thread(restart_notice.dismiss)


@gitgraph.router.post("/restart-app")
@typechecked
async def reload_app_now() -> dict:
    """Reload the OpenSwarm window so it re-reads the installed app list.

    Clears the notice explicitly on success: a reload leaves the host process
    up, so its boot time never changes and the self-clearing path would keep
    the banner on screen forever.
    """
    result = await asyncio.to_thread(restart_app.reload_app)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("detail", "Reload failed."))
    await asyncio.to_thread(restart_notice.dismiss)
    return result


# ---------------------------------------------------------------------------
# Bundles: user-defined groupings of apps, skills, and other bundles.
# ---------------------------------------------------------------------------


@gitgraph.router.get("/bundles")
@typechecked
async def bundles_list() -> dict:
    return {
        "bundles": await asyncio.to_thread(bundles_store.list_bundles),
        "sync": await asyncio.to_thread(bundles_store.sync_state),
    }


@gitgraph.router.post("/bundles")
@typechecked
async def bundles_create(body: BundleIn) -> dict:
    bundle = await asyncio.to_thread(
        bundles_store.create_bundle, body.title, body.description, body.icon
    )
    return {"bundle": bundle}


@gitgraph.router.patch("/bundles/{bundle_id}")
@typechecked
async def bundles_update(bundle_id: str, body: BundleUpdate) -> dict:
    bundle = await asyncio.to_thread(
        bundles_store.update_bundle,
        bundle_id,
        body.title,
        body.description,
        body.icon,
    )
    if bundle is None:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return {"bundle": bundle}


@gitgraph.router.delete("/bundles/{bundle_id}")
@typechecked
async def bundles_delete(bundle_id: str) -> dict:
    ok = await asyncio.to_thread(bundles_store.delete_bundle, bundle_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return {"ok": True}


_MEMBER_ERRORS = {
    "not_found": (404, "Bundle not found"),
    "bad_kind": (400, "Member kind must be one of app, skill, bundle"),
    "cycle": (400, "That would make the bundle contain itself"),
}


@gitgraph.router.post("/bundles/{bundle_id}/members")
@typechecked
async def bundles_add_members(bundle_id: str, body: MembersIn) -> dict:
    bundle = None
    for member in body.members:
        ok, error, bundle = await asyncio.to_thread(
            bundles_store.add_member, bundle_id, member.kind, member.id
        )
        if not ok:
            status, detail = _MEMBER_ERRORS.get(error, (400, "Add member failed"))
            raise HTTPException(status_code=status, detail=detail)
    if bundle is None:
        bundle = await asyncio.to_thread(bundles_store.get_bundle, bundle_id)
        if bundle is None:
            raise HTTPException(status_code=404, detail="Bundle not found")
    return {"bundle": bundle}


@gitgraph.router.delete("/bundles/{bundle_id}/members/{kind}/{member_id}")
@typechecked
async def bundles_remove_member(bundle_id: str, kind: str, member_id: str) -> dict:
    bundle = await asyncio.to_thread(
        bundles_store.remove_member, bundle_id, kind, member_id
    )
    if bundle is None:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return {"bundle": bundle}


@gitgraph.router.post("/bundles/{bundle_id}/suggest")
@typechecked
async def bundles_suggest(bundle_id: str, body: BundleSuggestRequest) -> dict:
    if body.field not in ("title", "description"):
        raise HTTPException(status_code=400, detail="field must be title or description")
    try:
        text = await asyncio.to_thread(
            bundle_ai.suggest_field,
            body.field,
            [m.model_dump() for m in body.members],
            body.title,
            body.description,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "text": text}


@gitgraph.router.post("/bundles/sync")
@typechecked
async def bundles_sync_now() -> dict:
    ok, data = await bundles_sync.sync()
    if not ok:
        raise HTTPException(status_code=400, detail=str(data))
    return data
