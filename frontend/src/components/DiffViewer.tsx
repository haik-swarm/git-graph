import React, { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { iconButton, slimScroll } from '@/shared/styles/ui';
import { gitgraphDiffUrl } from '@/shared/state/API_ENDPOINTS';
import VendoredToolUi from '@/toolui/VendoredToolUi';

export interface DiffTarget {
  path: string;
  /** Omitted for working-tree changes; set to read the file inside a commit. */
  sha?: string;
  /** Shown in the header so the sheet can name where it was opened from. */
  context?: string;
}

interface Props {
  workspaceId: string;
  target: DiffTarget | null;
  onClose: () => void;
}

interface DiffState {
  patch: string;
  binary: boolean;
  tooLarge: boolean;
}

/** Map a file extension to the highlighter's language id. */
function languageFor(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'text';
  const ext = name.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    md: 'markdown',
    sql: 'sql',
  };
  return map[ext] ?? 'text';
}

/**
 * Full-height right-hand sheet showing one file's patch. Opened from both
 * the uncommitted list and the commit inspector, so the header names which
 * view it came from rather than assuming the working tree.
 */
const DiffViewer: React.FC<Props> = ({ workspaceId, target, onClose }) => {
  const c = useClaudeTokens();
  const [state, setState] = useState<DiffState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = Boolean(target);

  useEffect(() => {
    if (!target) {
      setState(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setState(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          gitgraphDiffUrl(workspaceId, target.path, target.sha),
        );
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.detail ?? `Couldn't read that diff (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        setState({
          patch: data.patch ?? '',
          binary: Boolean(data.binary),
          tooLarge: Boolean(data.too_large),
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "We couldn't read that diff.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, target]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const diffProps = useMemo(() => {
    if (!target || !state?.patch) return null;
    return {
      id: `diff-${target.sha ?? 'worktree'}-${target.path}`,
      patch: state.patch,
      filename: target.path,
      language: languageFor(target.path),
      diffStyle: 'unified' as const,
      lineNumbers: 'visible' as const,
    };
  }, [target, state]);

  if (!open || !target) return null;

  const slash = target.path.lastIndexOf('/');
  const dir = slash === -1 ? '' : target.path.slice(0, slash + 1);
  const name = slash === -1 ? target.path : target.path.slice(slash + 1);

  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 30, display: 'flex' }}>
      <Box
        onClick={onClose}
        sx={{
          flex: 1,
          background: c.isDark ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.12)',
          backdropFilter: 'blur(1px)',
        }}
      />
      <Box
        role="dialog"
        aria-modal="true"
        aria-label={`Changes to ${name}`}
        sx={{
          width: 760,
          maxWidth: '92vw',
          display: 'flex',
          flexDirection: 'column',
          background: c.bg.page,
          borderLeft: `1px solid ${c.border.subtle}`,
          boxShadow: c.shadow.lg,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            height: 48,
            flexShrink: 0,
            px: 1.5,
            borderBottom: `1px solid ${c.border.subtle}`,
          }}
        >
          <DescriptionOutlinedIcon sx={{ fontSize: 15, color: c.text.tertiary }} />
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'baseline',
              ...c.type.caption,
              fontFamily: c.font.mono,
              overflow: 'hidden',
            }}
          >
            {dir && (
              <Box
                component="span"
                sx={{
                  color: c.text.muted,
                  minWidth: 0,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  direction: 'rtl',
                  textAlign: 'left',
                }}
              >
                {dir}
              </Box>
            )}
            <Box component="span" sx={{ color: c.text.primary, flexShrink: 0 }}>
              {name}
            </Box>
          </Box>
          {target.context && (
            <Box sx={{ ...c.type.caption, color: c.text.tertiary, flexShrink: 0 }}>
              {target.context}
            </Box>
          )}
          <ButtonBase
            onClick={onClose}
            aria-label="Close"
            sx={{ ...iconButton(c, 24), '& svg': { fontSize: 15 } }}
          >
            <CloseRoundedIcon />
          </ButtonBase>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2, ...slimScroll(c) }}>
          {error ? (
            <Box sx={{ ...c.type.body, color: c.status.error }}>{error}</Box>
          ) : !state ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                py: 6,
              }}
            >
              <CircularProgress size={20} sx={{ color: c.text.tertiary }} />
            </Box>
          ) : state.tooLarge ? (
            <Box sx={{ ...c.type.body, color: c.text.tertiary }}>
              This diff is too large to render here. It's still committed and
              pushed like any other change.
            </Box>
          ) : state.binary ? (
            <Box sx={{ ...c.type.body, color: c.text.tertiary }}>
              Binary file — nothing to show line by line.
            </Box>
          ) : !state.patch.trim() ? (
            <Box sx={{ ...c.type.body, color: c.text.tertiary }}>
              No textual changes in this file.
            </Box>
          ) : (
            diffProps && <VendoredToolUi name="code-diff" props={diffProps} />
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default DiffViewer;
