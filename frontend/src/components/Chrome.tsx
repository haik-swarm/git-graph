import React from 'react';
import Box from '@mui/material/Box';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { slimScroll } from '@/shared/styles/ui';

/**
 * Two-column app frame: tinted sidebar rail on the left, scrolling content
 * well on the right. The rail is the primary orientation surface, the
 * content well is where the work happens.
 */
export const Shell: React.FC<{
  rail: React.ReactNode;
  children: React.ReactNode;
}> = ({ rail, children }) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        background: c.bg.window,
        fontFamily: c.font.sans,
        color: c.text.primary,
      }}
    >
      <Box
        sx={{
          width: 224,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: c.bg.sidebar,
          borderRight: `0.5px solid ${c.separator}`,
        }}
      >
        {rail}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </Box>
    </Box>
  );
};

/** Sticky view header: hierarchy on the left, controls on the right, hairline underneath. */
export const Toolbar: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        height: 48,
        flexShrink: 0,
        px: 2,
        borderBottom: `0.5px solid ${c.separator}`,
        background: c.bg.window,
      }}
    >
      {children}
    </Box>
  );
};

export const Scroller: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const c = useClaudeTokens();
  return (
    <Box sx={{ flex: 1, overflowY: 'auto', scrollbarGutter: 'stable', ...slimScroll(c) }}>
      {children}
    </Box>
  );
};

export const RailLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        ...c.type.footnote,
        fontWeight: 590,
        color: c.text.tertiary,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontSize: '10px',
        px: '10px',
        pt: 1.5,
        pb: '4px',
        userSelect: 'none',
      }}
    >
      {children}
    </Box>
  );
};

/**
 * Deterministic hue per key so every app card gets a stable colored glyph
 * without needing an actual icon.
 */
export function seedHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}

export const BrandGlyph: React.FC<{
  seed: string;
  letter: string;
  size?: number;
  active?: boolean;
}> = ({ seed, letter, size = 22, active }) => {
  const c = useClaudeTokens();
  const hue = seedHue(seed);
  const bg = `hsl(${hue} ${c.isDark ? '42% 34%' : '68% 90%'})`;
  const fg = `hsl(${hue} ${c.isDark ? '72% 82%'  : '48% 30%'})`;
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${c.radius.sm}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bg,
        color: fg,
        fontFamily: c.font.sans,
        fontSize: size * 0.5,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        boxShadow: active
          ? `0 0 0 1.5px ${c.bg.sidebar}, 0 0 0 2.5px ${c.accent.base}`
          : 'none',
        transition: c.transition,
        userSelect: 'none',
      }}
    >
      {(letter || '?').toUpperCase()}
    </Box>
  );
};

export const Pill: React.FC<{
  children: React.ReactNode;
  tone?: 'plain' | 'accent' | 'success' | 'warning' | 'danger' | 'ghost';
}> = ({ children, tone = 'plain' }) => {
  const c = useClaudeTokens();
  const tones = {
    plain: { bg: c.bg.fill, fg: c.text.secondary },
    accent: { bg: c.accent.wash, fg: c.accent.base },
    success: { bg: `rgba(52,199,89,${c.isDark ? 0.18 : 0.14})`, fg: c.status.success },
    warning: { bg: `rgba(255,149,0,${c.isDark ? 0.18 : 0.14})`, fg: c.status.warning },
    danger: { bg: c.status.dangerWash, fg: c.status.danger },
    ghost: { bg: 'transparent', fg: c.text.tertiary },
  }[tone];
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        height: 18,
        px: '7px',
        borderRadius: `${c.radius.xs}px`,
        ...c.type.caption,
        fontWeight: 500,
        background: tones.bg,
        color: tones.fg,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        '& svg': { fontSize: 11 },
      }}
    >
      {children}
    </Box>
  );
};

/** Centred placeholder for empty, loading-failed and blank states. */
export const Placeholder: React.FC<{
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  danger?: boolean;
}> = ({ icon, title, hint, action, danger }) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.25,
        py: 9,
        px: 3,
        textAlign: 'center',
      }}
    >
      {icon && (
        <Box
          sx={{
            width: 42,
            height: 42,
            borderRadius: `${c.radius.xl}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: danger ? c.status.dangerWash : c.bg.fill,
            color: danger ? c.status.danger : c.text.tertiary,
            '& svg': { fontSize: 22 },
          }}
        >
          {icon}
        </Box>
      )}
      <Box
        sx={{
          ...c.type.title3,
          fontWeight: 590,
          color: danger ? c.status.danger : c.text.primary,
        }}
      >
        {title}
      </Box>
      {hint && (
        <Box sx={{ ...c.type.callout, color: c.text.tertiary, maxWidth: 360, lineHeight: 1.5 }}>
          {hint}
        </Box>
      )}
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Box>
  );
};
