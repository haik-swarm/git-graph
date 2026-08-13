import React, { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import HistoryIcon from '@mui/icons-material/History';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { popover, primaryButton } from '@/shared/styles/ui';
import { gitgraphRestoreUrl } from '@/shared/state/API_ENDPOINTS';

interface Props {
  workspaceId: string;
  sha: string;
  shortSha: string;
  subject: string;
  isHead: boolean;
  // Name of an existing local branch whose tip is this commit. If set,
  // the control is presented as "Switch to <branch>" and the backend
  // will check that branch out directly instead of forking a new one.
  switchTo: string | null;
  onRestored: () => void;
}

interface RestoreResult {
  branch: string;
  sha: string;
  created: boolean;
  noop: boolean;
  switched: boolean;
  previous_branch: string | null;
}

const RestoreControl: React.FC<Props> = ({
  workspaceId,
  sha,
  shortSha,
  subject,
  isHead,
  switchTo,
  onRestored,
}) => {
  const isSwitch = Boolean(switchTo) && !isHead;
  const chipLabel = isSwitch ? `Switch to ${switchTo}` : 'Restore';
  const ChipIcon = isSwitch ? CallSplitIcon : HistoryIcon;
  const primaryLabel = isSwitch ? 'Switch' : 'Restore';
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
      setError(err instanceof Error ? err.message : "We couldn't restore that commit.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ButtonBase
        onClick={open}
        title={
          isHead
            ? 'This commit is the current tip'
            : isSwitch
              ? `Switch to ${switchTo} at ${shortSha}`
              : `Restore to ${shortSha} on a new branch`
        }
        sx={{
          height: 22,
          px: '8px',
          gap: '4px',
          borderRadius: `${c.radius.sm}px`,
          ...c.type.caption,
          color: c.text.secondary,
          border: `1px solid ${c.border.subtle}`,
          background: c.bg.surface,
          transition: c.transition,
          '&:hover': { color: c.accent.primary, borderColor: c.accent.primary, background: c.bg.secondary },
        }}
      >
        <ChipIcon sx={{ fontSize: 14 }} />
        {chipLabel}
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
            borderBottom: `1px solid ${c.border.subtle}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <ChipIcon sx={{ fontSize: 14, color: c.accent.primary }} />
          <Typography sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
            {isSwitch ? `Switch to ${switchTo}` : 'Restore'}
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
                {isSwitch ? (
                  <>
                    Checks out{' '}
                    <Box
                      component="span"
                      sx={{ fontFamily: c.font.mono, color: c.text.primary }}
                    >
                      {switchTo}
                    </Box>{' '}
                    at this commit and updates your files to match. Nothing
                    gets rewritten; your current branch stays where it is.
                  </>
                ) : (
                  <>
                    Creates a new branch{' '}
                    <Box
                      component="span"
                      sx={{ fontFamily: c.font.mono, color: c.text.primary }}
                    >
                      restore/{shortSha}
                    </Box>{' '}
                    at this commit and switches to it. Nothing gets rewritten,
                    and your current branch stays where it is.
                  </>
                )}
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
                    '&:hover': { background: c.bg.secondary },
                  }}
                >
                  Cancel
                </ButtonBase>
                <ButtonBase
                  disabled={busy || isHead}
                  onClick={confirm}
                  sx={{ ...primaryButton(c) }}
                >
                  {busy ? (
                    <CircularProgress size={12} sx={{ color: "#FFFFFF" }} />
                  ) : isHead ? (
                    'Already here'
                  ) : (
                    primaryLabel
                  )}
                </ButtonBase>
              </Box>
            </>
          )}

          {error && (
            <>
              <Typography sx={{ ...c.type.body, color: c.status.error }}>
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
                    color: c.accent.primary,
                    border: `1px solid ${c.accent.primary}`,
                    '&:hover': { background: c.bg.secondary },
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
                {result.noop
                  ? 'Already on this commit.'
                  : result.switched
                    ? 'Switched.'
                    : 'Restored.'}
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
                    color: c.accent.primary,
                    border: `1px solid ${c.accent.primary}`,
                    '&:hover': { background: c.bg.secondary },
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
