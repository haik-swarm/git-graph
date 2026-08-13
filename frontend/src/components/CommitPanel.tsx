import React, { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import CheckIcon from '@mui/icons-material/Check';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { popover, primaryButton, slimScroll, sunkenField } from '@/shared/styles/ui';
import { gitgraphCreateCommitUrl } from '@/shared/state/API_ENDPOINTS';

export interface DirtyFile {
  code: string;
  path: string;
  unstaged: boolean;
  orig_path?: string;
}

interface Props {
  workspaceId: string;
  dirty: DirtyFile[];
  onCommitted: () => void;
}

/** git's two-letter status codes, as the words a person would use. */
function describe(code: string): { label: string; tone: 'add' | 'edit' | 'remove' } {
  if (code === '??') return { label: 'new', tone: 'add' };
  if (code.includes('D')) return { label: 'deleted', tone: 'remove' };
  if (code.includes('A')) return { label: 'added', tone: 'add' };
  if (code.includes('R')) return { label: 'renamed', tone: 'edit' };
  return { label: 'modified', tone: 'edit' };
}

const CommitPanel: React.FC<Props> = ({ workspaceId, dirty, onCommitted }) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [message, setMessage] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Everything starts checked: committing all pending work is the common
  // case, and unchecking a few is less work than checking most.
  useEffect(() => {
    setChosen(new Set(dirty.map(f => f.path)));
    setError(null);
  }, [dirty, workspaceId]);

  const allChosen = chosen.size === dirty.length && dirty.length > 0;
  const canCommit = chosen.size > 0 && message.trim().length > 0 && !busy;

  const toneColor = useMemo(
    () => ({
      add: c.status.success,
      edit: c.status.warning,
      remove: c.status.error,
    }),
    [c],
  );

  const toggle = (path: string) => {
    setChosen(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(gitgraphCreateCommitUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), paths: [...chosen] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `Commit failed (${res.status})`);
      }
      setMessage('');
      setAnchor(null);
      onCommitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ButtonBase
        onClick={e => setAnchor(e.currentTarget)}
        sx={{
          height: 22,
          px: '8px',
          borderRadius: `${c.radius.sm}px`,
          ...c.type.caption,
          color: c.status.warning,
          border: `1px solid ${c.status.warning}`,
          transition: c.transition,
          '&:hover': { background: c.bg.secondary },
        }}
      >
        {dirty.length} uncommitted
      </ButtonBase>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => !busy && setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { ...popover(c), mt: 0.5, width: 380 } } }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 1.5,
            py: '8px',
            borderBottom: `1px solid ${c.border.subtle}`,
          }}
        >
          <Typography sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
            Uncommitted changes
          </Typography>
          <ButtonBase
            onClick={() =>
              setChosen(allChosen ? new Set() : new Set(dirty.map(f => f.path)))
            }
            sx={{
              ...c.type.callout,
              color: c.accent.primary,
              px: '4px',
              borderRadius: `${c.radius.xs}px`,
            }}
          >
            {allChosen ? 'Deselect all' : 'Select all'}
          </ButtonBase>
        </Box>

        <Box sx={{ maxHeight: 240, overflowY: 'auto', p: '4px', ...slimScroll(c) }}>
          {dirty.map(file => {
            const { label, tone } = describe(file.code);
            const isChosen = chosen.has(file.path);
            return (
              <Box
                key={file.path}
                component="button"
                onClick={() => toggle(file.path)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  width: '100%',
                  px: '8px',
                  py: '5px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderRadius: `${c.radius.sm}px`,
                  '&:hover': { background: c.bg.secondary },
                }}
              >
                <Box
                  sx={{
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    borderRadius: `${c.radius.xs}px`,
                    border: `1px solid ${isChosen ? c.accent.primary : c.border.subtle}`,
                    background: isChosen ? c.accent.primary : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isChosen && (
                    <CheckIcon sx={{ fontSize: 14, color: "#FFFFFF" }} />
                  )}
                </Box>

                <Typography
                  sx={{
                    ...c.type.caption,
                    fontFamily: c.font.mono,
                    color: c.text.secondary,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    direction: 'rtl',
                    textAlignLast: 'left',
                  }}
                >
                  {file.path}
                </Typography>

                <Typography
                  sx={{ ...c.type.caption, color: toneColor[tone], flexShrink: 0 }}
                >
                  {label}
                </Typography>
              </Box>
            );
          })}
        </Box>

        <Box
          sx={{
            p: 1.5,
            borderTop: `1px solid ${c.border.subtle}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <InputBase
            multiline
            minRows={2}
            maxRows={5}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Commit message"
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) {
                void submit();
              }
            }}
            sx={{
              ...sunkenField(c),
              ...c.type.body,
              color: c.text.primary,
              px: 1,
              py: '6px',
              '& textarea::placeholder': { color: c.text.muted, opacity: 1 },
            }}
          />

          {error && (
            <Typography sx={{ ...c.type.caption, color: c.status.error }}>
              {error}
            </Typography>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ ...c.type.caption, color: c.text.tertiary, flex: 1 }}>
              {chosen.size} of {dirty.length} selected
            </Typography>
            <ButtonBase
              disabled={!canCommit}
              onClick={() => void submit()}
              sx={{ ...primaryButton(c) }}
            >
              {busy ? (
                <CircularProgress size={12} sx={{ color: "#FFFFFF" }} />
              ) : (
                'Commit'
              )}
            </ButtonBase>
          </Box>
        </Box>
      </Popover>
    </>
  );
};

export default CommitPanel;
