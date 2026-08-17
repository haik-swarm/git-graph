import React, { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Collapse from '@mui/material/Collapse';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CheckIcon from '@mui/icons-material/Check';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { primaryButton, pushButton, slimScroll, sunkenField } from '@/shared/styles/ui';
import { BrandGlyph } from '@/components/Chrome';
import BulkAppDetails from '@/components/BulkAppDetails';
import {
  gitgraphCreateCommitUrl,
  gitgraphMagicUpdateUrl,
  githubPushUrl,
} from '@/shared/state/API_ENDPOINTS';
import type { AppEntry } from '@/components/AppPicker';

export interface BulkEntry {
  app: AppEntry;
  /** Dirty files for commit modes, unpushed commits for push mode. */
  count: number;
  hasRemote: boolean;
}

interface Props {
  dirtyApps: BulkEntry[];
  unpushedApps: BulkEntry[];
  onDone: (workspaceIds: string[]) => void;
}

type Mode = 'magic' | 'commit' | 'push';

const BulkActionBar: React.FC<Props> = ({ dirtyApps, unpushedApps, onDone }) => {
  const c = useClaudeTokens();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('magic');
  const [busy, setBusy] = useState(false);

  const totalDirty = useMemo(
    () => dirtyApps.reduce((sum, d) => sum + d.count, 0),
    [dirtyApps],
  );
  const totalUnpushed = useMemo(
    () => unpushedApps.reduce((sum, d) => sum + d.count, 0),
    [unpushedApps],
  );

  const hasDirty = dirtyApps.length > 0;
  const hasUnpushed = unpushedApps.length > 0;

  const defaultMode: Mode = hasDirty ? 'magic' : 'push';

  // A run in flight owns the panel: collapsing would unmount the progress it
  // is reporting into, so the disclosure is inert until it finishes.
  const toggle = (m: Mode) => {
    if (busy) return;
    // Clicking the mode you're already reading closes it; clicking a different
    // one swaps the open panel rather than shutting it.
    if (open && m === mode) {
      setOpen(false);
      return;
    }
    setMode(m);
    setOpen(true);
  };

  // The list is rebuilt from fresh status after every run, so a mode whose
  // work is now done would expand onto an empty panel.
  React.useEffect(() => {
    if (!hasDirty && !hasUnpushed) setOpen(false);
    else if (mode === 'push' && !hasUnpushed) setMode(defaultMode);
    else if (mode !== 'push' && !hasDirty) setMode('push');
  }, [hasDirty, hasUnpushed, mode, defaultMode]);

  const headline = hasDirty
    ? `${totalDirty} uncommitted file${totalDirty === 1 ? '' : 's'} across ${dirtyApps.length} app${dirtyApps.length === 1 ? '' : 's'}`
    : `${totalUnpushed} commit${totalUnpushed === 1 ? '' : 's'} ready to push across ${unpushedApps.length} app${unpushedApps.length === 1 ? '' : 's'}`;

  const subline = !hasDirty
    ? 'Send them all to GitHub in one shot, or pick which ones.'
    : hasUnpushed
      ? `Plus ${totalUnpushed} commit${totalUnpushed === 1 ? '' : 's'} already waiting to push.`
      : 'Handle every dirty workspace in one shot, or pick which ones.';

  return (
    <Box
      sx={{
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
          zIndex: 1,
        },
      }}
    >
      <Box
        onClick={() => toggle(defaultMode)}
        role="button"
        aria-expanded={open}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 1.5,
          cursor: busy ? 'default' : 'pointer',
          transition: c.transition,
          '&:hover': { background: busy ? 'transparent' : c.bg.secondary },
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
          {hasDirty ? (
            <RadioButtonCheckedRoundedIcon sx={{ fontSize: 15 }} />
          ) : (
            <CloudUploadRoundedIcon sx={{ fontSize: 15 }} />
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ ...c.type.headline, color: c.text.primary }}>{headline}</Box>
          <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: '2px' }}>{subline}</Box>
        </Box>

        {/* Each button picks the panel's mode, so a click on one must not also
            toggle the header underneath it back shut. */}
        <Box
          onClick={e => e.stopPropagation()}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}
        >
          {hasDirty && (
            <>
              <ButtonBase
                onClick={() => toggle('magic')}
                title="Draft AI commit messages across apps, then push"
                sx={{
                  ...primaryButton(c),
                  gap: '6px',
                  '& svg': { fontSize: 14 },
                }}
              >
                <AutoAwesomeIcon />
                Magic update…
              </ButtonBase>

              <ButtonBase onClick={() => toggle('commit')} sx={{ ...pushButton(c) }}>
                Commit all…
              </ButtonBase>
            </>
          )}

          {hasUnpushed && (
            <ButtonBase
              onClick={() => toggle('push')}
              title="Push every app that's ahead of its remote"
              sx={{
                ...(hasDirty ? pushButton(c) : primaryButton(c)),
                gap: '6px',
                '& svg': { fontSize: 14 },
              }}
            >
              <CloudUploadRoundedIcon />
              Push all…
            </ButtonBase>
          )}
        </Box>

        <ExpandMoreRoundedIcon
          sx={{
            fontSize: 18,
            flexShrink: 0,
            color: open ? c.accent.primary : c.text.muted,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 180ms ease, color 120ms ease',
          }}
        />
      </Box>

      <Collapse in={open} timeout={180} unmountOnExit>
        <Box sx={{ borderTop: `1px solid ${c.border.subtle}`, pl: '3px' }}>
          <BulkPicker
            mode={mode}
            entries={mode === 'push' ? unpushedApps : dirtyApps}
            onBusyChange={setBusy}
            onClose={() => setOpen(false)}
            onDone={onDone}
          />
        </Box>
      </Collapse>
    </Box>
  );
};

interface PickerProps {
  mode: Mode;
  entries: BulkEntry[];
  onBusyChange: (b: boolean) => void;
  onClose: () => void;
  onDone: (workspaceIds: string[]) => void;
}

interface Outcome {
  ok: string[];
  failed: { id: string; name: string; error: string }[];
  warnings: string[];
}

const BulkPicker: React.FC<PickerProps> = ({
  mode,
  entries,
  onBusyChange,
  onClose,
  onDone,
}) => {
  const c = useClaudeTokens();
  const [message, setMessage] = useState('');
  // Everything starts selected, which is what "all" in the buttons above
  // promises; the checkboxes are there to narrow it, not to build it up.
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(entries.map(d => d.app.workspace_id)),
  );
  const [busy, setBusy] = useState(false);
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    currentId: string;
    currentName: string;
  } | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);

  // Switching mode without collapsing swaps the whole entry list underneath,
  // so a selection carried over would point at apps that aren't listed. Keyed
  // on the ids rather than the array, which the parent rebuilds every render.
  const entryKey = entries.map(d => d.app.workspace_id).join(',');
  React.useEffect(() => {
    setChosen(new Set(entryKey ? entryKey.split(',') : []));
    setResult(null);
    setProgress(null);
    // Push mode's rows list commits where the commit modes list files, so an
    // app left open across the switch would show the wrong half of its work.
    setOpenApp(null);
  }, [mode, entryKey]);

  React.useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const toggle = (id: string) => {
    setChosen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allChosen = chosen.size === entries.length && entries.length > 0;
  const needsMessage = mode === 'commit';
  const canRun =
    chosen.size > 0 && !busy && (!needsMessage || message.trim().length > 0);

  const runOne = async (entry: BulkEntry): Promise<string | null> => {
    const { app, hasRemote } = entry;
    if (mode === 'push') {
      const res = await fetch(githubPushUrl(app.workspace_id), { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `push ${res.status}`);
      }
      return null;
    }

    if (mode === 'magic') {
      const res = await fetch(gitgraphMagicUpdateUrl(app.workspace_id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Same contract as the single-app button: push when there's a
        // remote to push to, so bulk isn't a second-class path.
        body: JSON.stringify({ push: hasRemote }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `magic-update ${res.status}`);
      }
      // The commit landed even when the push leg failed, so this is a
      // warning on a successful row rather than an outright failure.
      const data = await res.json().catch(() => null);
      if (data?.push_error) {
        return `${app.name}: committed, push failed (${data.push_error})`;
      }
      return null;
    }

    const res = await fetch(gitgraphCreateCommitUrl(app.workspace_id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim(), paths: [] }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail ?? `commit ${res.status}`);
    }
    return null;
  };

  const run = async () => {
    const targets = entries.filter(d => chosen.has(d.app.workspace_id));
    if (targets.length === 0) return;
    setBusy(true);
    setResult(null);
    const ok: string[] = [];
    const failed: { id: string; name: string; error: string }[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const entry = targets[i];
      setProgress({
        done: i,
        total: targets.length,
        currentId: entry.app.workspace_id,
        currentName: entry.app.name,
      });
      try {
        const warning = await runOne(entry);
        if (warning) warnings.push(warning);
        ok.push(entry.app.workspace_id);
      } catch (err) {
        failed.push({
          id: entry.app.workspace_id,
          name: entry.app.name,
          error: err instanceof Error ? err.message : 'failed',
        });
      }
    }
    setProgress(null);
    setResult({ ok, failed, warnings });
    setBusy(false);
    onDone(ok);
  };

  const closeIfIdle = () => {
    if (busy) return;
    onClose();
  };

  const title =
    mode === 'magic'
      ? 'Magic update across apps'
      : mode === 'commit'
        ? 'Commit across apps'
        : 'Push across apps';
  const hint =
    mode === 'magic'
      ? 'AI drafts a commit message per app, then pushes anywhere a remote is set.'
      : mode === 'commit'
        ? 'One message, one commit per app, every dirty file in each.'
        : 'Send every selected app’s local commits up to its GitHub remote.';
  const runLabel = (n: number) =>
    mode === 'magic'
      ? `Magic update ${n} app${n === 1 ? '' : 's'}`
      : mode === 'commit'
        ? `Commit ${n} app${n === 1 ? '' : 's'}`
        : `Push ${n} app${n === 1 ? '' : 's'}`;
  const progressVerb =
    mode === 'magic' ? 'Updating' : mode === 'commit' ? 'Committing' : 'Pushing';
  const unit = mode === 'push' ? 'commit' : 'file';

  return (
    <Box>
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

      <Box sx={{ maxHeight: 260, overflowY: 'auto', p: '4px', ...slimScroll(c) }}>
        {entries.map(({ app, count, hasRemote }) => {
          const id = app.workspace_id;
          const isChosen = chosen.has(id);
          const isCurrent = busy && progress?.currentId === id;
          const status = result
            ? result.ok.includes(id)
              ? 'ok'
              : result.failed.find(f => f.id === id)
                ? 'failed'
                : null
            : null;
          const isOpen = openApp === id;
          return (
            <Box
              key={id}
              sx={{
                borderRadius: `${c.radius.sm}px`,
                // An open app and its changes read as one object, the same way
                // an open file row wraps its own patch.
                border: `1px solid ${isOpen ? c.border.subtle : 'transparent'}`,
                background: isOpen ? c.bg.secondary : 'transparent',
                mb: isOpen ? '4px' : 0,
                overflow: 'hidden',
                transition: c.transition,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  px: '8px',
                  py: '6px',
                  '&:hover': { background: busy || isOpen ? 'transparent' : c.bg.secondary },
                }}
              >
                {/* Selecting an app and inspecting it are different questions,
                    so the checkbox keeps its own hit target rather than the
                    whole row meaning one of them. */}
                <ButtonBase
                  onClick={() => !busy && toggle(id)}
                  disabled={busy}
                  aria-label={isChosen ? `Deselect ${app.name}` : `Select ${app.name}`}
                  sx={{
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    borderRadius: `${c.radius.xs}px`,
                    border: `1px solid ${isChosen ? c.accent.primary : c.border.subtle}`,
                    background: isChosen ? c.accent.primary : 'transparent',
                  }}
                >
                  {isChosen && <CheckIcon sx={{ fontSize: 14, color: '#FFFFFF' }} />}
                </ButtonBase>

                <BrandGlyph seed={id} letter={app.name[0] || '?'} size={22} />

                <Box
                  component="button"
                  onClick={() => setOpenApp(prev => (prev === id ? null : id))}
                  aria-expanded={isOpen}
                  title={isOpen ? 'Hide changes' : `View changes in ${app.name}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flex: 1,
                    minWidth: 0,
                    border: 'none',
                    background: 'transparent',
                    p: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'inherit',
                    font: 'inherit',
                    '&:hover .bulk-app-name': { color: c.accent.primary },
                  }}
                >
                  <ChevronRightRoundedIcon
                    sx={{
                      fontSize: 15,
                      flexShrink: 0,
                      color: isOpen ? c.accent.primary : c.text.tertiary,
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: c.transition,
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box
                      className="bulk-app-name"
                      sx={{
                        ...c.type.body,
                        color: isOpen ? c.accent.primary : c.text.primary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        transition: c.transition,
                      }}
                    >
                      {app.name}
                    </Box>
                    <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                      {count} {unit}
                      {count === 1 ? '' : 's'}
                      {mode === 'magic' && !hasRemote && ' · no remote'}
                    </Box>
                  </Box>
                </Box>

                {isCurrent && <CircularProgress size={12} sx={{ color: c.text.tertiary }} />}
                {status === 'ok' && (
                  <CheckRoundedIcon sx={{ fontSize: 14, color: c.status.success }} />
                )}
                {status === 'failed' && (
                  <ErrorOutlineRoundedIcon sx={{ fontSize: 14, color: c.status.error }} />
                )}
              </Box>

              <Collapse in={isOpen} timeout={180} unmountOnExit>
                <Box sx={{ borderTop: `1px solid ${c.border.subtle}`, background: c.bg.surface }}>
                  <BulkAppDetails
                    workspaceId={id}
                    open={isOpen}
                    showCommits={mode === 'push'}
                    unpushedCount={count}
                  />
                </Box>
              </Collapse>
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
              '& textarea::placeholder': { color: c.text.muted, opacity: 1 },
            }}
          />
        )}

        {progress && (
          <Box sx={{ ...c.type.caption, color: c.text.secondary }}>
            {progressVerb} <b>{progress.done + 1}</b>/{progress.total}: {progress.currentName}…
          </Box>
        )}

        {result && result.warnings.length > 0 && (
          <Box sx={{ ...c.type.caption, color: c.status.warning }}>
            {result.warnings.join('; ')}
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
            {chosen.size} of {entries.length} selected
            {!allChosen && entries.length > 0 && (
              <Box
                component="button"
                onClick={() => setChosen(new Set(entries.map(d => d.app.workspace_id)))}
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
              <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
            ) : result ? (
              'Done'
            ) : (
              runLabel(chosen.size)
            )}
          </ButtonBase>
        </Box>
      </Box>
    </Box>
  );
};

export default BulkActionBar;
