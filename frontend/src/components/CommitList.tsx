import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { laneColor, relativeTime, type Layout } from '@/shared/graphLayout';
import GraphRail, { ROW_HEIGHT } from './GraphRail';
import RestoreControl from './RestoreControl';

interface Props {
  layout: Layout;
  selectedSha: string | null;
  workspaceId: string | null;
  headSha: string | null;
  currentBranch: string | null;
  branches: string[];
  onSelect: (sha: string) => void;
  onRestored: () => void;
}

/**
 * Rows sit in a flex column beside the SVG rail; both use the same
 * ROW_HEIGHT so a commit's dot lines up with its subject without either
 * side having to know the other's layout.
 */
const CommitList: React.FC<Props> = ({
  layout,
  selectedSha,
  workspaceId,
  headSha,
  currentBranch,
  branches,
  onSelect,
  onRestored,
}) => {
  const c = useClaudeTokens();
  const branchSet = React.useMemo(() => new Set(branches), [branches]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', px: 2, pb: 4 }}>
      <GraphRail layout={layout} selectedSha={selectedSha} />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {layout.nodes.map(node => {
          const isSelected = node.sha === selectedSha;
          const isHead = node.sha === headSha;
          // A ref like "main" is a local branch tip; "origin/main" is a
          // remote-tracking ref we can't check out cleanly. Prefer any
          // non-restore branch so forward-restoring lands on `main`
          // instead of another throwaway fork.
          const localTips = node.refs.filter(
            r => branchSet.has(r) && r !== currentBranch,
          );
          const preferred = localTips.find(r => !r.startsWith('restore/'));
          const switchTo = preferred ?? localTips[0] ?? null;
          return (
            <Box
              key={node.sha}
              onClick={() => onSelect(node.sha)}
              sx={{
                position: 'relative',
                height: ROW_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                px: 1.25,
                cursor: 'pointer',
                borderRadius: `${c.radius.sm}px`,
                background: isSelected ? c.accent.wash : 'transparent',
                transition: 'background 100ms linear',
                // The restore chip is hidden by default; opacity swap keeps
                // its layout footprint out of the row so short subjects
                // don't get truncated only when the cursor is elsewhere.
                '& .restore-slot': { opacity: 0, pointerEvents: 'none' },
                '&:hover': {
                  background: isSelected ? c.accent.wash : c.bg.fill,
                  '& .restore-slot': { opacity: 1, pointerEvents: 'auto' },
                },
                '&:focus-within .restore-slot': {
                  opacity: 1,
                  pointerEvents: 'auto',
                },
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Typography
                    sx={{
                      ...c.type.body,
                      color: c.text.primary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {node.subject}
                  </Typography>

                  {isHead && (
                    <Box
                      title="Your working tree is on this commit"
                      sx={{
                        ...c.type.caption,
                        flexShrink: 0,
                        px: '6px',
                        py: '1px',
                        borderRadius: `${c.radius.xs}px`,
                        color: c.text.onAccent,
                        background: c.accent.base,
                        letterSpacing: '0.02em',
                      }}
                    >
                      current
                    </Box>
                  )}

                  {node.refs.map(ref => (
                    <Box
                      key={ref}
                      sx={{
                        ...c.type.caption,
                        flexShrink: 0,
                        px: '5px',
                        py: '1px',
                        borderRadius: `${c.radius.xs}px`,
                        color: laneColor(node.lane),
                        border: `0.5px solid ${laneColor(node.lane)}`,
                        opacity: 0.9,
                      }}
                    >
                      {ref}
                    </Box>
                  ))}
                </Box>

                <Typography sx={{ ...c.type.caption, color: c.text.tertiary, mt: '1px' }}>
                  {node.author} · {relativeTime(node.date)}
                </Typography>
              </Box>

              <Typography
                sx={{
                  ...c.type.caption,
                  fontFamily: c.font.mono,
                  color: c.text.quaternary,
                  flexShrink: 0,
                }}
              >
                {node.short}
              </Typography>

              {workspaceId && (
                <Box
                  className="restore-slot"
                  onClick={e => e.stopPropagation()}
                  sx={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: c.bg.raised,
                    borderRadius: `${c.radius.sm}px`,
                    transition: 'opacity 100ms linear',
                  }}
                >
                  <RestoreControl
                    workspaceId={workspaceId}
                    sha={node.sha}
                    shortSha={node.short}
                    subject={node.subject}
                    isHead={isHead}
                    switchTo={switchTo}
                    onRestored={onRestored}
                  />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default CommitList;
