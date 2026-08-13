import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

type Mode = 'light' | 'dark';

// ---- Cross-app theme persistence --------------------------------------------
//
// Each app workspace runs on its own vite port, so plain localStorage won't
// carry the user's light/dark choice to a different app. The template's
// approach is kept intact: default to the OS appearance synchronously (no
// flash), then adopt OpenSwarm's cross-app override once it arrives.
//
// What's changed from the template is the TOKEN SHAPE below, not this
// machinery — the palette is ported from the Workflow Editor so this app
// speaks the same macOS design language.

const LOCAL_STORAGE_KEY = 'openswarm-app-theme-override';
const OPENSWARM_BACKEND = 'http://localhost:8324';

function readUrlToken(): string {
  try {
    return new URLSearchParams(window.location.search).get('token') ?? '';
  } catch {
    return '';
  }
}

function readLocalStorageOverride(): Mode | null {
  try {
    const v = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function detectSystemPreference(): Mode {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function getInitialMode(): Mode {
  return readLocalStorageOverride() ?? detectSystemPreference();
}

// System faces only, so switching costs no network round trip.
const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif';
const FONT_MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const LIGHT = {
  window: '#FFFFFF',
  sidebar: '#F1F1F3',
  raised: '#FFFFFF',
  sunken: 'rgba(120,120,128,0.10)',
  fill: 'rgba(120,120,128,0.12)',
  fillStrong: 'rgba(120,120,128,0.20)',
  separator: 'rgba(0,0,0,0.10)',
  border: 'rgba(0,0,0,0.13)',
  textPrimary: '#1D1D1F',
  textSecondary: 'rgba(60,60,67,0.60)',
  textTertiary: 'rgba(60,60,67,0.42)',
  textQuaternary: 'rgba(60,60,67,0.26)',
  success: '#34C759',
  danger: '#FF3B30',
  dangerRgb: '255,59,48',
  warning: '#FF9500',
  controlRaised: '#FFFFFF',
  accent: '#007AFF',
  shadowPopover: '0 10px 34px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.10)',
  shadowControl: '0 1px 2px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.06)',
};

const DARK: typeof LIGHT = {
  window: '#1A1A1C',
  sidebar: '#232326',
  raised: '#2C2C2E',
  sunken: 'rgba(0,0,0,0.26)',
  fill: 'rgba(235,235,245,0.10)',
  fillStrong: 'rgba(235,235,245,0.18)',
  separator: 'rgba(255,255,255,0.09)',
  border: 'rgba(255,255,255,0.14)',
  textPrimary: '#F5F5F7',
  textSecondary: 'rgba(235,235,245,0.62)',
  textTertiary: 'rgba(235,235,245,0.40)',
  textQuaternary: 'rgba(235,235,245,0.24)',
  success: '#30D158',
  danger: '#FF453A',
  dangerRgb: '255,69,58',
  warning: '#FF9F0A',
  controlRaised: '#5E5E63',
  accent: '#0A84FF',
  shadowPopover: '0 12px 40px rgba(0,0,0,0.50), 0 0 0 0.5px rgba(255,255,255,0.10)',
  shadowControl: '0 1px 2px rgba(0,0,0,0.36), 0 0 0 0.5px rgba(255,255,255,0.06)',
};

type Palette = typeof LIGHT;

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// Relative luminance, so a light accent gets ink instead of white.
function readableOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex).split(',').map(Number);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.6 ? '#1D1D1F' : '#FFFFFF';
}

// Hover shifts toward the surface it sits on: darker in light mode, lighter
// in dark mode, which is what AppKit does to a filled control on hover.
function shade(hex: string, isDark: boolean): string {
  const [r, g, b] = hexToRgb(hex).split(',').map(Number);
  const mix = (v: number) => Math.round(isDark ? v + (255 - v) * 0.22 : v * 0.86);
  return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function buildTokens(p: Palette, isDark: boolean) {
  const accentRgb = hexToRgb(p.accent);

  return {
    isDark,
    accentRgb,

    bg: {
      window: p.window,
      sidebar: p.sidebar,
      raised: p.raised,
      sunken: p.sunken,
      fill: p.fill,
      fillStrong: p.fillStrong,
      controlRaised: p.controlRaised,
    },
    text: {
      primary: p.textPrimary,
      secondary: p.textSecondary,
      tertiary: p.textTertiary,
      quaternary: p.textQuaternary,
      onAccent: readableOn(p.accent),
    },
    accent: {
      base: p.accent,
      hover: shade(p.accent, isDark),
      wash: `rgba(${accentRgb},${isDark ? 0.2 : 0.12})`,
      edge: `rgba(${accentRgb},0.45)`,
      ring: `0 0 0 3px rgba(${accentRgb},0.35)`,
    },
    status: {
      success: p.success,
      danger: p.danger,
      dangerWash: `rgba(${p.dangerRgb},${isDark ? 0.18 : 0.1})`,
      warning: p.warning,
    },
    separator: p.separator,
    border: p.border,
    shadow: { popover: p.shadowPopover, control: p.shadowControl },

    // Apple's control metrics: 6 for small controls, 8 for grouped rows,
    // 10 for popovers, 12 for sheets.
    radius: { xs: 4, sm: 6, md: 8, lg: 10, xl: 12, xxl: 16, full: 9999 },

    // Mapped onto the macOS text styles rather than an invented ramp.
    type: {
      caption: { fontSize: '11px', letterSpacing: '0.005em', fontWeight: 400 },
      footnote: { fontSize: '11px', letterSpacing: '0.005em', fontWeight: 590 },
      callout: { fontSize: '12px', letterSpacing: '0em', fontWeight: 400 },
      body: { fontSize: '13px', letterSpacing: '-0.005em', fontWeight: 400 },
      headline: { fontSize: '13px', letterSpacing: '-0.005em', fontWeight: 590 },
      title3: { fontSize: '15px', letterSpacing: '-0.01em', fontWeight: 590 },
      title2: { fontSize: '17px', letterSpacing: '-0.015em', fontWeight: 600 },
      title: { fontSize: '22px', letterSpacing: '-0.021em', fontWeight: 600 },
    },
    font: { sans: FONT_SANS, mono: FONT_MONO, serif: FONT_SANS },
    ease: {
      out: 'cubic-bezier(0.32, 0.72, 0, 1)',
      spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
    },
    transition: 'all 160ms cubic-bezier(0.32, 0.72, 0, 1)',
  };
}

export type SwarmTokens = ReturnType<typeof buildTokens>;
/** Kept under the template's name so existing call sites still resolve. */
export type ClaudeTokens = SwarmTokens;

interface ThemeModeContextValue {
  mode: Mode;
  toggleMode: () => void;
}

const _bootMode: Mode = typeof window !== 'undefined' ? getInitialMode() : 'light';

const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: _bootMode,
  toggleMode: () => {},
});

const TokensContext = createContext<SwarmTokens>(
  buildTokens(_bootMode === 'dark' ? DARK : LIGHT, _bootMode === 'dark'),
);

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

export function useClaudeTokens(): SwarmTokens {
  return useContext(TokensContext);
}

const ClaudeThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<Mode>(getInitialMode);
  // Once the user toggles even once we stop chasing the OS setting.
  const userOverrideRef = useRef<boolean>(readLocalStorageOverride() !== null);

  useEffect(() => {
    const token = readUrlToken();
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${OPENSWARM_BACKEND}/api/settings/app-theme-override`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const remote = data?.mode;
        if (remote !== 'light' && remote !== 'dark') return;
        // localStorage wins here — the user toggled in this app, which is
        // the more recent signal than the cross-app default.
        if (readLocalStorageOverride() !== null) return;
        userOverrideRef.current = true;
        setMode(remote);
      } catch {
        /* offline or blocked — the system default stands */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (userOverrideRef.current) return;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = () => {
      if (userOverrideRef.current) return;
      setMode(mq.matches ? 'dark' : 'light');
    };
    mq.addEventListener?.('change', onChange);
    return () => {
      try {
        mq.removeEventListener?.('change', onChange);
      } catch {
        /* listener already gone */
      }
    };
  }, []);

  const toggleMode = useCallback(() => {
    setMode(prev => {
      const next: Mode = prev === 'light' ? 'dark' : 'light';
      userOverrideRef.current = true;
      try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, next);
      } catch {
        /* private mode — the remote PUT still carries it */
      }
      const token = readUrlToken();
      if (token) {
        // The dedicated endpoint merges; the generic /api/settings PUT
        // expects a full body and would blank every unset field.
        fetch(`${OPENSWARM_BACKEND}/api/settings/app-theme-override`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ mode: next }),
        }).catch(() => {
          /* offline — the local override still holds */
        });
      }
      return next;
    });
  }, []);

  const isDark = mode === 'dark';
  const tokens = useMemo(() => buildTokens(isDark ? DARK : LIGHT, isDark), [isDark]);

  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          primary: { main: tokens.accent.base },
          background: { default: tokens.bg.window, paper: tokens.bg.raised },
          text: { primary: tokens.text.primary, secondary: tokens.text.secondary },
        },
        typography: {
          fontFamily: FONT_SANS,
          button: { textTransform: 'none' as const, fontWeight: 590 },
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: {
                backgroundColor: tokens.bg.window,
                color: tokens.text.primary,
                overflow: 'hidden',
                WebkitFontSmoothing: 'antialiased',
              },
              '*::selection': { background: `rgba(${tokens.accentRgb},0.28)` },
            },
          },
          MuiTooltip: {
            defaultProps: { enterDelay: 500, enterNextDelay: 300 },
            styleOverrides: {
              tooltip: {
                background: isDark ? '#38383C' : '#FFFFFF',
                color: tokens.text.primary,
                border: `0.5px solid ${tokens.border}`,
                boxShadow: tokens.shadow.popover,
                fontSize: 11,
                fontWeight: 400,
                padding: '3px 7px',
                borderRadius: 5,
              },
            },
          },
        },
      }),
    [mode, isDark, tokens],
  );

  const modeValue = useMemo(() => ({ mode, toggleMode }), [mode, toggleMode]);

  return (
    <ThemeModeContext.Provider value={modeValue}>
      <TokensContext.Provider value={tokens}>
        <ThemeProvider theme={muiTheme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </TokensContext.Provider>
    </ThemeModeContext.Provider>
  );
};

export default ClaudeThemeProvider;
