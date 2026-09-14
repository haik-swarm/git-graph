import React, { createContext, useCallback, useContext, useRef } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

// macOS-dock-style magnification for the app rail. The row the cursor sits on
// swells to its peak, and each neighbour swells a little less, so the list rides
// a wave that tracks the pointer. Only rows that opt in (app/skill rows)
// register here, so section labels and the Home button never scale.

// Peak scale of the row directly under the cursor. Kept gentle: the rows carry
// trailing indicator badges pinned to the right edge, and a one-axis scroll
// container clips horizontal overflow, so a big row swell would push those
// badges out of sight. The reserved right gutter on the scroll box (see
// AppRail) absorbs the growth at this factor; the drama lives in ICON_PEAK.
const MAX_SCALE = 1.12;
// Peak scale of the icon directly under the cursor. It rides a taller crest
// than its row so the glyph pops well past the label as the wave passes.
const ICON_PEAK = 1.5;
// Leftward slide (px) of a row's right-pinned indicator cluster at peak scale.
// The row swells uniformly anchored to its left edge, which carries the badges
// outward toward the clip edge; sliding the cluster left by this much at the
// crest keeps them in view. Divided by the row scale in apply() so the on-screen
// travel lands true despite the badges inheriting the row's magnification.
const TRAIL_SLIDE = 16;
// Gaussian half-width in px. Kept under one row height so the crest plus the
// immediate neighbour each side ride the wave and the rest stay at rest.
const SIGMA = 24;
// Added scale below this reads as "at rest": we snap it to 1 so untouched rows
// carry no leftover transform.
const EPS = 0.003;

interface DockItem {
  el: HTMLElement;
  apply: (scale: number) => void;
}

interface DockApi {
  register: (item: DockItem) => () => void;
  onMove: (clientY: number) => void;
  reset: () => void;
}

const DockContext = createContext<DockApi | null>(null);

/**
 * Scroll container that magnifies the app rows nested inside it. Drop it in
 * place of the list's scroll Box; children call {@link useAppDockItem} to join
 * the wave.
 */
export const AppDockScroll: React.FC<{
  sx?: SxProps<Theme>;
  children: React.ReactNode;
}> = ({ sx, children }) => {
  const items = useRef<Set<DockItem>>(new Set());
  const frame = useRef<number | null>(null);
  const pointerY = useRef<number | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    const y = pointerY.current;
    const list = Array.from(items.current);
    // Read every rect before writing any transform: batching the measurements
    // keeps a long list from thrashing layout read/write/read/write per frame.
    const centers = list.map(it => {
      const r = it.el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    list.forEach((it, i) => {
      let scale = 1;
      if (y !== null) {
        const d = centers[i] - y;
        scale = 1 + (MAX_SCALE - 1) * Math.exp(-(d * d) / (2 * SIGMA * SIGMA));
      }
      it.apply(scale - 1 < EPS ? 1 : scale);
    });
  }, []);

  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  }, [flush]);

  const api = useRef<DockApi>({
    register: item => {
      items.current.add(item);
      return () => {
        items.current.delete(item);
      };
    },
    onMove: clientY => {
      pointerY.current = clientY;
      schedule();
    },
    reset: () => {
      pointerY.current = null;
      schedule();
    },
  });

  return (
    <DockContext.Provider value={api.current}>
      <Box
        sx={sx}
        onPointerMove={e => api.current.onMove(e.clientY)}
        onPointerLeave={() => api.current.reset()}
      >
        {children}
      </Box>
    </DockContext.Provider>
  );
};

/**
 * Registers a row with the surrounding {@link AppDockScroll} and hands back a
 * ref callback for its scaling element. Pass `enabled = false` (section labels,
 * nav rows) to sit out the wave entirely.
 */
export function useAppDockItem(enabled: boolean) {
  const api = useContext(DockContext);
  const el = useRef<HTMLElement | null>(null);
  const iconEl = useRef<HTMLElement | null>(null);
  const trailEl = useRef<HTMLElement | null>(null);

  const apply = useCallback((scale: number) => {
    // 0..1 progress along the crest, shared by the icon pop and the trail slide
    // so they move as one wave.
    const t = (scale - 1) / (MAX_SCALE - 1);
    const node = el.current;
    if (node) {
      if (scale <= 1) {
        node.style.transform = 'scale(1)';
        node.style.zIndex = '';
      } else {
        node.style.transform = `scale(${scale.toFixed(4)})`;
        // Bigger rows paint over smaller neighbours so the crest is never clipped
        // by the row beneath it as the two overlap.
        node.style.zIndex = String(Math.round(scale * 100));
      }
    }
    const icon = iconEl.current;
    if (icon) {
      if (scale <= 1) {
        icon.style.transform = 'scale(1)';
      } else {
        // The icon is nested in the row, so it already inherits the row's scale.
        // To make it swell further we apply only the leftover factor on top:
        // its own crest (ICON_PEAK) tracks the wave via the same 0..1 progress,
        // then we divide out the row scale the icon already rode.
        const iconTotal = 1 + (ICON_PEAK - 1) * t;
        icon.style.transform = `scale(${(iconTotal / scale).toFixed(4)})`;
      }
    }
    const trail = trailEl.current;
    if (trail) {
      if (scale <= 1) {
        trail.style.transform = 'translateX(0)';
      } else {
        // Slide the cluster left as the row swells so its right-pinned badges
        // stay clear of the clip edge the leftward-origin growth pushes them
        // toward. The badges inherit the row's scale, so divide the travel by
        // it to land the true on-screen distance. Eases in with the same 0..1
        // progress as the swell.
        const slide = (TRAIL_SLIDE * t) / scale;
        trail.style.transform = `translateX(${(-slide).toFixed(2)}px)`;
      }
    }
  }, []);

  const unregister = useRef<(() => void) | null>(null);

  const rowRef = useCallback(
    (node: HTMLElement | null) => {
      if (unregister.current) {
        unregister.current();
        unregister.current = null;
      }
      el.current = node;
      if (node && enabled && api) {
        unregister.current = api.register({ el: node, apply });
      }
    },
    [enabled, api, apply],
  );

  const iconRef = useCallback((node: HTMLElement | null) => {
    iconEl.current = node;
  }, []);

  const trailRef = useCallback((node: HTMLElement | null) => {
    trailEl.current = node;
  }, []);

  return { rowRef, iconRef, trailRef };
}
