import React from 'react';
import Box from '@mui/material/Box';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { absoluteTime, laneColor, relativeTime, type Layout } from '@/shared/graphLayout';
import { statusChip } from '@/shared/styles/ui';
import GraphRail, { ROW_HEIGHT } from './GraphRail';
import CommitDetails, { type CommitFile } from './CommitDetails';

interface Props {
  layout: Layout;
  selectedSha: string | null;
  headSha: string | null;
  onSelect: (sha: string) => void;
  files: CommitFile[] | null;
  workspaceId: string | null;
  currentBranch: string | null;
  branches: string[];
  onRestored: () => void;
}

/**
 * Rows sit in a flex column beside the SVG rail; both use the same
 * ROW_HEIGHT so a commit's dot lines up with its subject without either
 * side having to know the other's layout.
 *
 * Selecting a commit expands its detail inline, directly beneath the row,
 * rather than opening a sheet over the graph. That breaks the uniform row
 * height the rail relies on, so the measured height of the open panel is
 * fed back to it as a per-row offset.
 */
const CommitList: React.FC<Props> = ({
  layout,
  selectedSha,
  headSha,
  onSelect,
  files,
  workspaceId,
  currentBranch,
  branches,
  onRestored,
}) => {
  const c = useClaudeTokens();
  const [panelHeight, setPanelHeight] = React.useState(0);
  const [openPath, setOpenPath] = React.useState<string | null>(null);

  // A different commit starts with every file collapsed: carrying the previous
  // selection's open path over would expand an unrelated file by coincidence
  // of position.
  React.useEffect(() => {
    setOpenPath(null);
    setPanelHeight(0);
  }, [selectedSha]);

  const handleHeight = React.useCallback((_sha: string, height: number) => {
    setPanelHeight(height);
  }, []);

  const selectedRow = React.useMemo(
    () => layout.nodes.find(n => n.sha === selectedSha)?.row ?? null,
    [layout, selectedSha],
  );

  // Only rows below the open panel move; the panel sits after its own row, so
  // the selected commit's own dot stays put.
  const offsetForRow = React.useCallback(
    (row: number) =>
      selectedRow !== null && row > selectedRow ? panelHeight : 0,
    [selectedRow, panelHeight],
  );

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', px: 3, pb: 4 }}>
      <GraphRail
        layout={layout}
        selectedSha={selectedSha}
        headSha={headSha}
        offsetForRow={offsetForRow}
        extraHeight={selectedRow !== null ? panelHeight : 0}
      />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {layout.nodes.map(node => {
          const isSelected = node.sha === selectedSha;
          const isHead = node.sha === headSha;
          return (
            <Box key={node.sha}>
            <Box
              onClick={() => onSelect(node.sha)}
              role="button"
              aria-expanded={isSelected}
              sx={{
                position: 'relative',
                height: ROW_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                px: 1.5,
                cursor: 'pointer',
                borderRadius: `${c.radius.md}px`,
                background: isSelected ? `rgba(${c.accentRgb},0.10)` : 'transparent',
                transition: 'background 120ms ease',
                '&:hover': {
                  background: isSelected ? `rgba(${c.accentRgb},0.10)` : c.bg.secondary,
                },
                '&:hover .row-caret': { color: c.text.secondary },
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box
                    sx={{
                      ...c.type.body,
                      fontWeight: isHead ? 590 : 400,
                      color: c.text.primary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {node.subject}
                  </Box>

                  {isHead && (
                    <Box
                      title="Your working tree is on this commit"
                      sx={statusChip(c, 'accent')}
                    >
                      current
                    </Box>
                  )}

                  {node.refs.map(ref => (
                    <Box
                      key={ref}
                      sx={{
                        ...statusChip(c, 'neutral'),
                        fontFamily: c.font.mono,
                        color: laneColor(node.lane),
                        background: `${laneColor(node.lane)}1A`,
                      }}
                    >
                      <CallSplitRoundedIcon />
                      {ref}
                    </Box>
                  ))}
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    mt: '3px',
                    ...c.type.caption,
                    color: c.text.tertiary,
                  }}
                >
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: `${laneColor(node.lane)}22`,
                      color: laneColor(node.lane),
                      fontSize: '9px',
                      fontWeight: 600,
                      flexShrink: 0,
                      textTransform: 'uppercase',
                    }}
                  >
                    {(node.author || '?').trim()[0] ?? '?'}
                  </Box>
                  <Box
                    sx={{
                      color: c.text.secondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 220,
                    }}
                  >
                    {node.author}
                  </Box>
                  <Box sx={{ color: c.text.muted }}>·</Box>
                  <Box title={absoluteTime(node.date)}>{relativeTime(node.date)}</Box>
                </Box>
              </Box>

              <Box
                sx={{
                  ...c.type.caption,
                  fontFamily: c.font.mono,
                  color: isSelected ? c.accent.primary : c.text.tertiary,
                  flexShrink: 0,
                  letterSpacing: '0.02em',
                }}
              >
                {node.short}
              </Box>

              <ExpandMoreRoundedIcon
                className="row-caret"
                sx={{
                  fontSize: 16,
                  flexShrink: 0,
                  color: isSelected ? c.accent.primary : c.text.muted,
                  transform: isSelected ? 'rotate(180deg)' : 'none',
                  transition: 'transform 180ms ease, color 120ms ease',
                }}
              />
            </Box>

            <CommitDetails
              commit={node}
              open={isSelected}
              files={isSelected ? files : null}
              workspaceId={workspaceId}
              headSha={headSha}
              currentBranch={currentBranch}
              branches={branches}
              openPath={openPath}
              onTogglePath={path =>
                setOpenPath(prev => (prev === path ? null : path))
              }
              onRestored={onRestored}
              onHeightChange={handleHeight}
            />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default CommitList;
