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

const FONT_SANS =
  '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif';
const FONT_MONO =
  '"SF Mono", ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace';

// Neutral, near monochrome palette in the Linear / Notion register: ink is
// the accent, colour is reserved for small status marks.
const LIGHT = {
  bg: {
    page: '#FBFBFA',
    surface: '#FFFFFF',
    elevated: '#FFFFFF',
    secondary: '#F3F3F2',
    rail: '#F7F7F6',
    inverse: '#1A1A1A',
  },
  text: {
    primary: '#1A1A1A',
    secondary: '#3F3F3F',
    tertiary: '#6B6B6B',
    muted: '#8F8F8F',
    ghost: 'rgba(26,26,26,0.32)',
  },
  accent: {
    primary: '#1A1A1A',
    hover: '#333333',
    pressed: '#000000',
    contrast: '#FFFFFF',
  },
  user: { bubble: '#F0F0EF' },
  border: {
    subtle: 'rgba(0,0,0,0.06)',
    medium: 'rgba(0,0,0,0.10)',
    strong: 'rgba(0,0,0,0.16)',
  },
  shadow: {
    sm: '0 1px 1px rgba(0,0,0,0.03)',
    md: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
    lg: '0 0 0 1px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)',
  },
  status: {
    success: '#2F8A4E',
    successBg: 'rgba(47,138,78,0.07)',
    error: '#C9372C',
    errorBg: 'rgba(201,55,44,0.06)',
    warning: '#B26A12',
    warningBg: 'rgba(178,106,18,0.07)',
  },
};

const DARK: typeof LIGHT = {
  bg: {
    page: '#101011',
    surface: '#161617',
    elevated: '#1C1C1E',
    secondary: '#1E1E20',
    rail: '#0C0C0D',
    inverse: '#EDEDED',
  },
  text: {
    primary: '#EDEDED',
    secondary: '#C8C8C8',
    tertiary: '#8F8F94',
    muted: '#6E6E73',
    ghost: 'rgba(237,237,237,0.30)',
  },
  accent: {
    primary: '#EDEDED',
    hover: '#FFFFFF',
    pressed: '#D4D4D4',
    contrast: '#111111',
  },
  user: { bubble: '#232325' },
  border: {
    subtle: 'rgba(255,255,255,0.06)',
    medium: 'rgba(255,255,255,0.09)',
    strong: 'rgba(255,255,255,0.15)',
  },
  shadow: {
    sm: '0 1px 1px rgba(0,0,0,0.30)',
    md: '0 1px 2px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.30)',
    lg: '0 0 0 1px rgba(255,255,255,0.06), 0 12px 32px rgba(0,0,0,0.55)',
  },
  status: {
    success: '#4CB873',
    successBg: 'rgba(76,184,115,0.10)',
    error: '#E5625A',
    errorBg: 'rgba(229,98,90,0.10)',
    warning: '#D9963A',
    warningBg: 'rgba(217,150,58,0.10)',
  },
};

type Palette = typeof LIGHT;

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function buildTokens(p: Palette, isDark: boolean) {
  return {
    isDark,
    accentRgb: hexToRgb(p.accent.primary),
    // Focus rings and selection use a quiet blue so they stay legible on the
    // monochrome accent.
    focusRgb: isDark ? '94,140,255' : '45,108,223',

    bg: p.bg,
    text: p.text,
    accent: p.accent,
    user: p.user,
    border: p.border,
    shadow: p.shadow,
    status: p.status,

    radius: { xs: 4, sm: 6, md: 8, lg: 10, xl: 12, full: 9999 },

    // Template scale: rem-based, 400 for body / 500 for emphasis, tight
    // tracking on headings only. Keyed by the names call sites already use.
    type: {
      caption: { fontSize: '0.71875rem', fontWeight: 400, letterSpacing: 0 },
      footnote: { fontSize: '0.71875rem', fontWeight: 500, letterSpacing: 0 },
      callout: { fontSize: '0.78125rem', fontWeight: 400, letterSpacing: '-0.003em' },
      body: { fontSize: '0.8125rem', fontWeight: 400, letterSpacing: '-0.006em' },
      headline: { fontSize: '0.8125rem', fontWeight: 500, letterSpacing: '-0.006em' },
      title3: { fontSize: '0.9375rem', fontWeight: 600, letterSpacing: '-0.012em' },
      title2: { fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.018em' },
      title: { fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.022em' },
    },

    font: { sans: FONT_SANS, serif: FONT_SANS, mono: FONT_MONO },

    transition: 'all 140ms cubic-bezier(0.25, 0.1, 0.25, 1)',
    ease: 'cubic-bezier(0.32, 0.72, 0, 1)',
  };
}

export type SwarmTokens = ReturnType<typeof buildTokens>;
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
          primary: { main: tokens.accent.primary },
          background: { default: tokens.bg.page, paper: tokens.bg.surface },
          text: { primary: tokens.text.primary, secondary: tokens.text.secondary },
        },
        typography: {
          fontFamily: FONT_SANS,
          button: { textTransform: 'none' as const, fontWeight: 500 },
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: {
                backgroundColor: tokens.bg.page,
                color: tokens.text.primary,
                overflow: 'hidden',
                WebkitFontSmoothing: 'antialiased',
              },
              '*::selection': { background: `rgba(${tokens.focusRgb},0.22)` },
              html: { fontFeatureSettings: '"cv11", "ss01", "ss03"', textRendering: 'optimizeLegibility' },
              'body, button, input, textarea': { fontFeatureSettings: '"cv11", "ss01", "ss03"' },
            },
          },
          MuiTooltip: {
            defaultProps: { enterDelay: 350, enterNextDelay: 150 },
            styleOverrides: {
              tooltip: {
                background: tokens.bg.inverse,
                color: isDark ? '#111111' : '#FFFFFF',
                boxShadow: tokens.shadow.md,
                fontSize: '0.71875rem',
                fontWeight: 500,
                padding: '4px 8px',
                borderRadius: 6,
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
