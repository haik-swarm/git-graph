import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  GITGRAPH_RESTART_NOTICE_DISMISS_URL,
  GITGRAPH_RESTART_NOTICE_URL,
} from '@/shared/state/API_ENDPOINTS';

interface NoticeEvent {
  action: string;
  app_name: string;
  at: number;
}

/**
 * Standing notice that installs/deletes are waiting on an OpenSwarm restart.
 *
 * Deliberately a banner and not a toast: "you still need to restart" stays
 * true until the user acts on it, so it has to survive navigation and
 * reloads. It clears itself once OpenSwarm actually restarts (the backend
 * compares the host's boot time against the one recorded when the change
 * happened), which is why there's no restart button here — this app doesn't
 * touch the host, it only reports what's owed.
 */
export const RestartNotice: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const c = useClaudeTokens();
  const [pending, setPending] = useState(false);
  const [events, setEvents] = useState<NoticeEvent[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(GITGRAPH_RESTART_NOTICE_URL);
      if (!res.ok) return;
      const data = await res.json();
      setPending(Boolean(data?.pending));
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch {
      // A failed poll shouldn't clear a notice that may still be owed.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Re-check on focus: the user may have restarted OpenSwarm in the meantime,
  // which is exactly when the banner should disappear on its own.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const dismiss = useCallback(async () => {
    setPending(false);
    try {
      await fetch(GITGRAPH_RESTART_NOTICE_DISMISS_URL, { method: 'POST' });
    } catch {
      void load();
    }
  }, [load]);

  if (!pending) return null;

  const names = events.slice(-3).map(e => e.app_name);
  const detail =
    events.length === 0
      ? null
      : `${names.join(', ')}${events.length > names.length ? ` and ${events.length - names.length} more` : ''}`;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 3,
        py: 1.25,
        flexShrink: 0,
        background: c.status.warningBg,
        borderBottom: `1px solid ${c.border.subtle}`,
      }}
    >
      <RestartAltRoundedIcon sx={{ fontSize: 18, color: c.status.warning, flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ fontSize: 13, fontWeight: 600, color: c.text.primary }}>
          Restart OpenSwarm for these changes to take effect
        </Box>
        {detail && (
          <Box
            sx={{
              fontSize: 12,
              color: c.text.secondary,
              mt: 0.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {detail}
          </Box>
        )}
      </Box>
      <ButtonBase
        onClick={() => void dismiss()}
        aria-label="Dismiss restart notice"
        sx={{
          width: 28,
          height: 28,
          borderRadius: '8px',
          flexShrink: 0,
          color: c.text.tertiary,
          '&:hover': { background: c.border.subtle, color: c.text.primary },
        }}
      >
        <CloseRoundedIcon sx={{ fontSize: 16 }} />
      </ButtonBase>
    </Box>
  );
};
