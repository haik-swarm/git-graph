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
