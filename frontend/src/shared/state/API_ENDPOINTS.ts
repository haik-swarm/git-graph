const API_URL = '/api';

// HEALTH - Endpoints
export const HEALTH_CHECK_URL = API_URL + '/health/check';

// GIT GRAPH - Endpoints
export const GITGRAPH_APPS_URL = API_URL + '/gitgraph/apps';
export const gitgraphGraphUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/graph/${encodeURIComponent(workspaceId)}`;
export const gitgraphCommitUrl = (workspaceId: string, sha: string) =>
  `${API_URL}/gitgraph/commit/${encodeURIComponent(workspaceId)}/${encodeURIComponent(sha)}`;
export const gitgraphCreateCommitUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/commit/${encodeURIComponent(workspaceId)}`;
export const gitgraphMagicUpdateUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/magic-update/${encodeURIComponent(workspaceId)}`;

// GITHUB - Endpoints
export const githubStatusUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/github/${encodeURIComponent(workspaceId)}`;
export const githubCreateRepoUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/github/${encodeURIComponent(workspaceId)}/create`;
export const githubPushUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/github/${encodeURIComponent(workspaceId)}/push`;
export const githubDisconnectUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/github/${encodeURIComponent(workspaceId)}/disconnect`;
