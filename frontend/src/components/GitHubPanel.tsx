import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import GitHubIcon from '@mui/icons-material/GitHub';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  popover,
  primaryButton,
  pushButton,
  slimScroll,
  sunkenField,
} from '@/shared/styles/ui';
import {
  githubAbortRebaseUrl,
  githubCreateRepoUrl,
  githubDisconnectUrl,
  githubPullUrl,
  githubPushUrl,
  githubStatusUrl,
} from '@/shared/state/API_ENDPOINTS';

export interface GitHubStatus {
  connected: boolean;
  account: string | null;
  is_repo: boolean;
  branch: string | null;
  remote_url: string | null;
  owner: string | null;
  repo: string | null;
  html_url: string | null;
  commit_count: number;
  unpushed: number | null;
  behind: number;
  has_remote: boolean;
  rebase_in_progress: boolean;
  conflicts: string[];
}

interface Props {
  workspaceId: string;
  appName: string;
  /** Bumped by the parent after a commit, so the badge re-counts. */
  refreshKey: number;
  /** A pull rewrites history, so the graph above has to redraw. */
  onSynced?: () => void;
}

/** An app name as the repo name GitHub will get; mirrors the backend slug. */
function slugify(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '')
      .replace(/-{2,}/g, '-')
      .toLowerCase()
      .slice(0, 90) || 'openswarm-app'
  );
}

const GitHubPanel: React.FC<Props> = ({
  workspaceId,
  appName,
  refreshKey,
  onSynced,
}) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<
    'create' | 'push' | 'pull' | 'abort' | 'disconnect' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Conflicted paths from a stopped rebase. Distinct from `error`: this is
  // a state the repo is sitting in, not a message about one failed click.
  const [conflicts, setConflicts] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(githubStatusUrl(workspaceId));
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data: GitHubStatus = await res.json();
      setStatus(data);
      // Trust the repo's own state on every read, so a rebase left over
      // from a previous session still surfaces its conflicts here.
      setConflicts(data.rebase_in_progress ? data.conflicts : []);
    } catch {
      setStatus(null);
    }
  }, [workspaceId]);

  useEffect(() => {
    setError(null);
    setDone(null);
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    setName(slugify(appName));
  }, [appName, workspaceId]);

  const call = async (
    url: string,
    kind: 'create' | 'push' | 'pull' | 'abort' | 'disconnect',
    body?: unknown,
  ) => {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // 409 is the conflict stop: the rebase is paused, not failed, so
        // it gets the file list and an Abort button rather than a plain
        // error line the user can't act on.
        const detail = data?.detail;
        if (res.status === 409 && detail && typeof detail === 'object') {
          setConflicts(detail.conflicts ?? []);
          throw new Error(detail.detail ?? 'This app changed on both sides.');
        }
        throw new Error(
          typeof detail === 'string' ? detail : `Failed (${res.status})`,
        );
      }
      if (kind === 'create') setDone('Private repo created.');
      if (kind === 'push') setDone(`Pushed ${data?.branch ?? ''} to GitHub.`);
      if (kind === 'pull') {
        setConflicts([]);
        setDone(
          data?.already_current
            ? 'Already up to date.'
            : `Pulled ${data?.applied ?? 0} ${data?.applied === 1 ? 'commit' : 'commits'}.`,
        );
      }
      if (kind === 'abort') {
        setConflicts([]);
        setDone('Rebase aborted. Nothing changed.');
      }
      await load();
      onSynced?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  if (!status || !status.is_repo) return null;

  const pending = status.unpushed ?? 0;
  const behind = status.behind ?? 0;
  const stuck = conflicts.length > 0 || status.rebase_in_progress;
  // Incoming work outranks outgoing in the label: a pull has to happen
  // first anyway, and a push that would be rejected shouldn't be the
  // thing the button advertises.
  const label = !status.connected
    ? 'GitHub'
    : !status.has_remote
      ? 'Publish'
      : stuck
        ? 'Conflict'
        : behind > 0
          ? `Pull ${behind}`
          : pending > 0
            ? `Push ${pending}`
            : 'Synced';
  const highlight =
    status.connected && (pending > 0 || behind > 0 || !status.has_remote || stuck);
  // Nothing to push means nothing for the popover to do; leaving it
  // clickable was misleading. The commit link stays reachable via the
  // repo row inside the popover only when there's a reason to open it.
  const isInert = label === 'Synced';

  return (
    <>
      <ButtonBase
        onClick={e => setAnchor(e.currentTarget)}
        disabled={isInert}
        title={isInert ? 'Up to date with GitHub' : undefined}
        sx={{
          ...pushButton(c),
          color: highlight ? c.accent.primary : c.text.secondary,
          borderColor: highlight ? c.accent.primary : c.border.medium,
          '&:disabled': {
            opacity: 0.5,
            cursor: 'default',
            color: c.text.tertiary,
            borderColor: c.border.subtle,
          },
        }}
      >
        <GitHubIcon sx={{ fontSize: 16 }} />
        {label}
      </ButtonBase>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => !busy && setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { ...popover(c), mt: 0.5, width: 340 } } }}
      >
        <Box
          sx={{
            px: 1.5,
            py: '8px',
            borderBottom: `1px solid ${c.border.subtle}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <Typography sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
            GitHub
          </Typography>
          {status.account && (
            <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
              {status.account}
            </Typography>
          )}
        </Box>

        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {!status.connected ? (
            <Typography sx={{ ...c.type.body, color: c.text.secondary }}>
              Connect the GitHub integration in OpenSwarm settings, then reopen
              this panel.
            </Typography>
          ) : !status.has_remote ? (
            <>
              <Typography sx={{ ...c.type.body, color: c.text.secondary }}>
                Create a private repo for this app and push {status.commit_count}{' '}
                {status.commit_count === 1 ? 'commit' : 'commits'}.
              </Typography>
              <InputBase
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="repo-name"
                sx={{
                  ...sunkenField(c),
                  ...c.type.body,
                  fontFamily: c.font.mono,
                  color: c.text.primary,
                  px: 1,
                  py: '5px',
                }}
              />
              <ButtonBase
                disabled={busy !== null || !name.trim()}
                onClick={() =>
                  void call(githubCreateRepoUrl(workspaceId), 'create', {
                    name: name.trim(),
                  })
                }
                sx={{ ...primaryButton(c) }}
              >
                {busy === 'create' ? (
                  <CircularProgress size={12} sx={{ color: "#FFFFFF" }} />
                ) : (
                  'Create private repo'
                )}
              </ButtonBase>
            </>
          ) : (
            <>
              <Box
                component="a"
                href={status.html_url ?? '#'}
                target="_blank"
                rel="noreferrer"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  textDecoration: 'none',
                  ...c.type.body,
                  fontFamily: c.font.mono,
                  color: c.accent.primary,
                  wordBreak: 'break-all',
                }}
              >
                {status.owner}/{status.repo}
                <OpenInNewIcon sx={{ fontSize: 14, flexShrink: 0 }} />
              </Box>

              <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                {status.branch ?? 'no branch'} ·{' '}
                {[
                  behind > 0 ? `${behind} in` : null,
                  pending > 0 ? `${pending} out` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'up to date'}
              </Typography>

              {stuck ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.75,
                    p: 1,
                    borderRadius: `${c.radius.sm}px`,
                    background: c.status.errorBg,
                  }}
                >
                  <Typography sx={{ ...c.type.caption, color: c.status.error }}>
                    Both sides changed{' '}
                    {conflicts.length === 1
                      ? 'this file'
                      : `these ${conflicts.length} files`}
                    . Fix them in your editor and finish the rebase, or back out.
                  </Typography>
                  <Box
                    sx={{
                      ...c.type.caption,
                      fontFamily: c.font.mono,
                      color: c.text.secondary,
                      maxHeight: 96,
                      overflowY: 'auto',
                      ...slimScroll(c),
                    }}
                  >
                    {conflicts.map(f => (
                      <Box key={f} sx={{ wordBreak: 'break-all' }}>
                        {f}
                      </Box>
                    ))}
                  </Box>
                  <ButtonBase
                    disabled={busy !== null}
                    onClick={() =>
                      void call(githubAbortRebaseUrl(workspaceId), 'abort')
                    }
                    sx={{ ...pushButton(c), alignSelf: 'flex-start' }}
                  >
                    {busy === 'abort' ? (
                      <CircularProgress size={12} />
                    ) : (
                      'Abort, keep mine'
                    )}
                  </ButtonBase>
                </Box>
              ) : (
                behind > 0 && (
                  <ButtonBase
                    disabled={busy !== null}
                    onClick={() => void call(githubPullUrl(workspaceId), 'pull')}
                    sx={{ ...primaryButton(c) }}
                  >
                    {busy === 'pull' ? (
                      <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
                    ) : (
                      `Pull ${behind} ${behind === 1 ? 'commit' : 'commits'}`
                    )}
                  </ButtonBase>
                )
              )}

              <ButtonBase
                disabled={busy !== null || pending === 0 || stuck}
                onClick={() => void call(githubPushUrl(workspaceId), 'push')}
                title={
                  stuck
                    ? 'Finish or abort the rebase first'
                    : pending === 0
                      ? 'Nothing to push — origin is up to date'
                      : undefined
                }
                sx={{ ...(behind > 0 || stuck ? pushButton(c) : primaryButton(c)) }}
              >
                {busy === 'push' ? (
                  <CircularProgress size={12} />
                ) : pending === 0 ? (
                  'Up to date'
                ) : (
                  'Push to GitHub'
                )}
              </ButtonBase>

              <ButtonBase
                disabled={busy !== null}
                onClick={() =>
                  void call(githubDisconnectUrl(workspaceId), 'disconnect')
                }
                sx={{
                  ...c.type.caption,
                  color: c.text.tertiary,
                  alignSelf: 'flex-start',
                  px: '4px',
                  borderRadius: `${c.radius.xs}px`,
                  '&:hover': { color: c.status.error },
                }}
              >
                Disconnect remote
              </ButtonBase>
            </>
          )}

          {error && (
            <Typography sx={{ ...c.type.caption, color: c.status.error }}>
              {error}
            </Typography>
          )}
          {done && !error && (
            <Typography sx={{ ...c.type.caption, color: c.status.success }}>
              {done}
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  );
};

export default GitHubPanel;
