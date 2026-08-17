import React, { useState } from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { gitgraphMagicDraftUrl } from '@/shared/state/API_ENDPOINTS';

interface Props {
  workspaceId: string;
  /** Fires before the request so the card can open the message field. */
  onStart: () => void;
  onDrafted: (message: string) => void;
  onError: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

/**
 * Writes a commit message from the working tree and hands it back. It never
 * commits: the message lands in the card's own field, where it reads and
 * edits like anything the user typed.
 */
const MagicDraftButton: React.FC<Props> = ({
  workspaceId,
  onStart,
  onDrafted,
  onError,
  onBusyChange,
}) => {
  const c = useClaudeTokens();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    onBusyChange?.(true);
    onStart();
    try {
      const res = await fetch(gitgraphMagicDraftUrl(workspaceId), { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `Draft failed (${res.status})`);
      }
      const data: { message: string } = await res.json();
      onDrafted(data.message);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Draft failed.');
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <ButtonBase
      onClick={() => void run()}
      disabled={busy}
      title="Write a commit message from these changes"
      sx={{
        height: 22,
        px: '8px',
        gap: '5px',
        borderRadius: `${c.radius.sm}px`,
        ...c.type.caption,
        color: c.accent.primary,
        border: `1px solid ${c.accent.primary}`,
        transition: c.transition,
        '&:hover': { background: c.bg.secondary },
        '&:disabled': { opacity: 0.65 },
      }}
    >
      {busy ? (
        <CircularProgress size={10} sx={{ color: c.accent.primary }} />
      ) : (
        <AutoAwesomeIcon sx={{ fontSize: 14 }} />
      )}
      {busy ? 'Writing…' : 'Write message'}
    </ButtonBase>
  );
};

export default MagicDraftButton;
