import React from 'react';
import Box from '@mui/material/Box';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { laneColor, type Layout } from '@/shared/graphLayout';

export const ROW_HEIGHT = 52;
const LANE_WIDTH = 18;
const DOT = 9;

interface Props {
  layout: Layout;
  selectedSha: string | null;
}

/**
 * The commit graph itself, drawn as one SVG behind the rows.
 *
 * Edges are cubic curves rather than right angles: a lane change reads as
 * a branch diverging instead of a wiring diagram, which matters when most
 * of these repos are a single straight line.
 */
const GraphRail: React.FC<Props> = ({ layout, selectedSha }) => {
  const c = useClaudeTokens();
  const width = Math.max(layout.laneCount, 1) * LANE_WIDTH + 12;
  const height = Math.max(layout.nodes.length, 1) * ROW_HEIGHT;

  const cx = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
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
            strokeWidth={1.5}
            strokeOpacity={0.55}
          />
        );
      })}

      {layout.nodes.map(node => {
        const isSelected = node.sha === selectedSha;
        return (
          <g key={node.sha}>
            {isSelected && (
              <circle
                cx={cx(node.lane)}
                cy={cy(node.row)}
                r={DOT}
                fill={laneColor(node.lane)}
                opacity={0.22}
              />
            )}
            <circle
              cx={cx(node.lane)}
              cy={cy(node.row)}
              r={DOT / 2}
              fill={node.parents.length > 1 ? c.bg.window : laneColor(node.lane)}
              stroke={laneColor(node.lane)}
              strokeWidth={node.parents.length > 1 ? 2 : 1}
            />
          </g>
        );
      })}
    </Box>
  );
};

export default GraphRail;
