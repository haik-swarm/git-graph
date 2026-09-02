import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DownloadIcon from '@mui/icons-material/Download';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  popover,
  primaryButton,
  pushButton,
  slimScroll,
  sunkenField,
} from '@/shared/styles/ui';
import { gitgraphReleaseUrl } from '@/shared/state/API_ENDPOINTS';

interface ReleaseEntry {
  tag: string | null;
  name: string | null;
  html_url: string | null;
  created_at: string | null;
  draft: boolean;
  asset_url: string | null;
  asset_name: string | null;
}

export interface ReleaseStatus {
  connected: boolean;
  is_repo: boolean;
  has_remote: boolean;
  owner: string | null;
  repo: string | null;
  html_url: string | null;
  branch: string | null;
  head_sha: string | null;
  clean: boolean;
  dirty_count: number;
  unpushed: number;
  exportable: boolean;
  export_reason: string;
  next_version: string;
  latest_release: ReleaseEntry | null;
  releases: ReleaseEntry[];
  can_release: boolean;
  blocked: string | null;
}

interface Props {
  workspaceId: string;
  appName: string;
  /** Bumped by the parent after a commit/push, so readiness re-evaluates. */
  refreshKey: number;
  /** A new release changes nothing local, but the parent may want to refresh. */
  onReleased?: () => void;
}

const ReleasePanel: React.FC<Props> = ({
  workspaceId,
  appName,
  refreshKey,
  onReleased,
}) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<ReleaseStatus | null>(null);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(gitgraphReleaseUrl(workspaceId));
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data: ReleaseStatus = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, [workspaceId]);

  useEffect(() => {
    setError(null);
    setDone(null);
    void load();
  }, [load, refreshKey]);

  // Clear any typed override when switching apps, so a version from one app
  // never leaks into the field for another.
  useEffect(() => {
    setVersion('');
    setNotes('');
  }, [workspaceId]);

  const cut = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(gitgraphReleaseUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: version.trim(), notes: notes.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = data?.detail;
        throw new Error(
          typeof detail === 'string' ? detail : `Failed (${res.status})`,
        );
      }
      setDone(`Released ${data?.version ?? ''}.`);
      setVersion('');
      setNotes('');
      await load();
      onReleased?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (!status || !status.is_repo) return null;

  const latest = status.latest_release;
  const label = latest?.tag ? latest.tag : 'Release';
  const highlight = status.can_release;

  return (
    <>
      <ButtonBase
        onClick={e => setAnchor(e.currentTarget)}
        sx={{
          ...pushButton(c),
          color: highlight ? c.accent.primary : c.text.secondary,
          borderColor: highlight ? c.accent.primary : c.border.medium,
        }}
      >
        <LocalOfferIcon sx={{ fontSize: 15 }} />
        {label}
      </ButtonBase>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => !busy && setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { ...popover(c), mt: 0.5, width: 360 } } }}
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
            Publish release
          </Typography>
          {status.owner && status.repo && (
            <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
              {status.owner}/{status.repo}
            </Typography>
          )}
        </Box>

        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {status.blocked ? (
            <Typography sx={{ ...c.type.body, color: c.text.secondary }}>
              {status.blocked}
            </Typography>
          ) : (
            <>
              <Typography sx={{ ...c.type.body, color: c.text.secondary }}>
                Build the <code>.swarm</code> and cut a GitHub Release at the
                pushed HEAD. Anyone can install the attached bundle.
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                  Version
                </Typography>
                <InputBase
                  value={version}
                  onChange={e => setVersion(e.target.value)}
                  placeholder={status.next_version}
                  sx={{
                    ...sunkenField(c),
                    ...c.type.body,
                    fontFamily: c.font.mono,
                    color: c.text.primary,
                    px: 1,
                    py: '5px',
                  }}
                />
                <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                  Auto-increments to {status.next_version}. Override with a
                  vX.Y.Z tag if you want.
                </Typography>
              </Box>

              <InputBase
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Release notes (optional)"
                multiline
                minRows={2}
                maxRows={5}
                sx={{
                  ...sunkenField(c),
                  ...c.type.body,
                  color: c.text.primary,
                  px: 1,
                  py: '5px',
                }}
              />

              <ButtonBase
                disabled={busy}
                onClick={() => void cut()}
                sx={{ ...primaryButton(c) }}
              >
                {busy ? (
                  <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
                ) : (
                  `Publish ${version.trim() || status.next_version}`
                )}
              </ButtonBase>
            </>
          )}

          {status.releases.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                Past releases
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.25,
                  maxHeight: 160,
                  overflowY: 'auto',
                  ...slimScroll(c),
                }}
              >
                {status.releases.map(r => (
                  <Box
                    key={r.tag ?? r.html_url ?? Math.random()}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      py: '3px',
                    }}
                  >
                    <Box
                      component="a"
                      href={r.html_url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        flex: 1,
                        textDecoration: 'none',
                        ...c.type.body,
                        fontFamily: c.font.mono,
                        color: c.accent.primary,
                        wordBreak: 'break-all',
                      }}
                    >
                      {r.tag ?? r.name}
                      <OpenInNewIcon sx={{ fontSize: 13, flexShrink: 0 }} />
                    </Box>
                    {r.asset_url && (
                      <Box
                        component="a"
                        href={r.asset_url}
                        title={r.asset_name ?? 'Download .swarm'}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          color: c.text.tertiary,
                          textDecoration: 'none',
                          '&:hover': { color: c.accent.primary },
                        }}
                      >
                        <DownloadIcon sx={{ fontSize: 15 }} />
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
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

export default ReleasePanel;
