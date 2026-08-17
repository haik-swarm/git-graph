import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { gitgraphGraphUrl } from '@/shared/state/API_ENDPOINTS';
import { absoluteTime, relativeTime, type Commit } from '@/shared/graphLayout';
import DiffFileRow from '@/components/DiffFileRow';

interface DirtyFile {
  code: string;
  path: string;
  unstaged: boolean;
  added?: number | null;
  removed?: number | null;
}

interface Props {
  workspaceId: string;
  open: boolean;
  /** Push mode lists the commits going out; the others list working-tree files. */
  showCommits: boolean;
  /** How many commits are ahead of the remote, from the status batch. */
  unpushedCount: number;
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
 * One app's actual changes, inside the bulk bar. The bar used to name a count
 * and ask you to trust it; this is the count opened up, so choosing which apps
 * to commit is a decision you can inspect rather than take on faith.
 *
 * The graph is fetched per app on first expand and cached after. Home never
 * loads it up front, and doing so for every dirty app to populate rows nobody
 * may open would cost far more than it saves.
 */
const BulkAppDetails: React.FC<Props> = ({
  workspaceId,
  open,
  showCommits,
  unpushedCount,
}) => {
  const c = useClaudeTokens();
  const [dirty, setDirty] = React.useState<DirtyFile[] | null>(null);
  const [commits, setCommits] = React.useState<Commit[] | null>(null);
  const [openPath, setOpenPath] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!open || dirty || failed) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(gitgraphGraphUrl(workspaceId));
        if (!res.ok) throw new Error(`graph ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setDirty(data.dirty ?? []);
        setCommits(data.commits ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, dirty, failed]);

  // Whatever sits ahead of the remote is the head of the log, and the count
  // already came from the same rev-list the status batch ran.
  const outgoing = React.useMemo(
    () => (commits ?? []).slice(0, Math.max(0, unpushedCount)),
    [commits, unpushedCount],
  );

  if (failed) {
    return (
      <Box sx={{ ...c.type.caption, color: c.text.tertiary, px: 2, py: 1 }}>
        We couldn't read this workspace.
      </Box>
    );
  }

  if (!dirty) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', px: 2, py: 1 }}>
        <CircularProgress size={10} sx={{ color: c.text.tertiary }} />
        <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
          {showCommits ? 'Reading commits…' : 'Reading changes…'}
        </Box>
      </Box>
    );
  }

  if (showCommits) {
    if (outgoing.length === 0) {
      return (
        <Box sx={{ ...c.type.caption, color: c.text.tertiary, px: 2, py: 1 }}>
          Nothing to push.
        </Box>
      );
    }
    return (
      <Box sx={{ py: '2px' }}>
        {outgoing.map(commit => (
          <Box
            key={commit.sha}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: '5px',
            }}
          >
            <Box
              sx={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                flexShrink: 0,
                background: c.accent.primary,
              }}
            />
            <Box
              sx={{
                ...c.type.body,
                color: c.text.primary,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {commit.subject}
            </Box>
            <Box
              title={absoluteTime(commit.date)}
              sx={{
                ...c.type.caption,
                color: c.text.tertiary,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                flexShrink: 0,
              }}
            >
              <ScheduleRoundedIcon sx={{ fontSize: 13 }} />
              {relativeTime(commit.date)}
            </Box>
            <Box
              sx={{
                ...c.type.caption,
                fontFamily: c.font.mono,
                color: c.text.tertiary,
                flexShrink: 0,
              }}
            >
              {commit.short}
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  if (dirty.length === 0) {
    return (
      <Box sx={{ ...c.type.caption, color: c.text.tertiary, px: 2, py: 1 }}>
        No uncommitted changes.
      </Box>
    );
  }

  const toneColor = {
    add: c.status.success,
    edit: c.status.warning,
    remove: c.status.error,
  } as const;

  return (
    <Box sx={{ px: '4px', py: '2px' }}>
      {dirty.map(file => {
        const { label, tone } = describe(file.code);
        return (
          <DiffFileRow
            key={file.path}
            workspaceId={workspaceId}
            filePath={file.path}
            expanded={openPath === file.path}
            onToggle={() => setOpenPath(prev => (prev === file.path ? null : file.path))}
            added={file.added}
            removed={file.removed}
            trailing={
              <Box sx={{ ...c.type.caption, color: toneColor[tone], flexShrink: 0 }}>
                {label}
              </Box>
            }
          />
        );
      })}
    </Box>
  );
};

export default BulkAppDetails;
