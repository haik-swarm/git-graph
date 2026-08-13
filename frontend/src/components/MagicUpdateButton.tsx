import React, { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { popover, slimScroll } from '@/shared/styles/ui';
import { gitgraphMagicUpdateUrl } from '@/shared/state/API_ENDPOINTS';

interface Props {
  workspaceId: string;
  hasRemote: boolean;
  onDone: () => void;
  onBusyChange?: (busy: boolean) => void;
}

interface Result {
  sha: string;
  message: string;
  paths: string[];
  pushed: boolean;
  push_error: string;
}

const MagicUpdateButton: React.FC<Props> = ({
  workspaceId,
  hasRemote,
  onDone,
  onBusyChange,
}) => {
  const c = useClaudeTokens();
  const [busy, setBusyRaw] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setBusy = (next: boolean) => {
    setBusyRaw(next);
    onBusyChange?.(next);
  };

  // Refresh the parent (which re-renders us out of existence when dirty
  // becomes 0) only after the user has actually dismissed the popover,
  // so the AI's message stays visible long enough to read.
  const closeAndNotify = () => {
    if (busy) return;
    const shouldNotify = result !== null;
    setAnchor(null);
    setResult(null);
    setError(null);
    if (shouldNotify) onDone();
  };

  const run = async (e: React.MouseEvent<HTMLElement>) => {
    const target = e.currentTarget;
    setBusy(true);
    setError(null);
    setResult(null);
    setAnchor(target);
    try {
      const res = await fetch(gitgraphMagicUpdateUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ push: hasRemote }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `Magic update failed (${res.status})`);
      }
      const data: Result = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Magic update failed.');
    } finally {
      setBusy(false);
    }
  };

  const summary = result?.message.split('\n')[0] ?? '';
  const body = result?.message.split('\n').slice(1).join('\n').trim() ?? '';

  return (
    <>
      <ButtonBase
        onClick={run}
        disabled={busy}
        title={hasRemote ? 'Draft a commit and push in one shot' : 'Draft a commit from your changes'}
        sx={{
          height: 22,
          px: '8px',
          gap: '5px',
          borderRadius: `${c.radius.sm}px`,
          ...c.type.caption,
          color: c.accent.base,
          border: `0.5px solid ${c.accent.base}`,
          transition: c.transition,
          '&:hover': { background: c.bg.fill },
          '&:disabled': { opacity: 0.65 },
        }}
      >
        {busy ? (
          <CircularProgress size={10} sx={{ color: c.accent.base }} />
        ) : (
          <AutoAwesomeIcon sx={{ fontSize: 12 }} />
        )}
        {busy ? 'Thinking…' : 'Magic update'}
      </ButtonBase>

      <Popover
        open={Boolean(anchor) && (busy || result !== null || error !== null)}
        anchorEl={anchor}
        onClose={closeAndNotify}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { ...popover(c), mt: 0.5, width: 380 } } }}
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
          <AutoAwesomeIcon sx={{ fontSize: 13, color: c.accent.base }} />
          <Typography sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
            Magic update
          </Typography>
          {result && (
            <Typography
              sx={{ ...c.type.caption, color: c.text.tertiary, fontFamily: c.font.mono }}
            >
              {result.sha.slice(0, 7)}
            </Typography>
          )}
        </Box>

        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {busy && (
            <Typography sx={{ ...c.type.body, color: c.text.secondary }}>
              Reading your diff and writing a commit message…
            </Typography>
          )}

          {error && (
            <Typography sx={{ ...c.type.body, color: c.status.danger }}>
              {error}
            </Typography>
          )}

          {result && (
            <>
              <Typography sx={{ ...c.type.body, color: c.text.primary, fontWeight: 500 }}>
                {summary}
              </Typography>
              {body && (
                <Box
                  sx={{
                    ...c.type.caption,
                    color: c.text.secondary,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 160,
                    overflowY: 'auto',
                    ...slimScroll(c),
                  }}
                >
                  {body}
                </Box>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: '4px' }}>
                <Typography sx={{ ...c.type.caption, color: c.text.tertiary, flex: 1 }}>
                  {result.paths.length} file{result.paths.length === 1 ? '' : 's'} committed
                </Typography>
                <Typography
                  sx={{
                    ...c.type.caption,
                    color: result.pushed
                      ? c.status.success
                      : result.push_error
                        ? c.status.danger
                        : c.text.tertiary,
                  }}
                >
                  {result.pushed
                    ? 'pushed'
                    : result.push_error
                      ? 'push failed'
                      : 'not pushed'}
                </Typography>
              </Box>
              {result.push_error && (
                <Typography sx={{ ...c.type.caption, color: c.status.danger }}>
                  {result.push_error}
                </Typography>
              )}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: '4px' }}>
                <ButtonBase
                  onClick={closeAndNotify}
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

export default MagicUpdateButton;
