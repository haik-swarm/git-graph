const API_URL = '/api';

// HEALTH - Endpoints
export const HEALTH_CHECK_URL = API_URL + '/health/check';

// GIT GRAPH - Endpoints
export const GITGRAPH_APPS_URL = API_URL + '/gitgraph/apps';
export const GITGRAPH_STATUS_URL = API_URL + '/gitgraph/status';
// Skills are the second entity source. Same payload shape as /apps and
// /status, so the grid, rail, and single-repo view consume them unchanged;
// only the list source differs. Skill ids carry a `skill:<root>:<name>`
// prefix that flows through every id-keyed git endpoint untouched.
export const GITGRAPH_SKILLS_URL = API_URL + '/gitgraph/skills';
export const GITGRAPH_SKILLS_STATUS_URL = API_URL + '/gitgraph/skills-status';
// The network half of status: fetches every remote, then re-reads. Slow by
// nature, so it runs in the background rather than blocking the grid.
export const GITGRAPH_SYNC_REMOTES_URL = API_URL + '/gitgraph/sync-remotes';
export const gitgraphGraphUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/graph/${encodeURIComponent(workspaceId)}`;
export const gitgraphCommitUrl = (workspaceId: string, sha: string) =>
  `${API_URL}/gitgraph/commit/${encodeURIComponent(workspaceId)}/${encodeURIComponent(sha)}`;
export const gitgraphCreateCommitUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/commit/${encodeURIComponent(workspaceId)}`;
// Writes a commit message from the current diff and returns it, without
// staging or committing anything. The single-app card drafts into its own
// message field so the user reads and edits before committing.
export const gitgraphMagicDraftUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/magic-draft/${encodeURIComponent(workspaceId)}`;
// Draft, commit and push in one unreviewable shot. Bulk-only: across many
// apps there is nowhere to show each message for approval.
export const gitgraphMagicUpdateUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/magic-update/${encodeURIComponent(workspaceId)}`;
export const gitgraphRestoreUrl = (workspaceId: string, sha: string) =>
  `${API_URL}/gitgraph/restore/${encodeURIComponent(workspaceId)}/${encodeURIComponent(sha)}`;
export const gitgraphDiscardUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/discard/${encodeURIComponent(workspaceId)}`;
export const gitgraphInitUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/init/${encodeURIComponent(workspaceId)}`;

// One file's unified patch. The path travels in the query string, not the
// URL path: it contains slashes, and encoding those into a path segment
// fights the router and every proxy in between. Omit `sha` for the working
// tree, pass one to read that file as it changed inside a commit.
export const gitgraphDiffUrl = (
  workspaceId: string,
  filePath: string,
  sha?: string,
) => {
  const query = new URLSearchParams({ path: filePath });
  if (sha) query.set('sha', sha);
  return `${API_URL}/gitgraph/diff/${encodeURIComponent(workspaceId)}?${query}`;
};

// Writes ignore rules, then drops whatever they now cover from the index.
// The untrack half is the point: a rule alone never frees a tracked file.
export const gitgraphIgnoreUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/ignore/${encodeURIComponent(workspaceId)}`;

export const GITGRAPH_GLOBAL_IGNORE_URL = API_URL + '/gitgraph/global-ignore';
export const GITGRAPH_GLOBAL_IGNORE_SYNC_URL = API_URL + '/gitgraph/global-ignore/sync';
// Apps and skills keep separate shared lists; the scope rides in the query so
// the GET reads (and the POST/sync write) the right file. Defaults to apps for
// any caller that predates the split.
export const gitgraphGlobalIgnoreUrl = (scope: 'apps' | 'skills' = 'apps') =>
  `${API_URL}/gitgraph/global-ignore?scope=${scope}`;
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
// Rebases local commits onto whatever collaborators pushed. Answers 409
// (not 400) when it stops on a conflict, so the UI can offer Abort.
export const githubPullUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/github/${encodeURIComponent(workspaceId)}/pull`;
export const githubAbortRebaseUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/github/${encodeURIComponent(workspaceId)}/abort-rebase`;

// ICON - Endpoints
// The image engine needs an OpenAI key; the GET reports only whether one is
// usable (never the key), the POST saves it. Generation is a durable job: POST
// /icon starts it, the jobs endpoints poll it, and /icon/apply writes the picked
// candidate as a committed file in the entity's repo so it pushes to GitHub.
export const GITGRAPH_ICON_CONFIG_URL = API_URL + '/gitgraph/icon/config';
export const GITGRAPH_ICON_URL = API_URL + '/gitgraph/icon';
// The literal prompt payload each engine×style candidate will send, assembled by
// the same backend builders generation uses, so the panel never reconstructs it.
export const GITGRAPH_ICON_PREVIEW_URL = API_URL + '/gitgraph/icon/preview';
// The raw prompt templates and the variables they reference, independent of any
// form input, so the settings page can show the literal {placeholders} that get
// filled in at generation time.
export const GITGRAPH_ICON_TEMPLATE_URL = API_URL + '/gitgraph/icon/template';
export const GITGRAPH_ICON_JOBS_URL = API_URL + '/gitgraph/icon/jobs';
export const gitgraphIconJobUrl = (jobId: string) =>
  `${API_URL}/gitgraph/icon/jobs/${encodeURIComponent(jobId)}`;
export const gitgraphIconApplyUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/icon/apply/${encodeURIComponent(workspaceId)}`;
// Streams the committed icon.* at the repo root; 404s when the app has none,
// which the avatar treats as "fall back to the letter tile".
export const gitgraphIconRawUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/icon/raw/${encodeURIComponent(workspaceId)}`;

// COLLABORATORS - Endpoints
// Batch sharing state for the rail's Private/Shared split. Network-bound,
// so the rail paints ungrouped first and regroups once this lands.
export const GITGRAPH_COLLAB_SWEEP_URL = API_URL + '/gitgraph/collab-sweep';
export const collabListUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/collab/${encodeURIComponent(workspaceId)}`;
export const collabInviteUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/collab/${encodeURIComponent(workspaceId)}/invite`;
export const collabRemoveUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/collab/${encodeURIComponent(workspaceId)}/remove`;
// Pending invites aren't collaborators yet, so they're keyed by invite id.
export const collabRevokeUrl = (workspaceId: string, invitationId: number) =>
  `${API_URL}/gitgraph/collab/${encodeURIComponent(workspaceId)}/revoke/${invitationId}`;

// CLOUD - Endpoints (treat GitHub as the user's OpenSwarm cloud)
export const GITGRAPH_CLOUD_REPOS_URL = API_URL + '/gitgraph/cloud/repos';
export const GITGRAPH_CLOUD_INSTALL_URL = API_URL + '/gitgraph/cloud/install';
export const gitgraphLocalDeleteUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/local-delete/${encodeURIComponent(workspaceId)}`;
// Records with no workspace behind them (what a half-failed cloud install
// leaves): no workspace id to key on, so these delete by output id.
export const gitgraphOrphanDeleteUrl = (outputId: string) =>
  `${API_URL}/gitgraph/orphan-delete/${encodeURIComponent(outputId)}`;

// MARKETPLACE - Endpoints (a public GitHub org IS the marketplace)
export const GITGRAPH_MARKETPLACE_LISTINGS_URL =
  API_URL + '/gitgraph/marketplace/listings';
// The reverse of `installed_workspace_id`: which of *my* apps are live in
// the org, so the rail can group them apart from private and shared.
export const GITGRAPH_MARKETPLACE_PUBLISHED_URL =
  API_URL + '/gitgraph/marketplace/published';
// Scans what publishing would expose. Tracked files only, since that is
// exactly what turns public, and the LLM loop that fixes what it finds.
// Fixes land uncommitted, so the diff shows up in the graph.
export const marketplaceAuditUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/marketplace/audit/${encodeURIComponent(workspaceId)}`;
export const marketplaceAuditFixUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/marketplace/audit/${encodeURIComponent(workspaceId)}/fix`;
// GET asks whether this app may be submitted; POST files the request.
// Approving happens in a different app holding a different credential.
export const marketplacePublishUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/marketplace/publish/${encodeURIComponent(workspaceId)}`;
// Taking an app down is also only a request: the listing is a fork the org
// owns, so the author's token can read it and nothing else.
export const marketplaceTakedownUrl = (workspaceId: string) =>
  `${API_URL}/gitgraph/marketplace/takedown/${encodeURIComponent(workspaceId)}`;

// Installs and deletes only reach the dashboard after OpenSwarm restarts, so
// the app tracks that debt and reports whether one is still owed.
export const GITGRAPH_RESTART_NOTICE_URL = API_URL + '/gitgraph/restart-notice';
export const GITGRAPH_RESTART_NOTICE_DISMISS_URL =
  API_URL + '/gitgraph/restart-notice/dismiss';
// Quits and relaunches OpenSwarm. The backend goes down with it, so this
// request is expected to fail in transit on success.
export const GITGRAPH_RESTART_APP_URL = API_URL + '/gitgraph/restart-app';
