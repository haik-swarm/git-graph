import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from swarm_debug import debug
from typeguard import typechecked

from backend.apps.gitgraph import cloud, github, global_ignore, magic
from backend.apps.openswarm_host.openswarm_host import runtime_status
from backend.apps.gitgraph.discovery import (
    commit_paths,
    discard_dirty,
    init_repo,
    list_apps,
    read_commit_detail,
    read_graph,
    read_status,
    restore_to,
    workspace_path,
)
from backend.config.Apps import SubApp


class CommitRequest(BaseModel):
    message: str
    paths: List[str]


class CreateRepoRequest(BaseModel):
    name: Optional[str] = None


class MagicUpdateRequest(BaseModel):
    push: bool = True


class GlobalIgnoreSaveRequest(BaseModel):
    content: str


class GlobalIgnoreIncludeRequest(BaseModel):
    included: bool


class InstallRepoRequest(BaseModel):
    clone_url: str
    app_name: str
    description: Optional[str] = ""


@typechecked
def _resolve(workspace_id: str) -> Path:
    path = workspace_path(workspace_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return path


@typechecked
def _app_name(workspace_id: str) -> str:
    for entry in list_apps():
        if entry["workspace_id"] == workspace_id:
            return str(entry["name"])
    return workspace_id


@asynccontextmanager
async def gitgraph_lifespan():
    debug("gitgraph SubApp lifespan starting")
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


@gitgraph.router.post("/commit/{workspace_id}")
@typechecked
async def create_commit(workspace_id: str, body: CommitRequest) -> dict:
    path = _resolve(workspace_id)
    ok, result = commit_paths(path, body.message, body.paths)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return {"sha": result}


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
    path = _resolve(workspace_id)
    ok, result = init_repo(path)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result.get("detail", "Init failed."))
    # New repos inherit the global .gitignore block by default; user can
    # opt this workspace out from the global sheet after the fact.
    global_ignore.ensure_synced_for_new_repo(workspace_id)
    return result


@gitgraph.router.get("/global-ignore")
@typechecked
async def global_ignore_read() -> dict:
    return global_ignore.read_state()


@gitgraph.router.post("/global-ignore")
@typechecked
async def global_ignore_save(body: GlobalIgnoreSaveRequest) -> dict:
    try:
        results = global_ignore.save_global(body.content)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    debug(len(results))
    return {"results": results}


@gitgraph.router.post("/global-ignore/sync")
@typechecked
async def global_ignore_sync() -> dict:
    return {"results": global_ignore.sync_all()}


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
    ok, result = await cloud.install_repo(body.clone_url, name, desc)
    debug(name, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result


@gitgraph.router.post("/local-delete/{workspace_id}")
@typechecked
async def local_delete(workspace_id: str) -> dict:
    ok, result = cloud.delete_local(workspace_id)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result.get("detail", "Delete failed."))
    return result


@gitgraph.router.post("/orphan-delete/{output_id}")
@typechecked
async def orphan_delete(output_id: str) -> dict:
    """Remove a dashboard record that has no workspace behind it.

    Separate from local-delete because a husk has no workspace id to key
    on; without this there is no way to get rid of one at all.
    """
    ok, result = cloud.delete_orphan_record(output_id)
    debug(output_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result.get("detail", "Delete failed."))
    return result
