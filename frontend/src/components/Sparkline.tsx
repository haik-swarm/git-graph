import React from 'react';
import Box from '@mui/material/Box';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';

interface Props {
  values: number[];
  width?: number;
  height?: number;
}

/**
 * Commit cadence as a filled area. Deliberately unlabelled — it's a texture
 * for "is this repo alive", not a chart you read values off, so it carries
 * no axes and never competes with the numbers beside it.
 */
const Sparkline: React.FC<Props> = ({ values, width = 132, height = 28 }) => {
  const c = useClaudeTokens();
  if (values.length < 2) return null;

  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const y = (v: number) => height - (v / max) * (height - 2) - 1;

  const line = values.map((v, i) => `${i * step},${y(v)}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const gradientId = React.useId();

  return (
    <Box
      sx={{ display: 'block', flexShrink: 0, lineHeight: 0 }}
      title="Commit activity over the life of this repo"
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.accent.primary} stopOpacity={0.28} />
            <stop offset="100%" stopColor={c.accent.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke={c.accent.primary}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </Box>
  );
};

export default Sparkline;
