import React, { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import CheckIcon from '@mui/icons-material/Check';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { primaryButton, sunkenField } from '@/shared/styles/ui';
import { gitgraphCreateCommitUrl } from '@/shared/state/API_ENDPOINTS';
import IgnoreMenu, { type IgnoreResult } from './IgnoreMenu';
import DiffFileRow from './DiffFileRow';

export interface DirtyFile {
  code: string;
  path: string;
  unstaged: boolean;
  orig_path?: string;
  added?: number | null;
  removed?: number | null;
}

interface Props {
  workspaceId: string;
  dirty: DirtyFile[];
  hasRemote: boolean;
  /** A message written upstream by the draft button; null when none is pending. */
  draft: string | null;
  draftError: string | null;
  onDraftConsumed: () => void;
  onCommitted: () => void;
  onIgnored: () => void;
}

/** git's two-letter status codes, as the words a person would use. */
function describe(code: string): { label: string; tone: 'add' | 'edit' | 'remove' } {
  if (code === '??') return { label: 'new', tone: 'add' };
  if (code.includes('D')) return { label: 'deleted', tone: 'remove' };
  if (code.includes('A')) return { label: 'added', tone: 'add' };
  if (code.includes('R')) return { label: 'renamed', tone: 'edit' };
  return { label: 'modified', tone: 'edit' };
}

/**
 * The uncommitted file list and the commit form, rendered inline inside the
 * dirty-work card. This is the same shape as an expanded commit in the
 * history: a row per file that opens to its own patch, so both halves of the
 * page are read the same way instead of one being a popover.
 */
const DirtyDetails: React.FC<Props> = ({
  workspaceId,
  dirty,
  hasRemote,
  draft,
  draftError,
  onDraftConsumed,
  onCommitted,
  onIgnored,
}) => {
  const c = useClaudeTokens();
  const [message, setMessage] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Everything starts checked: committing all pending work is the common
  // case, and unchecking a few is less work than checking most.
  useEffect(() => {
    setChosen(new Set(dirty.map(f => f.path)));
    setError(null);
    setNotice(null);
  }, [dirty, workspaceId]);

  // A drafted message overwrites the field, then is released upstream so a
  // later edit here isn't clobbered by this effect re-running.
  useEffect(() => {
    if (draft === null) return;
    setMessage(draft);
    onDraftConsumed();
  }, [draft, onDraftConsumed]);

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
        body: JSON.stringify({
          message: message.trim(),
          paths: [...chosen],
          push: hasRemote,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `Commit failed (${res.status})`);
      }
      // The commit is already in history at this point, so a push failure is
      // reported without discarding the fact that the commit succeeded.
      const data: { push_error?: string } = await res.json().catch(() => ({}));
      if (data.push_error) setError(`Committed, but the push failed: ${data.push_error}`);
      setMessage('');
      setOpenPath(null);
      onCommitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 1,
          py: '6px',
          borderTop: `1px solid ${c.border.subtle}`,
        }}
      >
        <Typography sx={{ ...c.type.caption, color: c.text.tertiary, flex: 1 }}>
          {chosen.size} of {dirty.length} selected
        </Typography>
        <ButtonBase
          onClick={() => setChosen(allChosen ? new Set() : new Set(dirty.map(f => f.path)))}
          sx={{
            ...c.type.caption,
            color: c.accent.primary,
            px: '6px',
            py: '2px',
            borderRadius: `${c.radius.xs}px`,
            '&:hover': { background: c.bg.secondary },
          }}
        >
          {allChosen ? 'Deselect all' : 'Select all'}
        </ButtonBase>
      </Box>

      <Box sx={{ px: '4px' }}>
        {dirty.map(file => {
          const { label, tone } = describe(file.code);
          const isChosen = chosen.has(file.path);
          const isOpen = openPath === file.path;
          return (
            <DiffFileRow
              key={file.path}
              workspaceId={workspaceId}
              filePath={file.path}
              expanded={isOpen}
              onToggle={() => setOpenPath(prev => (prev === file.path ? null : file.path))}
              added={file.added}
              removed={file.removed}
              leading={
                <ButtonBase
                  onClick={() => toggle(file.path)}
                  aria-label={isChosen ? `Deselect ${file.path}` : `Select ${file.path}`}
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
              }
              trailing={
                <>
                  {/* The ignore button is an escape hatch, not a primary
                      action: showing it on every row at rest turns a list you
                      scan into a list you have to read. */}
                  <Box
                    className="row-trailing"
                    sx={{ opacity: 0, transition: c.transition, flexShrink: 0 }}
                  >
                    <IgnoreMenu
                      workspaceId={workspaceId}
                      filePath={file.path}
                      onIgnored={(result: IgnoreResult) => {
                        const freed = result.untracked.length;
                        setNotice(
                          freed > 0
                            ? `Ignored ${result.rule} — stopped tracking ${freed} file${freed === 1 ? '' : 's'}.`
                            : `Ignored ${result.rule}.`,
                        );
                        onIgnored();
                      }}
                      onError={setError}
                    />
                  </Box>

                  <Typography sx={{ ...c.type.caption, color: toneColor[tone], flexShrink: 0 }}>
                    {label}
                  </Typography>
                </>
              }
            />
          );
        })}
      </Box>

      <Box
        sx={{
          p: 1,
          mt: '4px',
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

        {error || draftError ? (
          <Typography sx={{ ...c.type.caption, color: c.status.error }}>
            {error ?? draftError}
          </Typography>
        ) : notice ? (
          <Typography sx={{ ...c.type.caption, color: c.status.success }}>{notice}</Typography>
        ) : null}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ flex: 1 }} />
          <ButtonBase disabled={!canCommit} onClick={() => void submit()} sx={{ ...primaryButton(c) }}>
            {busy ? (
              <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
            ) : hasRemote ? (
              'Commit and push'
            ) : (
              'Commit'
            )}
          </ButtonBase>
        </Box>
      </Box>
    </Box>
  );
};

export default DirtyDetails;
