import React, { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import RestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { popover } from '@/shared/styles/ui';
import { gitgraphDiscardUrl } from '@/shared/state/API_ENDPOINTS';

interface Props {
  workspaceId: string;
  dirtyCount: number;
  onDiscarded: () => void;
}

/**
 * Sibling to the "N uncommitted" chip: throws away the working-tree changes
 * and puts the files back to the current commit. Two clicks (open + confirm)
 * because it's destructive; the confirm popover restates what's about to
 * disappear so it can't happen from muscle memory alone.
 */
const DiscardButton: React.FC<Props> = ({ workspaceId, dirtyCount, onDiscarded }) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setAnchor(null);
    setError(null);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(gitgraphDiscardUrl(workspaceId), { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `Discard failed (${res.status})`);
      }
      setAnchor(null);
      onDiscarded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't discard those changes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ButtonBase
        onClick={e => setAnchor(e.currentTarget)}
        title="Discard uncommitted changes"
        sx={{
          height: 22,
          px: '8px',
          gap: '4px',
          borderRadius: `${c.radius.sm}px`,
          ...c.type.caption,
          color: c.text.secondary,
          border: `1px solid ${c.border.subtle}`,
          transition: c.transition,
          '&:hover': {
            color: c.status.error,
            borderColor: c.status.error,
            background: c.bg.secondary,
          },
        }}
      >
        <RestoreIcon sx={{ fontSize: 14 }} />
        Discard
      </ButtonBase>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
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
          <RestoreIcon sx={{ fontSize: 14, color: c.status.error }} />
          <Typography sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
            Discard changes
          </Typography>
        </Box>

        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography sx={{ ...c.type.body, color: c.text.primary }}>
            Throw away {dirtyCount} uncommitted file{dirtyCount === 1 ? '' : 's'}?
          </Typography>
          <Typography sx={{ ...c.type.caption, color: c.text.secondary }}>
            Your working tree will snap back to the current commit. Tracked
            edits and new untracked files both go. This can't be undone.
          </Typography>

          {error && (
            <Typography sx={{ ...c.type.caption, color: c.status.error }}>
              {error}
            </Typography>
          )}

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
              disabled={busy}
              onClick={() => void confirm()}
              sx={{
                height: 26,
                px: '10px',
                gap: '5px',
                borderRadius: `${c.radius.sm}px`,
                ...c.type.callout,
                fontWeight: 590,
                color: "#FFFFFF",
                background: c.status.error,
                border: 'none',
                boxShadow: c.shadow.sm,
                transition: c.transition,
                '&:hover': { filter: 'brightness(1.08)' },
                '&:disabled': { opacity: 0.5 },
              }}
            >
              {busy ? (
                <CircularProgress size={12} sx={{ color: "#FFFFFF" }} />
              ) : (
                'Discard'
              )}
            </ButtonBase>
          </Box>
        </Box>
      </Popover>
    </>
  );
};

export default DiscardButton;
