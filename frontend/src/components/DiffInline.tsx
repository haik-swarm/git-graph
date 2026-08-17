import React, { Suspense, lazy, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import CircularProgress from '@mui/material/CircularProgress';
import { useClaudeTokens, useThemeMode } from '@/shared/styles/ThemeContext';
import { slimScroll } from '@/shared/styles/ui';
import { gitgraphDiffUrl } from '@/shared/state/API_ENDPOINTS';

// Only the patch body is wanted here: the row above already carries the
// filename and the +/− counts, so the viewer's own header would print both a
// second time. Root/Content are composed by hand instead of going through
// VendoredToolUi, whose flat preset always includes that header.
const CodeDiff = lazy(() =>
  import('@/toolui/components/code-diff').then(m => ({ default: m.CodeDiff.Root })),
);
const CodeDiffContent = lazy(() =>
  import('@/toolui/components/code-diff').then(m => ({ default: m.CodeDiff.Content })),
);

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

interface Props {
  workspaceId: string;
  filePath: string;
  /** Omit for working-tree changes; pass a sha to read it inside a commit. */
  sha?: string;
  open: boolean;
}

interface DiffState {
  patch: string;
  binary: boolean;
  tooLarge: boolean;
}

/**
 * One file's patch, rendered inline underneath its row. Fetching is deferred
 * until the row is actually opened: a commit can touch dozens of files and
 * pulling every patch to render a list nobody expanded would cost far more
 * than it saves.
 */
const DiffInline: React.FC<Props> = ({ workspaceId, filePath, sha, open }) => {
  const c = useClaudeTokens();
  const { mode } = useThemeMode();
  const [state, setState] = useState<DiffState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(gitgraphDiffUrl(workspaceId, filePath, sha));
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
  }, [open, workspaceId, filePath, sha]);

  const note = (text: string, tone: 'muted' | 'error' = 'muted') => (
    <Box
      sx={{
        ...c.type.caption,
        color: tone === 'error' ? c.status.error : c.text.tertiary,
        px: 1.5,
        py: 1.25,
      }}
    >
      {text}
    </Box>
  );

  return (
    <Collapse in={open} timeout={160} unmountOnExit>
      <Box sx={{ background: c.bg.page }}>
        {error
          ? note(error, 'error')
          : state === null
            ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1.25 }}>
                <CircularProgress size={12} sx={{ color: c.text.tertiary }} />
                <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>Loading diff…</Box>
              </Box>
            )
            : state.tooLarge
              ? note('This diff is too large to display.')
              : state.binary
                ? note('Binary file — no text diff to show.')
                : !state.patch
                  ? note('No changes to show.')
                  : (
                    // Capped so one enormous file can't push the rest of the
                    // commit off screen; the patch scrolls within its own row.
                    <Box
                      className={`tool-ui-scope${mode === 'dark' ? ' dark' : ''}`}
                      sx={{ maxHeight: 420, overflow: 'auto', ...slimScroll(c) }}
                    >
                      <Suspense
                        fallback={
                          <Box sx={{ ...c.type.caption, color: c.text.tertiary, px: 1.5, py: 1.25 }}>
                            Loading diff…
                          </Box>
                        }
                      >
                        <CodeDiff
                          id={`diff-${sha ?? 'worktree'}-${filePath}`}
                          patch={state.patch}
                          filename={filePath}
                          language={languageFor(filePath)}
                          diffStyle="unified"
                          lineNumbers="visible"
                          // Root ships its own bordered, rounded card; the row
                          // already draws that frame, so it's flattened here
                          // rather than nested one inside the other.
                          className="gap-0 min-w-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
                        >
                          <CodeDiffContent />
                        </CodeDiff>
                      </Suspense>
                    </Box>
                  )}
      </Box>
    </Collapse>
  );
};

export default DiffInline;
