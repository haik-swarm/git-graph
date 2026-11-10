import type { SwarmTokens } from './ThemeContext';

/** Surface + hairline + hover lift. The workhorse container. */
export function card(c: SwarmTokens, interactive = false) {
  return {
    borderRadius: `${c.radius.lg}px`,
    border: `1px solid ${c.border.subtle}`,
    background: c.bg.surface,
    transition: c.transition,
    boxShadow: c.shadow.sm,
    ...(interactive && {
      cursor: 'pointer',
      '&:hover': {
        borderColor: c.border.strong,
        boxShadow: c.shadow.md,
      },
    }),
  } as const;
}

/** Overlay surface for popovers, menus and sheets. */
export function popover(c: SwarmTokens) {
  return {
    background: c.bg.surface,
    backgroundImage: 'none',
    border: `1px solid ${c.border.subtle}`,
    borderRadius: `${c.radius.lg}px`,
    boxShadow: c.shadow.lg,
  } as const;
}

export function menuSurface(c: SwarmTokens) {
  return { ...popover(c), p: '4px' } as const;
}

/** One row of a dropdown menu. `danger` tints the row for destructive entries. */
export function menuItem(c: SwarmTokens, danger = false) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    width: '100%',
    minHeight: 30,
    px: '8px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    borderRadius: `${c.radius.xs}px`,
    fontFamily: c.font.sans,
    ...c.type.body,
    color: danger ? c.status.error : c.text.secondary,
    transition: c.transition,
    '&:hover': {
      background: danger ? c.status.errorBg : c.bg.secondary,
      color: danger ? c.status.error : c.text.primary,
    },
    '&:disabled': { opacity: 0.4, cursor: 'default', background: 'transparent' },
  } as const;
}

export function menuSectionLabel(c: SwarmTokens) {
  return {
    ...c.type.caption,
    fontWeight: 500,
    color: c.text.muted,
    px: '8px',
    pt: 1,
    pb: '4px',
    userSelect: 'none',
  } as const;
}

export function menuDivider(c: SwarmTokens) {
  return { height: '1px', background: c.border.subtle, my: '4px', mx: '-4px' } as const;
}

export function menuHint(c: SwarmTokens) {
  return {
    ...c.type.caption,
    color: c.text.muted,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  } as const;
}

/** Secondary control: bordered, transparent fill. */
export function pushButton(c: SwarmTokens) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: 28,
    px: '10px',
    cursor: 'pointer',
    fontFamily: c.font.sans,
    ...c.type.callout,
    fontWeight: 500,
    color: c.text.primary,
    background: c.bg.surface,
    border: `1px solid ${c.border.medium}`,
    borderRadius: `${c.radius.sm}px`,
    boxShadow: c.shadow.sm,
    whiteSpace: 'nowrap',
    transition: c.transition,
    '& svg': { fontSize: 14, color: c.text.tertiary },
    '&:hover': {
      background: c.bg.secondary,
      borderColor: c.border.strong,
      color: c.text.primary,
    },
    '&:disabled': { opacity: 0.4, cursor: 'default' },
  } as const;
}

/** Filled accent control: the primary action in a view. */
export function primaryButton(c: SwarmTokens) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: 28,
    px: '12px',
    cursor: 'pointer',
    fontFamily: c.font.sans,
    ...c.type.callout,
    fontWeight: 500,
    color: c.accent.contrast,
    '& svg': { fontSize: 14 },
    background: c.accent.primary,
    border: '1px solid transparent',
    borderRadius: `${c.radius.sm}px`,
    boxShadow: 'none',
    whiteSpace: 'nowrap',
    transition: c.transition,
    '&:hover': { background: c.accent.hover },
    '&:active': { background: c.accent.pressed },
    '&:disabled': { opacity: 0.5, cursor: 'default' },
  } as const;
}

/** Chromeless icon button. Always wrap the call site in a Tooltip. */
export function iconButton(c: SwarmTokens, size = 28) {
  return {
    width: size,
    height: size,
    borderRadius: `${c.radius.sm}px`,
    color: c.text.tertiary,
    transition: c.transition,
    '& svg': { fontSize: Math.round(size * 0.5) },
    '&:hover': {
      color: c.text.primary,
      background: c.bg.secondary,
    },
    '&.Mui-disabled': { color: c.text.ghost },
  } as const;
}

/** Ghost at rest, error only on hover. */
export function destructiveIconButton(c: SwarmTokens, size = 28) {
  return {
    width: size,
    height: size,
    borderRadius: `${c.radius.sm}px`,
    color: c.text.ghost,
    transition: c.transition,
    '&:hover': { color: c.status.error, background: c.status.errorBg },
  } as const;
}

/** Tinted status chip. Background is the *Bg token, ink is the solid one. */
export function statusChip(
  c: SwarmTokens,
  tone: 'success' | 'error' | 'warning' | 'neutral' | 'accent' = 'neutral',
) {
  const tones = {
    success: { bg: c.status.successBg, fg: c.status.success },
    error: { bg: c.status.errorBg, fg: c.status.error },
    warning: { bg: c.status.warningBg, fg: c.status.warning },
    accent: { bg: c.bg.secondary, fg: c.text.primary },
    neutral: { bg: 'transparent', fg: c.text.tertiary },
  }[tone];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    height: 20,
    px: '6px',
    borderRadius: `${c.radius.xs}px`,
    border: `1px solid ${c.border.subtle}`,
    ...c.type.caption,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    background: tones.bg,
    color: tones.fg,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    '& svg': { fontSize: 12 },
  } as const;
}

/** Inset field: search boxes, text inputs. */
export function sunkenField(c: SwarmTokens) {
  return {
    background: c.bg.surface,
    border: `1px solid ${c.border.medium}`,
    borderRadius: `${c.radius.sm}px`,
    transition: c.transition,
    '&:hover': { borderColor: c.border.strong },
    '&:focus-within': {
      borderColor: `rgba(${c.focusRgb},0.6)`,
      boxShadow: `0 0 0 3px rgba(${c.focusRgb},0.14)`,
    },
  } as const;
}

/** Thin, translucent scrollbar — a hint, not a control. */
export function slimScroll(c: SwarmTokens) {
  return {
    '&::-webkit-scrollbar': { width: 4, height: 4 },
    '&::-webkit-scrollbar-track': { background: 'transparent' },
    '&::-webkit-scrollbar-thumb': {
      background: c.border.medium,
      borderRadius: 2,
    },
    scrollbarWidth: 'thin',
    scrollbarColor: `${c.border.medium} transparent`,
  } as const;
}

export function focusRing(c: SwarmTokens) {
  return {
    '&:focus-visible': {
      outline: 'none',
      boxShadow: `0 0 0 2px ${c.bg.page}, 0 0 0 4px rgba(${c.focusRgb},0.5)`,
    },
  } as const;
}

/**
 * A field that something else is currently typing into.
 *
 * Layered on top of `sunkenField`, so it reads as the same control in a
 * different state rather than a different control. The accent border and
 * breathing glow borrow the focus treatment on purpose: the model writing
 * here should feel like a cursor in the box, not a loading screen over it.
 * A sheen crosses the surface to carry the sense of work in progress.
 * Holds still under reduced-motion, keeping only the static accent border.
 */
export function writingField(c: SwarmTokens) {
  return {
    borderColor: `rgba(${c.focusRgb},0.6)`,
    background: `linear-gradient(90deg, ${c.bg.secondary} 30%, rgba(${c.focusRgb},0.10) 50%, ${c.bg.secondary} 70%)`,
    backgroundSize: '300% 100%',
    animation: `swarm-writing-sheen 1.8s ${c.ease} infinite, swarm-writing-glow 1.8s ${c.ease} infinite`,
    '@keyframes swarm-writing-sheen': {
      '0%': { backgroundPosition: '100% 50%' },
      '100%': { backgroundPosition: '0% 50%' },
    },
    '@keyframes swarm-writing-glow': {
      '0%, 100%': { boxShadow: `0 0 0 0 rgba(${c.focusRgb},0.18)` },
      '50%': { boxShadow: `0 0 0 3px rgba(${c.focusRgb},0.18)` },
    },
    '@media (prefers-reduced-motion: reduce)': {
      animation: 'none',
      background: c.bg.secondary,
      boxShadow: 'none',
    },
  } as const;
}

/**
 * Placeholder block for content that can't be shown yet.
 *
 * Deliberately a sweep rather than a spinner: it occupies the shape the
 * real row will take, so the panel doesn't resize when the data lands.
 * Honours reduced-motion by holding still instead of animating.
 */
export function skeleton(c: SwarmTokens) {
  return {
    borderRadius: `${c.radius.sm}px`,
    background: `linear-gradient(90deg, ${c.bg.secondary} 25%, ${c.border.subtle} 37%, ${c.bg.secondary} 63%)`,
    backgroundSize: '400% 100%',
    animation: 'swarm-skeleton 1.4s ease-in-out infinite',
    '@keyframes swarm-skeleton': {
      '0%': { backgroundPosition: '100% 50%' },
      '100%': { backgroundPosition: '0% 50%' },
    },
    '@media (prefers-reduced-motion: reduce)': {
      animation: 'none',
      background: c.bg.secondary,
    },
  } as const;
}

/** Segmented control track + item, Linear style: a sunken track with a raised active pill. */
export function segmentTrack(c: SwarmTokens) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    p: '2px',
    borderRadius: `${c.radius.sm}px`,
    background: c.bg.secondary,
    border: `1px solid ${c.border.subtle}`,
  } as const;
}

export function segmentItem(c: SwarmTokens, active: boolean) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    height: 22,
    px: '8px',
    border: 'none',
    cursor: 'pointer',
    borderRadius: `${c.radius.xs}px`,
    fontFamily: c.font.sans,
    ...c.type.caption,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    transition: c.transition,
    color: active ? c.text.primary : c.text.tertiary,
    background: active ? c.bg.surface : 'transparent',
    boxShadow: active ? `${c.shadow.sm}, 0 0 0 1px ${c.border.subtle}` : 'none',
    '& svg': { fontSize: 13 },
    '&:hover': { color: c.text.primary },
  } as const;
}

/** Small coloured dot for status, the only place colour shows up at rest. */
export function statusDot(color: string, size = 6) {
  return { width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0 } as const;
}

/** Borderless toolbar control: text + icon, fills on hover. */
export function ghostButton(c: SwarmTokens) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: 28,
    px: '8px',
    cursor: 'pointer',
    fontFamily: c.font.sans,
    ...c.type.callout,
    fontWeight: 500,
    color: c.text.secondary,
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: `${c.radius.sm}px`,
    whiteSpace: 'nowrap',
    transition: c.transition,
    '& svg': { fontSize: 15, color: c.text.tertiary },
    '&:hover': { background: c.bg.secondary, color: c.text.primary, '& svg': { color: c.text.secondary } },
    '&:disabled': { opacity: 0.4, cursor: 'default' },
  } as const;
}
