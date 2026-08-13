import React, { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import CheckIcon from '@mui/icons-material/Check';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { popover, primaryButton, pushButton, slimScroll, sunkenField } from '@/shared/styles/ui';
import { BrandGlyph } from '@/components/Chrome';
import {
  gitgraphCreateCommitUrl,
  gitgraphMagicUpdateUrl,
} from '@/shared/state/API_ENDPOINTS';
import type { AppEntry } from '@/components/AppPicker';

interface DirtyApp {
  app: AppEntry;
  dirtyCount: number;
}

interface Props {
  dirtyApps: DirtyApp[];
  onDone: (workspaceIds: string[]) => void;
}

type Mode = 'magic' | 'commit';

const BulkActionBar: React.FC<Props> = ({ dirtyApps, onDone }) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<Mode>('magic');

  const totalDirty = useMemo(
    () => dirtyApps.reduce((sum, d) => sum + d.dirtyCount, 0),
    [dirtyApps],
  );

  const open = (m: Mode) => (e: React.MouseEvent<HTMLElement>) => {
    setMode(m);
    setAnchor(e.currentTarget);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        borderRadius: `${c.radius.xl}px`,
        border: `1px solid ${c.border.subtle}`,
        background: c.bg.surface,
        boxShadow: c.shadow.sm,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: `linear-gradient(180deg, ${c.status.warning}, ${c.accent.primary})`,
        },
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: `${c.radius.md}px`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `rgba(255,149,0,${c.isDark ? 0.2 : 0.14})`,
          color: c.status.warning,
        }}
      >
        <RadioButtonCheckedRoundedIcon sx={{ fontSize: 15 }} />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ ...c.type.headline, color: c.text.primary }}>
          {totalDirty} uncommitted file{totalDirty === 1 ? '' : 's'} across{' '}
          {dirtyApps.length} app{dirtyApps.length === 1 ? '' : 's'}
        </Box>
        <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: '2px' }}>
          Handle every dirty workspace in one shot, or pick which ones.
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <ButtonBase
          onClick={open('magic')}
          disabled={dirtyApps.length === 0}
          title="Draft AI commit messages across apps"
          sx={{
            ...primaryButton(c),
            gap: '6px',
            '& svg': { fontSize: 13 },
          }}
        >
          <AutoAwesomeIcon />
          Magic update…
        </ButtonBase>

        <ButtonBase
          onClick={open('commit')}
          disabled={dirtyApps.length === 0}
          sx={{ ...pushButton(c) }}
        >
          Commit all…
        </ButtonBase>
      </Box>

      <BulkPickerPopover
        anchor={anchor}
        mode={mode}
        onClose={() => setAnchor(null)}
        dirtyApps={dirtyApps}
        onDone={ids => {
          onDone(ids);
        }}
      />
    </Box>
  );
};

interface PickerProps {
  anchor: HTMLElement | null;
  mode: Mode;
  onClose: () => void;
  dirtyApps: DirtyApp[];
  onDone: (workspaceIds: string[]) => void;
}

const BulkPickerPopover: React.FC<PickerProps> = ({
  anchor,
  mode,
  onClose,
  dirtyApps,
  onDone,
}) => {
  const c = useClaudeTokens();
  const [message, setMessage] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    currentName: string;
  } | null>(null);
  const [result, setResult] = useState<{
    ok: string[];
    failed: { name: string; error: string }[];
  } | null>(null);

  React.useEffect(() => {
    if (!anchor) return;
    setChosen(new Set(dirtyApps.map(d => d.app.workspace_id)));
    setResult(null);
    setProgress(null);
  }, [anchor, dirtyApps]);

  const toggle = (id: string) => {
    setChosen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allChosen = chosen.size === dirtyApps.length && dirtyApps.length > 0;
  const needsMessage = mode === 'commit';
  const canRun =
    chosen.size > 0 && !busy && (!needsMessage || message.trim().length > 0);

  const run = async () => {
    const targets = dirtyApps.filter(d => chosen.has(d.app.workspace_id));
    if (targets.length === 0) return;
    setBusy(true);
    setResult(null);
    const ok: string[] = [];
    const failed: { name: string; error: string }[] = [];
    for (let i = 0; i < targets.length; i++) {
      const { app } = targets[i];
      setProgress({ done: i, total: targets.length, currentName: app.name });
      try {
        const res =
          mode === 'magic'
            ? await fetch(gitgraphMagicUpdateUrl(app.workspace_id), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ push: false }),
              })
            : await fetch(gitgraphCreateCommitUrl(app.workspace_id), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message.trim(), paths: [] }),
              });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(
            data?.detail ?? `${mode === 'magic' ? 'magic-update' : 'commit'} ${res.status}`,
          );
        }
        ok.push(app.workspace_id);
      } catch (err) {
        failed.push({
          name: app.name,
          error: err instanceof Error ? err.message : 'failed',
        });
      }
    }
    setProgress(null);
    setResult({ ok, failed });
    setBusy(false);
    onDone(ok);
  };

  const closeIfIdle = () => {
    if (busy) return;
    onClose();
  };

  const title = mode === 'magic' ? 'Magic update across apps' : 'Commit across apps';
  const hint =
    mode === 'magic'
      ? 'AI drafts a commit message per app, using every dirty file.'
      : 'One message, one commit per app, every dirty file in each.';
  const runLabel = (n: number) =>
    mode === 'magic'
      ? `Magic update ${n} app${n === 1 ? '' : 's'}`
      : `Commit ${n} app${n === 1 ? '' : 's'}`;
  const progressVerb = mode === 'magic' ? 'Updating' : 'Committing';

  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={closeIfIdle}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { ...popover(c), mt: 0.5, width: 420 } } }}
    >
      <Box
        sx={{
          px: 1.5,
          py: '10px',
          borderBottom: `1px solid ${c.border.subtle}`,
        }}
      >
        <Box sx={{ ...c.type.headline, color: c.text.primary }}>{title}</Box>
        <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: '2px' }}>{hint}</Box>
      </Box>

      <Box sx={{ maxHeight: 220, overflowY: 'auto', p: '4px', ...slimScroll(c) }}>
        {dirtyApps.map(({ app, dirtyCount }) => {
          const isChosen = chosen.has(app.workspace_id);
          const isCurrent =
            busy &&
            progress?.currentName === app.name &&
            !result?.ok.includes(app.workspace_id) &&
            !result?.failed.find(f => f.name === app.name);
          const status = result
            ? result.ok.includes(app.workspace_id)
              ? 'ok'
              : result.failed.find(f => f.name === app.name)
                ? 'failed'
                : null
            : null;
          return (
            <Box
              key={app.workspace_id}
              component="button"
              onClick={() => !busy && toggle(app.workspace_id)}
              disabled={busy}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                px: '8px',
                py: '6px',
                border: 'none',
                background: 'transparent',
                cursor: busy ? 'default' : 'pointer',
                textAlign: 'left',
                borderRadius: `${c.radius.sm}px`,
                '&:hover': { background: busy ? 'transparent' : c.bg.secondary },
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
                  <CheckIcon sx={{ fontSize: 11, color: "#FFFFFF" }} />
                )}
              </Box>

              <BrandGlyph
                seed={app.workspace_id}
                letter={app.name[0] || '?'}
                size={22}
              />

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box
                  sx={{
                    ...c.type.body,
                    color: c.text.primary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {app.name}
                </Box>
                <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                  {dirtyCount} file{dirtyCount === 1 ? '' : 's'}
                </Box>
              </Box>

              {isCurrent && (
                <CircularProgress size={12} sx={{ color: c.text.tertiary }} />
              )}
              {status === 'ok' && (
                <CheckRoundedIcon sx={{ fontSize: 14, color: c.status.success }} />
              )}
              {status === 'failed' && (
                <ErrorOutlineRoundedIcon sx={{ fontSize: 14, color: c.status.error }} />
              )}
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
        {needsMessage && (
          <InputBase
            multiline
            minRows={2}
            maxRows={5}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Commit message (used for every selected app)"
            disabled={busy}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canRun) {
                void run();
              }
            }}
            sx={{
              ...sunkenField(c),
              ...c.type.body,
              color: c.text.primary,
              px: 1,
              py: '6px',
              '& textarea::placeholder': { color: c.text.ghost, opacity: 1 },
            }}
          />
        )}

        {progress && (
          <Box sx={{ ...c.type.caption, color: c.text.secondary }}>
            {progressVerb} <b>{progress.done + 1}</b>/{progress.total}: {progress.currentName}…
          </Box>
        )}

        {result && result.failed.length > 0 && (
          <Box sx={{ ...c.type.caption, color: c.status.error }}>
            {result.failed.length} failed:{' '}
            {result.failed.map(f => `${f.name} (${f.error})`).join('; ')}
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ ...c.type.caption, color: c.text.tertiary, flex: 1 }}>
            {chosen.size} of {dirtyApps.length} selected
            {!allChosen && dirtyApps.length > 0 && (
              <Box
                component="button"
                onClick={() =>
                  setChosen(new Set(dirtyApps.map(d => d.app.workspace_id)))
                }
                disabled={busy}
                sx={{
                  ml: '6px',
                  border: 'none',
                  background: 'transparent',
                  color: c.accent.primary,
                  cursor: 'pointer',
                  ...c.type.caption,
                  p: 0,
                }}
              >
                All
              </Box>
            )}
            {chosen.size > 0 && (
              <Box
                component="button"
                onClick={() => setChosen(new Set())}
                disabled={busy}
                sx={{
                  ml: '6px',
                  border: 'none',
                  background: 'transparent',
                  color: c.accent.primary,
                  cursor: 'pointer',
                  ...c.type.caption,
                  p: 0,
                }}
              >
                None
              </Box>
            )}
          </Box>
          <ButtonBase
            disabled={result ? false : !canRun}
            onClick={result ? closeIfIdle : () => void run()}
            sx={{ ...primaryButton(c) }}
          >
            {busy ? (
              <CircularProgress size={12} sx={{ color: "#FFFFFF" }} />
            ) : result ? (
              'Done'
            ) : (
              runLabel(chosen.size)
            )}
          </ButtonBase>
        </Box>
      </Box>
    </Popover>
  );
};

export default BulkActionBar;
