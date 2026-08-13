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
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", ui-sans-serif, system-ui, "Helvetica Neue", "Inter", Arial, sans-serif';
const FONT_MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const LIGHT = {
  bg: {
    page: '#F5F5F7',
    surface: '#FFFFFF',
    elevated: '#FBFBFD',
    secondary: '#F2F2F7',
    inverse: '#1D1D1F',
  },
  text: {
    primary: '#1D1D1F',
    secondary: '#48484A',
    tertiary: '#6E6E73',
    muted: '#86868B',
    ghost: 'rgba(110,110,115,0.5)',
  },
  accent: {
    primary: '#007AFF',
    hover: '#0071E3',
    pressed: '#0062CC',
  },
  user: { bubble: '#E9E9EB' },
  border: {
    subtle: 'rgba(0,0,0,0.08)',
    medium: 'rgba(0,0,0,0.12)',
    strong: 'rgba(0,0,0,0.20)',
  },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.05)',
    md: '0 4px 16px rgba(0,0,0,0.06)',
    lg: '0 12px 32px rgba(0,0,0,0.12)',
  },
  status: {
    success: '#248A3D',
    successBg: 'rgba(52,199,89,0.10)',
    error: '#D70015',
    errorBg: 'rgba(255,59,48,0.08)',
    warning: '#B25000',
    warningBg: 'rgba(255,149,0,0.10)',
  },
};

const DARK: typeof LIGHT = {
  bg: {
    page: '#1C1C1E',
    surface: '#2C2C2E',
    elevated: '#3A3A3C',
    secondary: '#242426',
    inverse: '#F5F5F7',
  },
  text: {
    primary: '#F5F5F7',
    secondary: '#D1D1D6',
    tertiary: '#98989D',
    muted: '#8E8E93',
    ghost: 'rgba(152,152,157,0.5)',
  },
  accent: {
    primary: '#0A84FF',
    hover: '#409CFF',
    pressed: '#0070E0',
  },
  user: { bubble: '#3A3A3C' },
  border: {
    subtle: 'rgba(255,255,255,0.08)',
    medium: 'rgba(255,255,255,0.12)',
    strong: 'rgba(255,255,255,0.22)',
  },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.20)',
    md: '0 4px 16px rgba(0,0,0,0.28)',
    lg: '0 12px 32px rgba(0,0,0,0.40)',
  },
  status: {
    success: '#30D158',
    successBg: 'rgba(48,209,88,0.14)',
    error: '#FF453A',
    errorBg: 'rgba(255,69,58,0.14)',
    warning: '#FF9F0A',
    warningBg: 'rgba(255,159,10,0.14)',
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

    bg: p.bg,
    text: p.text,
    accent: p.accent,
    user: p.user,
    border: p.border,
    shadow: p.shadow,
    status: p.status,

    radius: { xs: 5, sm: 8, md: 10, lg: 12, xl: 16, full: 9999 },

    // Template scale: rem-based, 400 for body / 500 for emphasis, tight
    // tracking on headings only. Keyed by the names call sites already use.
    type: {
      caption: { fontSize: '0.75rem', fontWeight: 400, letterSpacing: 0 },
      footnote: { fontSize: '0.75rem', fontWeight: 500, letterSpacing: 0 },
      callout: { fontSize: '0.8125rem', fontWeight: 400, letterSpacing: 0 },
      body: { fontSize: '0.875rem', fontWeight: 400, letterSpacing: 0 },
      headline: { fontSize: '0.875rem', fontWeight: 500, letterSpacing: 0 },
      title3: { fontSize: '1rem', fontWeight: 600, letterSpacing: '-0.01em' },
      title2: { fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.015em' },
      title: { fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.02em' },
    },

    font: { sans: FONT_SANS, serif: FONT_SANS, mono: FONT_MONO },

    transition: 'all 280ms cubic-bezier(0.32, 0.72, 0, 1)',
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
              '*::selection': { background: `rgba(${tokens.accentRgb},0.24)` },
            },
          },
          MuiTooltip: {
            defaultProps: { enterDelay: 400, enterNextDelay: 250 },
            styleOverrides: {
              tooltip: {
                background: tokens.bg.inverse,
                color: isDark ? '#1D1D1F' : '#FFFFFF',
                boxShadow: tokens.shadow.md,
                fontSize: '0.75rem',
                fontWeight: 500,
                padding: '6px 10px',
                borderRadius: 8,
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
