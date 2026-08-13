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

type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number; currentName: string }
  | { kind: 'finished'; ok: string[]; failed: { name: string; error: string }[] };

const BulkActionBar: React.FC<Props> = ({ dirtyApps, onDone }) => {
  const c = useClaudeTokens();
  const [magic, setMagic] = useState<RunState>({ kind: 'idle' });
  const [commitAnchor, setCommitAnchor] = useState<HTMLElement | null>(null);

  const totalDirty = useMemo(
    () => dirtyApps.reduce((sum, d) => sum + d.dirtyCount, 0),
    [dirtyApps],
  );

  const magicBusy = magic.kind === 'running';

  const runMagicAll = async () => {
    if (magicBusy || dirtyApps.length === 0) return;
    const total = dirtyApps.length;
    const ok: string[] = [];
    const failed: { name: string; error: string }[] = [];
    setMagic({ kind: 'running', done: 0, total, currentName: dirtyApps[0].app.name });
    for (let i = 0; i < dirtyApps.length; i++) {
      const { app } = dirtyApps[i];
      setMagic({ kind: 'running', done: i, total, currentName: app.name });
      try {
        const res = await fetch(gitgraphMagicUpdateUrl(app.workspace_id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Push status varies per app; keep bulk mode commit-only and let the
          // user push from an app's page if they want to publish.
          body: JSON.stringify({ push: false }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.detail ?? `magic-update ${res.status}`);
        }
        ok.push(app.workspace_id);
      } catch (err) {
        failed.push({
          name: app.name,
          error: err instanceof Error ? err.message : 'failed',
        });
      }
    }
    setMagic({ kind: 'finished', ok, failed });
    onDone(dirtyApps.map(d => d.app.workspace_id));
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        borderRadius: `${c.radius.xl}px`,
        border: `0.5px solid ${c.border}`,
        background: c.bg.raised,
        boxShadow: c.shadow.control,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: `linear-gradient(180deg, ${c.status.warning}, ${c.accent.base})`,
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
          {magic.kind === 'running' ? (
            <>
              Magic update <b>{magic.done + 1}</b>/{magic.total}: {magic.currentName}…
            </>
          ) : magic.kind === 'finished' ? (
            <>
              {magic.ok.length} committed
              {magic.failed.length > 0
                ? `, ${magic.failed.length} failed (${magic.failed
                    .map(f => f.name)
                    .join(', ')})`
                : ''}
            </>
          ) : (
            'Handle every dirty workspace in one shot, without opening each app.'
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <ButtonBase
          onClick={runMagicAll}
          disabled={magicBusy || dirtyApps.length === 0}
          title="Draft a commit for every dirty app in one shot"
          sx={{
            ...primaryButton(c),
            height: 30,
            px: '12px',
            gap: '6px',
            '& svg': { fontSize: 13 },
          }}
        >
          {magicBusy ? (
            <CircularProgress size={11} sx={{ color: c.text.onAccent }} />
          ) : (
            <AutoAwesomeIcon />
          )}
          {magicBusy ? 'Updating…' : 'Magic update all'}
        </ButtonBase>

        <ButtonBase
          onClick={e => setCommitAnchor(e.currentTarget)}
          disabled={magicBusy}
          sx={{ ...pushButton(c), height: 30, px: '12px' }}
        >
          Commit all…
        </ButtonBase>
      </Box>

      <BulkCommitPopover
        anchor={commitAnchor}
        onClose={() => setCommitAnchor(null)}
        dirtyApps={dirtyApps}
        onDone={ids => {
          setCommitAnchor(null);
          onDone(ids);
        }}
      />
    </Box>
  );
};

interface BulkCommitProps {
  anchor: HTMLElement | null;
  onClose: () => void;
  dirtyApps: DirtyApp[];
  onDone: (workspaceIds: string[]) => void;
}

const BulkCommitPopover: React.FC<BulkCommitProps> = ({
  anchor,
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

  // Reset selection every time the popover opens with a fresh dirty set.
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
  const canCommit = chosen.size > 0 && message.trim().length > 0 && !busy;

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
        const res = await fetch(gitgraphCreateCommitUrl(app.workspace_id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Empty paths → backend commits every dirty file for that app.
          body: JSON.stringify({ message: message.trim(), paths: [] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.detail ?? `commit ${res.status}`);
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
          borderBottom: `0.5px solid ${c.separator}`,
        }}
      >
        <Box sx={{ ...c.type.headline, color: c.text.primary }}>Commit across apps</Box>
        <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: '2px' }}>
          One message, one commit per app, every dirty file in each.
        </Box>
      </Box>

      <Box sx={{ maxHeight: 220, overflowY: 'auto', p: '4px', ...slimScroll(c) }}>
        {dirtyApps.map(({ app, dirtyCount }) => {
          const isChosen = chosen.has(app.workspace_id);
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
                '&:hover': { background: busy ? 'transparent' : c.bg.fill },
              }}
            >
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  flexShrink: 0,
                  borderRadius: `${c.radius.xs}px`,
                  border: `1px solid ${isChosen ? c.accent.base : c.border}`,
                  background: isChosen ? c.accent.base : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isChosen && (
                  <CheckIcon sx={{ fontSize: 11, color: c.text.onAccent }} />
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

              {status === 'ok' && (
                <CheckRoundedIcon sx={{ fontSize: 14, color: c.status.success }} />
              )}
              {status === 'failed' && (
                <ErrorOutlineRoundedIcon sx={{ fontSize: 14, color: c.status.danger }} />
              )}
            </Box>
          );
        })}
      </Box>

      <Box
        sx={{
          p: 1.5,
          borderTop: `0.5px solid ${c.separator}`,
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
          placeholder="Commit message (used for every selected app)"
          disabled={busy}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) {
              void run();
            }
          }}
          sx={{
            ...sunkenField(c),
            ...c.type.body,
            color: c.text.primary,
            px: 1,
            py: '6px',
            '& textarea::placeholder': { color: c.text.quaternary, opacity: 1 },
          }}
        />

        {progress && (
          <Box sx={{ ...c.type.caption, color: c.text.secondary }}>
            Committing <b>{progress.done + 1}</b>/{progress.total}: {progress.currentName}…
          </Box>
        )}

        {result && result.failed.length > 0 && (
          <Box sx={{ ...c.type.caption, color: c.status.danger }}>
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
                  color: c.accent.base,
                  cursor: 'pointer',
                  ...c.type.caption,
                  p: 0,
                }}
              >
                Select all
              </Box>
            )}
          </Box>
          <ButtonBase
            disabled={busy || (!!result && result.failed.length === 0)}
            onClick={result ? closeIfIdle : () => void run()}
            sx={{ ...primaryButton(c), height: 28 }}
          >
            {busy ? (
              <CircularProgress size={12} sx={{ color: c.text.onAccent }} />
            ) : result ? (
              'Done'
            ) : (
              `Commit ${chosen.size} app${chosen.size === 1 ? '' : 's'}`
            )}
          </ButtonBase>
        </Box>
      </Box>
    </Popover>
  );
};

export default BulkActionBar;
