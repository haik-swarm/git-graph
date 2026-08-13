import React from 'react';
import Box from '@mui/material/Box';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { absoluteTime, laneColor, relativeTime, type Layout } from '@/shared/graphLayout';
import { statusChip } from '@/shared/styles/ui';
import GraphRail, { ROW_HEIGHT } from './GraphRail';

interface Props {
  layout: Layout;
  selectedSha: string | null;
  headSha: string | null;
  onSelect: (sha: string) => void;
}

/**
 * Rows sit in a flex column beside the SVG rail; both use the same
 * ROW_HEIGHT so a commit's dot lines up with its subject without either
 * side having to know the other's layout. Restore lives in the right
 * inspector sheet now, so rows stay uncluttered.
 */
const CommitList: React.FC<Props> = ({ layout, selectedSha, headSha, onSelect }) => {
  const c = useClaudeTokens();

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', px: 3, pb: 4 }}>
      <GraphRail layout={layout} selectedSha={selectedSha} headSha={headSha} />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {layout.nodes.map(node => {
          const isSelected = node.sha === selectedSha;
          const isHead = node.sha === headSha;
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
                px: 1.5,
                cursor: 'pointer',
                borderRadius: `${c.radius.md}px`,
                background: isSelected ? `rgba(${c.accentRgb},0.10)` : 'transparent',
                transition: 'background 120ms ease',
                '&:hover': {
                  background: isSelected ? `rgba(${c.accentRgb},0.10)` : c.bg.secondary,
                },
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
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default CommitList;
