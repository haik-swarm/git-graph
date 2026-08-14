const API_URL = '/api';

// HEALTH - Endpoints
export const HEALTH_CHECK_URL = API_URL + '/health/check';

// GIT GRAPH - Endpoints
export const GITGRAPH_APPS_URL = API_URL + '/gitgraph/apps';
export const GITGRAPH_STATUS_URL = API_URL + '/gitgraph/status';
// The network half of status: fetches every remote, then re-reads. Slow by
// nature, so it runs in the background rather than blocking the grid.
export const GITGRAPH_SYNC_REMOTES_URL = API_URL + '/gitgraph/sync-remotes';
export const gitgraphGraphUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/graph/${encodeURIComponent(workspaceId)}`;
export const gitgraphCommitUrl = (workspaceId: string, sha: string) =>
  `${API_URL}/gitgraph/commit/${encodeURIComponent(workspaceId)}/${encodeURIComponent(sha)}`;
export const gitgraphCreateCommitUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/commit/${encodeURIComponent(workspaceId)}`;
export const gitgraphMagicUpdateUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/magic-update/${encodeURIComponent(workspaceId)}`;
export const gitgraphRestoreUrl = (workspaceId: string, sha: string) =>
  `${API_URL}/gitgraph/restore/${encodeURIComponent(workspaceId)}/${encodeURIComponent(sha)}`;
export const gitgraphDiscardUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/discard/${encodeURIComponent(workspaceId)}`;
export const gitgraphInitUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/init/${encodeURIComponent(workspaceId)}`;

export const GITGRAPH_GLOBAL_IGNORE_URL = API_URL + '/gitgraph/global-ignore';
export const GITGRAPH_GLOBAL_IGNORE_SYNC_URL = API_URL + '/gitgraph/global-ignore/sync';
export const gitgraphGlobalIgnoreToggleUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/global-ignore/apps/${encodeURIComponent(workspaceId)}`;

// GITHUB - Endpoints
export const githubStatusUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/github/${encodeURIComponent(workspaceId)}`;
export const githubCreateRepoUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/github/${encodeURIComponent(workspaceId)}/create`;
export const githubPushUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/github/${encodeURIComponent(workspaceId)}/push`;
export const githubDisconnectUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/github/${encodeURIComponent(workspaceId)}/disconnect`;

// CLOUD - Endpoints (treat GitHub as the user's OpenSwarm cloud)
export const GITGRAPH_CLOUD_REPOS_URL = API_URL + '/gitgraph/cloud/repos';
export const GITGRAPH_CLOUD_INSTALL_URL = API_URL + '/gitgraph/cloud/install';
export const gitgraphLocalDeleteUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/local-delete/${encodeURIComponent(workspaceId)}`;
// Records with no workspace behind them (what a half-failed cloud install
// leaves): no workspace id to key on, so these delete by output id.
export const gitgraphOrphanDeleteUrl = (outputId: string) =>
  `${API_URL}/gitgraph/orphan-delete/${encodeURIComponent(outputId)}`;
