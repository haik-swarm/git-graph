import React from 'react';
import Box from '@mui/material/Box';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { laneColor, type Layout } from '@/shared/graphLayout';

export const ROW_HEIGHT = 58;
const LANE_WIDTH = 22;
const DOT = 11;

interface Props {
  layout: Layout;
  selectedSha: string | null;
  headSha: string | null;
}

/**
 * The commit graph itself, drawn as one SVG behind the rows.
 *
 * Edges are cubic curves rather than right angles: a lane change reads as
 * a branch diverging instead of a wiring diagram, which matters when most
 * of these repos are a single straight line. The selection glow and the
 * HEAD ring are drawn here (not in the row) so they align with the dot
 * regardless of row height.
 */
const GraphRail: React.FC<Props> = ({ layout, selectedSha, headSha }) => {
  const c = useClaudeTokens();
  const width = Math.max(layout.laneCount, 1) * LANE_WIDTH + 14;
  const height = Math.max(layout.nodes.length, 1) * ROW_HEIGHT;

  const cx = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2 + 6;
  const cy = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

  return (
    <Box
      component="svg"
      width={width}
      height={height}
      sx={{ flexShrink: 0, display: 'block', overflow: 'visible' }}
    >
      {layout.edges.map((edge, i) => {
        const x1 = cx(edge.fromLane);
        const y1 = cy(edge.fromRow);
        const x2 = cx(edge.toLane);
        const y2 = cy(edge.toRow);
        const mid = (y1 + y2) / 2;
        const d =
          x1 === x2
            ? `M ${x1} ${y1} L ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={laneColor(Math.min(edge.fromLane, edge.toLane))}
            strokeWidth={1.75}
            strokeOpacity={0.5}
            strokeLinecap="round"
          />
        );
      })}

      {layout.nodes.map(node => {
        const isSelected = node.sha === selectedSha;
        const isHead = node.sha === headSha;
        const color = laneColor(node.lane);
        const isMerge = node.parents.length > 1;
        return (
          <g key={node.sha}>
            {isSelected && (
              <circle
                cx={cx(node.lane)}
                cy={cy(node.row)}
                r={DOT + 3}
                fill={color}
                opacity={0.16}
              />
            )}
            {isHead && (
              <circle
                cx={cx(node.lane)}
                cy={cy(node.row)}
                r={DOT / 2 + 3}
                fill="none"
                stroke={color}
                strokeWidth={1}
                opacity={0.55}
              />
            )}
            <circle
              cx={cx(node.lane)}
              cy={cy(node.row)}
              r={DOT / 2}
              fill={isMerge ? c.bg.page : color}
              stroke={color}
              strokeWidth={isMerge ? 2 : 1.25}
            />
            {isHead && (
              <circle
                cx={cx(node.lane)}
                cy={cy(node.row)}
                r={DOT / 2 - 2}
                fill={c.bg.page}
              />
            )}
          </g>
        );
      })}
    </Box>
  );
};

export default GraphRail;
