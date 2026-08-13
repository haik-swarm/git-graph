import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ButtonBase from '@mui/material/ButtonBase';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useClaudeTokens, useThemeMode } from '@/shared/styles/ThemeContext';
import { iconButton, slimScroll } from '@/shared/styles/ui';
import { layoutCommits, type Commit } from '@/shared/graphLayout';
import {
  GITGRAPH_APPS_URL,
  gitgraphCommitUrl,
  gitgraphGraphUrl,
} from '@/shared/state/API_ENDPOINTS';
import AppPicker, { type AppEntry } from '@/components/AppPicker';
import CommitList from '@/components/CommitList';
import CommitPanel, { type DirtyFile } from '@/components/CommitPanel';
import GitHubPanel from '@/components/GitHubPanel';
import MagicUpdateButton from '@/components/MagicUpdateButton';
import { githubStatusUrl } from '@/shared/state/API_ENDPOINTS';

interface Graph {
  is_repo: boolean;
  commits: Commit[];
  branches: string[];
  current_branch: string | null;
  dirty: DirtyFile[];
  truncated: boolean;
}

interface CommitFile {
  path: string;
  added: number | null;
  removed: number | null;
}

const TOOLBAR_HEIGHT = 44;

const Home: React.FC = () => {
  const c = useClaudeTokens();
  const { mode, toggleMode } = useThemeMode();

  const [apps, setApps] = useState<AppEntry[]>([]);
  const [selected, setSelected] = useState<AppEntry | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [files, setFiles] = useState<CommitFile[] | null>(null);
  const [gitHubKey, setGitHubKey] = useState(0);
  const [hasRemote, setHasRemote] = useState(false);
  const [magicBusy, setMagicBusy] = useState(false);

  useEffect(() => {
    if (!selected) {
      setHasRemote(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(githubStatusUrl(selected.workspace_id));
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setHasRemote(Boolean(data?.has_remote));
      } catch {
        // Non-fatal: the Magic Update button just skips pushing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, gitHubKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(GITGRAPH_APPS_URL);
        if (!res.ok) throw new Error(`apps ${res.status}`);
        const data = await res.json();
        const list: AppEntry[] = data.apps ?? [];
        if (cancelled) return;
        setApps(list);
        setSelected(list.find(a => a.has_git) ?? list[0] ?? null);
      } catch {
        if (!cancelled) setError("Couldn't reach the backend.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadGraph = useCallback(async (app: AppEntry | null) => {
    if (!app) return;
    setLoading(true);
    setError(null);
    setSelectedSha(null);
    setFiles(null);
    try {
      const res = await fetch(gitgraphGraphUrl(app.workspace_id));
      if (!res.ok) throw new Error(`graph ${res.status}`);
      setGraph(await res.json());
    } catch {
      setGraph(null);
      setError("Couldn't read that workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGraph(selected);
  }, [selected, loadGraph]);

  // Details load lazily: the graph payload stays small even for deep repos.
  useEffect(() => {
    if (!selected || !selectedSha) return;
    let cancelled = false;
    setFiles(null);
    (async () => {
      try {
        const res = await fetch(gitgraphCommitUrl(selected.workspace_id, selectedSha));
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setFiles(data.files ?? []);
      } catch {
        /* the row still shows its metadata without the file list */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, selectedSha]);

  const layout = useMemo(
    () => layoutCommits(graph?.commits ?? []),
    [graph],
  );

  const detail = useMemo(
    () => layout.nodes.find(n => n.sha === selectedSha) ?? null,
    [layout, selectedSha],
  );

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: c.bg.window,
        fontFamily: c.font.sans,
      }}
    >
      <Box
        sx={{
          height: TOOLBAR_HEIGHT,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          background: c.bg.sidebar,
          borderBottom: `0.5px solid ${c.separator}`,
        }}
      >
        <AppPicker apps={apps} selected={selected} onSelect={setSelected} />

        {graph?.current_branch && (
          <Typography sx={{ ...c.type.callout, color: c.text.tertiary }}>
            {graph.current_branch}
            {graph.branches.length > 1 && ` · ${graph.branches.length} branches`}
          </Typography>
        )}

        <Box sx={{ flex: 1 }} />

        {selected && graph?.dirty?.length ? (
          <MagicUpdateButton
            workspaceId={selected.workspace_id}
            hasRemote={hasRemote}
            onBusyChange={setMagicBusy}
            onDone={() => {
              setGitHubKey(k => k + 1);
              void loadGraph(selected);
            }}
          />
        ) : null}

        {selected && graph?.dirty?.length && !magicBusy ? (
          <CommitPanel
            workspaceId={selected.workspace_id}
            dirty={graph.dirty}
            onCommitted={() => {
              setGitHubKey(k => k + 1);
              void loadGraph(selected);
            }}
          />
        ) : null}

        {selected && graph?.is_repo && (
          <GitHubPanel
            workspaceId={selected.workspace_id}
            appName={selected.name}
            refreshKey={gitHubKey}
          />
        )}

        <ButtonBase
          onClick={() => {
            setGitHubKey(k => k + 1);
            void loadGraph(selected);
          }}
          sx={{ ...iconButton(c), display: 'flex' }}
        >
          <RefreshIcon sx={{ fontSize: 15 }} />
        </ButtonBase>
        <ButtonBase onClick={toggleMode} sx={{ ...iconButton(c), display: 'flex' }}>
          {mode === 'dark' ? (
            <LightModeIcon sx={{ fontSize: 15 }} />
          ) : (
            <DarkModeIcon sx={{ fontSize: 15 }} />
          )}
        </ButtonBase>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', ...slimScroll(c) }}>
          {loading ? (
            <Centered>
              <CircularProgress size={18} sx={{ color: c.text.quaternary }} />
            </Centered>
          ) : error ? (
            <Centered>
              <Typography sx={{ ...c.type.body, color: c.status.danger }}>{error}</Typography>
            </Centered>
          ) : !selected ? (
            <Centered>
              <Typography sx={{ ...c.type.body, color: c.text.tertiary }}>
                No apps found.
              </Typography>
            </Centered>
          ) : !graph?.is_repo ? (
            <Centered>
              <Typography sx={{ ...c.type.body, color: c.text.secondary }}>
                No git history in this workspace yet.
              </Typography>
            </Centered>
          ) : (
            <>
              <Box sx={{ height: 8 }} />
              <CommitList
                layout={layout}
                selectedSha={selectedSha}
                workspaceId={selected?.workspace_id ?? null}
                headSha={graph?.commits?.[0]?.sha ?? null}
                onSelect={sha => setSelectedSha(prev => (prev === sha ? null : sha))}
                onRestored={() => {
                  setGitHubKey(k => k + 1);
                  void loadGraph(selected);
                }}
              />
              {graph.truncated && (
                <Typography
                  sx={{ ...c.type.caption, color: c.text.quaternary, px: 3, pb: 3 }}
                >
                  Showing the {layout.nodes.length} most recent commits.
                </Typography>
              )}
            </>
          )}
        </Box>

        {detail && (
          <Box
            sx={{
              width: 300,
              flexShrink: 0,
              borderLeft: `0.5px solid ${c.separator}`,
              background: c.bg.sidebar,
              overflowY: 'auto',
              p: 2,
              ...slimScroll(c),
            }}
          >
            <Typography sx={{ ...c.type.title3, color: c.text.primary, mb: 0.5 }}>
              {detail.subject}
            </Typography>
            <Typography sx={{ ...c.type.callout, color: c.text.secondary }}>
              {detail.author}
            </Typography>
            <Typography
              sx={{ ...c.type.caption, fontFamily: c.font.mono, color: c.text.tertiary, mb: 2 }}
            >
              {detail.short} · {new Date(detail.date).toLocaleString()}
            </Typography>

            {files === null ? (
              <Typography sx={{ ...c.type.caption, color: c.text.quaternary }}>
                Loading changes…
              </Typography>
            ) : (
              files.map(f => (
                <Box
                  key={f.path}
                  sx={{ display: 'flex', alignItems: 'baseline', gap: 1, py: '3px' }}
                >
                  <Typography
                    sx={{
                      ...c.type.caption,
                      fontFamily: c.font.mono,
                      color: c.text.secondary,
                      flex: 1,
                      minWidth: 0,
                      wordBreak: 'break-all',
                    }}
                  >
                    {f.path}
                  </Typography>
                  <Typography
                    sx={{
                      ...c.type.caption,
                      fontFamily: c.font.mono,
                      color: c.status.success,
                      flexShrink: 0,
                    }}
                  >
                    {f.added === null ? 'bin' : `+${f.added}`}
                  </Typography>
                  {f.removed !== null && f.removed > 0 && (
                    <Typography
                      sx={{
                        ...c.type.caption,
                        fontFamily: c.font.mono,
                        color: c.status.danger,
                        flexShrink: 0,
                      }}
                    >
                      -{f.removed}
                    </Typography>
                  )}
                </Box>
              ))
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    sx={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 240,
    }}
  >
    {children}
  </Box>
);

export default Home;
