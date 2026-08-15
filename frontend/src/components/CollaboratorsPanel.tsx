import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  destructiveIconButton,
  popover,
  primaryButton,
  pushButton,
  slimScroll,
  statusChip,
  sunkenField,
} from '@/shared/styles/ui';
import {
  collabInviteUrl,
  collabListUrl,
  collabRemoveUrl,
  collabRevokeUrl,
} from '@/shared/state/API_ENDPOINTS';

export interface Person {
  login: string | null;
  avatar_url: string | null;
  html_url: string | null;
  role: string;
  is_owner: boolean;
  is_viewer: boolean;
  pending: boolean;
  invitation_id: number | null;
}

interface CollabState {
  connected: boolean;
  has_remote: boolean;
  owner?: string;
  repo?: string;
  html_url?: string;
  people: Person[];
  viewer: string | null;
  can_manage: boolean;
  error?: string;
}

interface Props {
  workspaceId: string;
  /** Bumped by the parent after a push/pull, so the roster re-reads. */
  refreshKey: number;
  /** Fired after an invite or removal, so the rail can regroup this app. */
  onRosterChanged?: () => void;
}

const Avatar: React.FC<{ person: Person; size?: number }> = ({ person, size = 24 }) => {
  const c = useClaudeTokens();
  const initial = (person.login ?? '?').slice(0, 1).toUpperCase();
  return person.avatar_url ? (
    <Box
      component="img"
      src={person.avatar_url}
      alt={person.login ?? ''}
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        // A pending invite hasn't been accepted, so its row reads as
        // provisional rather than as someone who already has access.
        opacity: person.pending ? 0.5 : 1,
      }}
    />
  ) : (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        background: c.bg.secondary,
        color: c.text.tertiary,
        ...c.type.caption,
      }}
    >
      {initial}
    </Box>
  );
};

/**
 * Who can work on this app. Invites go through GitHub collaborators, so
 * the person accepts on GitHub and the repo then appears in their own
 * Cloud sheet ready to install.
 */
const CollaboratorsPanel: React.FC<Props> = ({ workspaceId, refreshKey, onRosterChanged }) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<CollabState | null>(null);
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(collabListUrl(workspaceId));
      if (!res.ok) throw new Error(`status ${res.status}`);
      setState(await res.json());
    } catch {
      setState(null);
    }
  }, [workspaceId]);

  useEffect(() => {
    setError(null);
    setDone(null);
    void load();
  }, [load, refreshKey]);

  const invite = async () => {
    const name = handle.trim().replace(/^@/, '');
    if (!name) return;
    setBusy('invite');
    setError(null);
    setDone(null);
    try {
      const res = await fetch(collabInviteUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, permission: 'push' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail ?? `Failed (${res.status})`);
      setDone(
        data?.already
          ? `${name} already had access.`
          : `Invited ${name}. They'll get an email from GitHub.`,
      );
      setHandle('');
      await load();
      onRosterChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const drop = async (person: Person) => {
    const key = person.login ?? String(person.invitation_id);
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      // A pending invite isn't a collaborator yet, so it has its own path.
      const url =
        person.pending && person.invitation_id !== null
          ? collabRevokeUrl(workspaceId, person.invitation_id)
          : collabRemoveUrl(workspaceId);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: person.login ?? '' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail ?? `Failed (${res.status})`);
      setDone(person.pending ? 'Invite cancelled.' : `Removed ${person.login}.`);
      await load();
      onRosterChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  // Nothing to share until the app has a repo behind it.
  if (!state || !state.connected || !state.has_remote) return null;

  const others = state.people.filter(p => !p.is_viewer);
  const count = others.length;

  return (
    <>
      <ButtonBase
        onClick={e => setAnchor(e.currentTarget)}
        sx={{ ...pushButton(c), color: c.text.secondary }}
      >
        <GroupRoundedIcon sx={{ fontSize: 16 }} />
        {count > 0 ? `${count + 1}` : 'Share'}
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
            People
          </Typography>
          {state.owner && (
            <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
              {state.owner}/{state.repo}
            </Typography>
          )}
        </Box>

        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {state.can_manage ? (
            <>
              <Typography sx={{ ...c.type.body, color: c.text.secondary }}>
                Invite someone by GitHub username. They accept on GitHub, then
                the app shows up in their cloud.
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.75 }}>
                <InputBase
                  value={handle}
                  onChange={e => setHandle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !busy) void invite();
                  }}
                  placeholder="github-username"
                  sx={{
                    ...sunkenField(c),
                    ...c.type.body,
                    flex: 1,
                    fontFamily: c.font.mono,
                    color: c.text.primary,
                    px: 1,
                    py: '5px',
                  }}
                />
                <ButtonBase
                  disabled={busy !== null || !handle.trim()}
                  onClick={() => void invite()}
                  sx={{ ...primaryButton(c), px: '12px' }}
                >
                  {busy === 'invite' ? (
                    <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
                  ) : (
                    'Invite'
                  )}
                </ButtonBase>
              </Box>
            </>
          ) : (
            <Typography sx={{ ...c.type.body, color: c.text.secondary }}>
              You have access to this app, but only an admin can invite others.
            </Typography>
          )}

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              maxHeight: 220,
              overflowY: 'auto',
              ...slimScroll(c),
            }}
          >
            {state.people.map(person => (
              <Box
                key={person.login ?? `invite-${person.invitation_id}`}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  py: '6px',
                }}
              >
                <Avatar person={person} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      ...c.type.body,
                      color: c.text.primary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {person.login}
                    {person.is_viewer && (
                      <Box component="span" sx={{ color: c.text.tertiary }}>
                        {' '}
                        (you)
                      </Box>
                    )}
                  </Typography>
                </Box>

                {person.pending ? (
                  <Box sx={{ ...statusChip(c, 'warning') }}>
                    <ScheduleRoundedIcon />
                    Invited
                  </Box>
                ) : person.is_owner ? (
                  <Box sx={{ ...statusChip(c, 'neutral') }}>Owner</Box>
                ) : null}

                {state.can_manage && !person.is_owner && !person.is_viewer && (
                  <Tooltip title={person.pending ? 'Cancel invite' : 'Remove'}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={busy !== null}
                        onClick={() => void drop(person)}
                        sx={{ ...destructiveIconButton(c, 26) }}
                      >
                        {busy === (person.login ?? String(person.invitation_id)) ? (
                          <CircularProgress size={12} />
                        ) : (
                          <CloseRoundedIcon sx={{ fontSize: 14 }} />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
              </Box>
            ))}
          </Box>

          {state.error && (
            <Typography sx={{ ...c.type.caption, color: c.status.error }}>
              {state.error}
            </Typography>
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

export default CollaboratorsPanel;
