import React, { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import HistoryIcon from '@mui/icons-material/History';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { popover, primaryButton } from '@/shared/styles/ui';
import { gitgraphRestoreUrl } from '@/shared/state/API_ENDPOINTS';

interface Props {
  workspaceId: string;
  sha: string;
  shortSha: string;
  subject: string;
  isHead: boolean;
  onRestored: () => void;
}

interface RestoreResult {
  branch: string;
  sha: string;
  created: boolean;
  noop: boolean;
  previous_branch: string | null;
}

const RestoreControl: React.FC<Props> = ({
  workspaceId,
  sha,
  shortSha,
  subject,
  isHead,
  onRestored,
}) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);

  const open = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchor(e.currentTarget);
    setError(null);
    setResult(null);
  };

  const close = () => {
    if (busy) return;
    const shouldNotify = result !== null;
    setAnchor(null);
    setError(null);
    setResult(null);
    if (shouldNotify) onRestored();
  };

  const confirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(gitgraphRestoreUrl(workspaceId, sha), { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `Restore failed (${res.status})`);
      }
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ButtonBase
        onClick={open}
        title={isHead ? 'This commit is the current tip' : `Restore to ${shortSha} on a new branch`}
        sx={{
          height: 22,
          px: '8px',
          gap: '4px',
          borderRadius: `${c.radius.sm}px`,
          ...c.type.caption,
          color: c.text.secondary,
          border: `0.5px solid ${c.border}`,
          background: c.bg.raised,
          transition: c.transition,
          '&:hover': { color: c.accent.base, borderColor: c.accent.base, background: c.bg.fill },
        }}
      >
        <HistoryIcon sx={{ fontSize: 12 }} />
        Restore
      </ButtonBase>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        onClick={e => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { ...popover(c), mt: 0.5, width: 320 } } }}
      >
        <Box
          sx={{
            px: 1.5,
            py: '10px',
            borderBottom: `0.5px solid ${c.separator}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <HistoryIcon sx={{ fontSize: 13, color: c.accent.base }} />
          <Typography sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
            Restore
          </Typography>
          <Typography
            sx={{ ...c.type.caption, color: c.text.tertiary, fontFamily: c.font.mono }}
          >
            {shortSha}
          </Typography>
        </Box>

        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {!result && !error && (
            <>
              <Typography sx={{ ...c.type.body, color: c.text.primary }}>
                {subject}
              </Typography>
              <Typography sx={{ ...c.type.caption, color: c.text.secondary }}>
                Creates a new branch{' '}
                <Box
                  component="span"
                  sx={{ fontFamily: c.font.mono, color: c.text.primary }}
                >
                  restore/{shortSha}
                </Box>{' '}
                at this commit and switches to it. Nothing gets rewritten, and
                your current branch stays where it is.
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: '4px' }}>
                <ButtonBase
                  onClick={close}
                  disabled={busy}
                  sx={{
                    height: 26,
                    px: '10px',
                    borderRadius: `${c.radius.sm}px`,
                    ...c.type.caption,
                    color: c.text.secondary,
                    '&:hover': { background: c.bg.fill },
                  }}
                >
                  Cancel
                </ButtonBase>
                <ButtonBase
                  disabled={busy || isHead}
                  onClick={confirm}
                  sx={{ ...primaryButton(c), height: 26 }}
                >
                  {busy ? (
                    <CircularProgress size={12} sx={{ color: c.text.onAccent }} />
                  ) : isHead ? (
                    'Already here'
                  ) : (
                    'Restore'
                  )}
                </ButtonBase>
              </Box>
            </>
          )}

          {error && (
            <>
              <Typography sx={{ ...c.type.body, color: c.status.danger }}>
                {error}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: '4px' }}>
                <ButtonBase
                  onClick={close}
                  sx={{
                    height: 24,
                    px: '10px',
                    borderRadius: `${c.radius.sm}px`,
                    ...c.type.caption,
                    color: c.accent.base,
                    border: `0.5px solid ${c.accent.base}`,
                    '&:hover': { background: c.bg.fill },
                  }}
                >
                  Close
                </ButtonBase>
              </Box>
            </>
          )}

          {result && (
            <>
              <Typography sx={{ ...c.type.body, color: c.text.primary }}>
                {result.noop ? 'Already on this commit.' : 'Restored.'}
              </Typography>
              <Typography sx={{ ...c.type.caption, color: c.text.secondary }}>
                Now on{' '}
                <Box
                  component="span"
                  sx={{ fontFamily: c.font.mono, color: c.text.primary }}
                >
                  {result.branch}
                </Box>
                {result.previous_branch &&
                  result.previous_branch !== result.branch && (
                    <>
                      {' '}(was on{' '}
                      <Box
                        component="span"
                        sx={{ fontFamily: c.font.mono, color: c.text.primary }}
                      >
                        {result.previous_branch}
                      </Box>
                      ).
                    </>
                  )}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: '4px' }}>
                <ButtonBase
                  onClick={close}
                  sx={{
                    height: 24,
                    px: '10px',
                    borderRadius: `${c.radius.sm}px`,
                    ...c.type.caption,
                    color: c.accent.base,
                    border: `0.5px solid ${c.accent.base}`,
                    '&:hover': { background: c.bg.fill },
                  }}
                >
                  Done
                </ButtonBase>
              </Box>
            </>
          )}
        </Box>
      </Popover>
    </>
  );
};

export default RestoreControl;
