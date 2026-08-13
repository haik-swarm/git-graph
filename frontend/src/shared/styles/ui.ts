import type { SwarmTokens } from './ThemeContext';

/** Surface + hairline + hover lift. The workhorse container. */
export function card(c: SwarmTokens, interactive = false) {
  return {
    borderRadius: `${c.radius.lg}px`,
    border: `1px solid ${c.border.subtle}`,
    background: c.bg.surface,
    transition: c.transition,
    ...(interactive && {
      cursor: 'pointer',
      '&:hover': {
        borderColor: c.border.strong,
        boxShadow: c.shadow.md,
        transform: 'translateY(-2px)',
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
  return { ...popover(c), p: '6px' } as const;
}

/** One row of a dropdown menu. `danger` tints the row for destructive entries. */
export function menuItem(c: SwarmTokens, danger = false) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    width: '100%',
    minHeight: 34,
    px: '10px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    borderRadius: `${c.radius.sm}px`,
    fontFamily: c.font.sans,
    ...c.type.body,
    color: danger ? c.text.ghost : c.text.secondary,
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
    px: '10px',
    pt: 1,
    pb: '4px',
    userSelect: 'none',
  } as const;
}

export function menuDivider(c: SwarmTokens) {
  return { height: '1px', background: c.border.subtle, my: '6px', mx: '10px' } as const;
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
    minHeight: 34,
    px: '14px',
    cursor: 'pointer',
    fontFamily: c.font.sans,
    ...c.type.body,
    fontWeight: 500,
    color: c.text.secondary,
    background: 'transparent',
    border: `1px solid ${c.border.medium}`,
    borderRadius: `${c.radius.sm}px`,
    whiteSpace: 'nowrap',
    transition: c.transition,
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
    minHeight: 34,
    px: '16px',
    cursor: 'pointer',
    fontFamily: c.font.sans,
    ...c.type.body,
    fontWeight: 500,
    color: '#FFFFFF',
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
export function iconButton(c: SwarmTokens, size = 32) {
  return {
    width: size,
    height: size,
    borderRadius: `${c.radius.sm}px`,
    color: c.text.tertiary,
    transition: c.transition,
    '&:hover': {
      color: c.accent.primary,
      background: `rgba(${c.accentRgb},0.06)`,
    },
    '&.Mui-disabled': { color: c.text.ghost },
  } as const;
}

/** Ghost at rest, error only on hover. */
export function destructiveIconButton(c: SwarmTokens, size = 32) {
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
    accent: { bg: `rgba(${c.accentRgb},0.10)`, fg: c.accent.primary },
    neutral: { bg: c.bg.secondary, fg: c.text.muted },
  }[tone];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    height: 22,
    px: '9px',
    borderRadius: `${c.radius.full}px`,
    ...c.type.caption,
    fontWeight: 500,
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
    background: c.bg.secondary,
    border: `1px solid ${c.border.subtle}`,
    borderRadius: `${c.radius.sm}px`,
    transition: c.transition,
    '&:focus-within': {
      borderColor: c.accent.primary,
      background: c.bg.surface,
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
      boxShadow: `0 0 0 3px rgba(${c.accentRgb},0.35)`,
    },
  } as const;
}
