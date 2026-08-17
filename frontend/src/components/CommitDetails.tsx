import React from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { absoluteTime, laneColor, relativeTime, type PlacedCommit } from '@/shared/graphLayout';
import RestoreControl from '@/components/RestoreControl';
import DiffFileRow, { tally } from '@/components/DiffFileRow';

export interface CommitFile {
  path: string;
  added: number | null;
  removed: number | null;
}

interface Props {
  commit: PlacedCommit;
  open: boolean;
  files: CommitFile[] | null;
  workspaceId: string | null;
  headSha: string | null;
  currentBranch: string | null;
  branches: string[];
  openPath: string | null;
  onTogglePath: (path: string) => void;
  onRestored: () => void;
  /** Reports the panel's rendered height so the rail can re-align its dots. */
  onHeightChange: (sha: string, height: number) => void;
}

/**
 * The commit inspector, rendered inline underneath its own row instead of in
 * a right-hand sheet. Expanding in place keeps the commit you clicked on
 * screen and next to its neighbours, so reading one commit no longer covers
 * the graph that gives it context.
 */
const CommitDetails: React.FC<Props> = ({
  commit,
  open,
  files,
  workspaceId,
  headSha,
  currentBranch,
  branches,
  openPath,
  onTogglePath,
  onRestored,
  onHeightChange,
}) => {
  const c = useClaudeTokens();
  const inner = React.useRef<HTMLDivElement | null>(null);
  const branchSet = React.useMemo(() => new Set(branches), [branches]);

  // The panel's height isn't knowable up front: it depends on the file count
  // and on whether a diff is open inside it. A ResizeObserver reports the
  // real value on every change, which is what keeps the rail honest.
  React.useEffect(() => {
    if (!open) {
      onHeightChange(commit.sha, 0);
      return;
    }
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      onHeightChange(commit.sha, el.getBoundingClientRect().height);
    });
    observer.observe(el);
    onHeightChange(commit.sha, el.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [open, commit.sha, onHeightChange]);

  const totals = React.useMemo(() => {
    if (!files) return null;
    let added = 0;
    let removed = 0;
    let busiest = 0;
    for (const f of files) {
      added += f.added ?? 0;
      removed += f.removed ?? 0;
      busiest = Math.max(busiest, (f.added ?? 0) + (f.removed ?? 0));
    }
    return { added, removed, busiest };
  }, [files]);

  const isHead = commit.sha === headSha;
  const localTips = commit.refs.filter(r => branchSet.has(r) && r !== currentBranch);
  const preferred = localTips.find(r => !r.startsWith('restore/'));
  const switchTo = preferred ?? localTips[0] ?? null;

  return (
    <Collapse in={open} timeout={180} unmountOnExit>
      <Box ref={inner} sx={{ pb: 1.5 }}>
        <Box
          sx={{
            borderRadius: `${c.radius.lg}px`,
            border: `1px solid ${c.border.subtle}`,
            background: c.bg.surface,
            overflow: 'hidden',
            // Tinted to the commit's own lane, so an open panel stays visually
            // tied to the dot it belongs to when several are stacked.
            borderLeft: `2px solid ${laneColor(commit.lane)}`,
          }}
        >
          <Box sx={{ px: 2, pt: 1.5, pb: 1.25 }}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                maxWidth: 560,
              }}
            >
              <MetaRow icon={<PersonRoundedIcon />} label="Author" value={commit.author} />
              <MetaRow
                icon={<ScheduleRoundedIcon />}
                label="Date"
                value={`${relativeTime(commit.date)} · ${absoluteTime(commit.date)}`}
              />
              <MetaRow
                icon={<CallSplitRoundedIcon />}
                label="Commit"
                value={commit.sha}
                mono
              />
              {commit.parents.length > 0 && (
                <MetaRow
                  icon={<CallSplitRoundedIcon />}
                  label={commit.parents.length > 1 ? 'Parents' : 'Parent'}
                  value={commit.parents.map(p => p.slice(0, 7)).join(' · ')}
                  mono
                />
              )}
            </Box>
          </Box>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: '8px',
              borderTop: `1px solid ${c.border.subtle}`,
              background: c.bg.secondary,
            }}
          >
            <DescriptionOutlinedIcon sx={{ fontSize: 14, color: c.text.tertiary }} />
            <Box sx={{ ...c.type.footnote, color: c.text.tertiary, flex: 1 }}>
              {files && files.length > 0
                ? `${files.length} file${files.length === 1 ? '' : 's'} changed`
                : 'Changes'}
            </Box>
            {totals && (files?.length ?? 0) > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {totals.added > 0 && (
                  <Box sx={{ ...tally(c), color: c.status.success }}>
                    +{totals.added.toLocaleString()}
                  </Box>
                )}
                {totals.removed > 0 && (
                  <Box sx={{ ...tally(c), color: c.status.error }}>
                    −{totals.removed.toLocaleString()}
                  </Box>
                )}
              </Box>
            )}
            {workspaceId && (
              <RestoreControl
                workspaceId={workspaceId}
                sha={commit.sha}
                shortSha={commit.short}
                subject={commit.subject}
                isHead={isHead}
                switchTo={switchTo}
                onRestored={onRestored}
              />
            )}
          </Box>

          <Box sx={{ px: 1, py: '4px' }}>
            {files === null ? (
              <Box sx={{ ...c.type.caption, color: c.text.tertiary, px: 1, py: 1 }}>
                Loading changes…
              </Box>
            ) : files.length === 0 ? (
              <Box sx={{ ...c.type.caption, color: c.text.tertiary, px: 1, py: 1 }}>
                No file changes.
              </Box>
            ) : (
              files.map(f => (
                <FileRow
                  key={f.path}
                  file={f}
                  busiest={totals?.busiest ?? 0}
                  expanded={openPath === f.path}
                  workspaceId={workspaceId}
                  sha={commit.sha}
                  onToggle={() => onTogglePath(f.path)}
                />
              ))
            )}
          </Box>
        </Box>
      </Box>
    </Collapse>
  );
};

/**
 * One changed file, which expands to its own patch in place. The bar is
 * scaled against the busiest file in the same commit rather than an absolute
 * line count, so a small commit still shows contrast.
 */
const FileRow: React.FC<{
  file: CommitFile;
  busiest: number;
  expanded: boolean;
  workspaceId: string | null;
  sha: string;
  onToggle: () => void;
}> = ({ file, busiest, expanded, workspaceId, sha, onToggle }) => {
  const c = useClaudeTokens();
  const added = file.added ?? 0;
  const removed = file.removed ?? 0;
  const churn = added + removed;
  // sqrt keeps a 5-line change visible next to a 500-line one; a linear
  // scale collapses everything small into an indistinguishable sliver.
  const width = busiest > 0 ? Math.max(0.14, Math.sqrt(churn / busiest)) * 52 : 0;

  return (
    <DiffFileRow
      workspaceId={workspaceId}
      filePath={file.path}
      sha={sha}
      expanded={expanded}
      onToggle={onToggle}
      added={file.added}
      removed={file.removed}
      trailing={
        file.added !== null && (
          <Box
            sx={{
              width: 52,
              height: 4,
              flexShrink: 0,
              borderRadius: `${c.radius.full}px`,
              background: c.bg.elevated,
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            <Box sx={{ width, display: 'flex', height: '100%' }}>
              <Box sx={{ flex: added, background: c.status.success }} />
              <Box sx={{ flex: removed, background: c.status.error }} />
            </Box>
          </Box>
        )
      }
    />
  );
};

const MetaRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}> = ({ icon, label, value, mono }) => {
  const c = useClaudeTokens();
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      <Box
        sx={{
          width: 18,
          color: c.text.tertiary,
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'flex-start',
          '& svg': { fontSize: 14 },
        }}
      >
        {icon}
      </Box>
      <Box sx={{ ...c.type.caption, color: c.text.tertiary, width: 52, flexShrink: 0 }}>
        {label}
      </Box>
      <Box
        sx={{
          ...c.type.callout,
          color: c.text.secondary,
          fontFamily: mono ? c.font.mono : c.font.sans,
          minWidth: 0,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </Box>
    </Box>
  );
};

export default CommitDetails;
