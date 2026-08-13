from contextlib import asynccontextmanager
from typing import List

from fastapi import HTTPException
from pydantic import BaseModel
from swarm_debug import debug
from typeguard import typechecked

from backend.apps.gitgraph.discovery import (
    commit_paths,
    list_apps,
    read_commit_detail,
    read_graph,
    workspace_path,
)
from backend.config.Apps import SubApp


class CommitRequest(BaseModel):
    message: str
    paths: List[str]


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


@gitgraph.router.get("/graph/{workspace_id}")
@typechecked
async def graph(workspace_id: str) -> dict:
    path = workspace_path(workspace_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    result = read_graph(path)
    debug(workspace_id, len(result["commits"]))
    return result


@gitgraph.router.get("/commit/{workspace_id}/{sha}")
@typechecked
async def commit(workspace_id: str, sha: str) -> dict:
    path = workspace_path(workspace_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    detail = read_commit_detail(path, sha)
    if detail is None:
        raise HTTPException(status_code=404, detail="Commit not found")
    return detail


@gitgraph.router.post("/commit/{workspace_id}")
@typechecked
async def create_commit(workspace_id: str, body: CommitRequest) -> dict:
    path = workspace_path(workspace_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ok, result = commit_paths(path, body.message, body.paths)
    debug(workspace_id, ok, result)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return {"sha": result}
