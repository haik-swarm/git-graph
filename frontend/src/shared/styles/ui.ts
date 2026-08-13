import type { SwarmTokens } from './ThemeContext';

/** Overlay surface for popovers, menus and sheets. */
export function popover(c: SwarmTokens) {
  return {
    background: c.bg.raised,
    backgroundImage: 'none',
    border: `0.5px solid ${c.border}`,
    borderRadius: `${c.radius.lg}px`,
    boxShadow: c.shadow.popover,
  } as const;
}

/**
 * Padding for a menu popover. Rows inset themselves from this edge, which is
 * what gives the hover highlight its floating look instead of a full-bleed band.
 */
export function menuSurface(c: SwarmTokens) {
  return { ...popover(c), p: '4px' } as const;
}

/**
 * One row of a dropdown menu: icon slot, label, optional right accessory.
 * `danger` tints the row for destructive entries.
 */
export function menuItem(c: SwarmTokens, danger = false) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    width: '100%',
    height: 28,
    px: '8px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    borderRadius: `${c.radius.sm}px`,
    fontFamily: c.font.sans,
    ...c.type.body,
    color: danger ? c.status.danger : c.text.primary,
    transition: 'background 100ms linear',
    '&:hover': { background: danger ? c.status.dangerWash : c.bg.fill },
    '&:disabled': { opacity: 0.4, cursor: 'default', background: 'transparent' },
  } as const;
}

/** Muted caption above a group of menu items. */
export function menuSectionLabel(c: SwarmTokens) {
  return {
    ...c.type.footnote,
    color: c.text.tertiary,
    px: '8px',
    pt: '6px',
    pb: '2px',
    userSelect: 'none',
  } as const;
}

/** Hairline between menu groups, inset from the popover edge. */
export function menuDivider(c: SwarmTokens) {
  return { height: '0.5px', background: c.separator, my: '4px', mx: '8px' } as const;
}

/** Right-aligned shortcut hint or secondary value on a menu row. */
export function menuHint(c: SwarmTokens) {
  return {
    ...c.type.callout,
    color: c.text.tertiary,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  } as const;
}

/** Bordered control: the default macOS push button. */
export function pushButton(c: SwarmTokens) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 24,
    px: '9px',
    cursor: 'pointer',
    fontFamily: c.font.sans,
    ...c.type.callout,
    fontWeight: 500,
    color: c.text.primary,
    background: c.isDark ? c.bg.fill : c.bg.controlRaised,
    border: `0.5px solid ${c.border}`,
    borderRadius: `${c.radius.sm}px`,
    boxShadow: c.shadow.control,
    whiteSpace: 'nowrap',
    transition: c.transition,
    '&:hover': { background: c.bg.fill },
    '&:active': { background: c.bg.fillStrong },
    '&:disabled': { opacity: 0.4, cursor: 'default' },
  } as const;
}

/** Filled accent control: the primary action in a view. */
export function primaryButton(c: SwarmTokens) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 24,
    px: '10px',
    cursor: 'pointer',
    fontFamily: c.font.sans,
    ...c.type.callout,
    fontWeight: 590,
    color: c.text.onAccent,
    background: c.accent.base,
    border: 'none',
    borderRadius: `${c.radius.sm}px`,
    boxShadow: c.shadow.control,
    whiteSpace: 'nowrap',
    transition: c.transition,
    '&:hover': { background: c.accent.hover },
    '&:disabled': { opacity: 0.5, cursor: 'default' },
  } as const;
}

/** Chromeless icon button used in headers and sidebar rails. */
export function iconButton(c: SwarmTokens, size = 26) {
  return {
    width: size,
    height: size,
    borderRadius: `${c.radius.sm}px`,
    color: c.text.secondary,
    transition: c.transition,
    '&:hover': { color: c.text.primary, background: c.bg.fill },
    '&.Mui-disabled': { color: c.text.quaternary },
  } as const;
}

/** Inset field: search boxes, text inputs, segmented control tracks. */
export function sunkenField(c: SwarmTokens) {
  return {
    background: c.bg.sunken,
    border: 'none',
    borderRadius: `${c.radius.sm}px`,
  } as const;
}

/** Overlay scrollbar: invisible until the container is hovered. */
export function slimScroll(c: SwarmTokens) {
  return {
    '&::-webkit-scrollbar': { width: 8, height: 8 },
    '&::-webkit-scrollbar-track': { background: 'transparent' },
    '&::-webkit-scrollbar-thumb': {
      background: 'transparent',
      borderRadius: 4,
      border: '2px solid transparent',
      backgroundClip: 'content-box',
    },
    '&:hover::-webkit-scrollbar-thumb': {
      background: c.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)',
      backgroundClip: 'content-box',
    },
  } as const;
}

export function focusRing(c: SwarmTokens) {
  return {
    '&:focus-visible': {
      outline: 'none',
      boxShadow: c.accent.ring,
    },
  } as const;
}
