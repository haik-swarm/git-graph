import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import RocketLaunchRoundedIcon from '@mui/icons-material/RocketLaunchRounded';
import Tooltip from '@mui/material/Tooltip';
import { useClaudeTokens, useThemeMode } from '@/shared/styles/ThemeContext';
import { iconButton, primaryButton, slimScroll } from '@/shared/styles/ui';
import { layoutCommits, type Commit } from '@/shared/graphLayout';
import {
  GITGRAPH_APPS_URL,
  gitgraphCommitUrl,
  gitgraphGraphUrl,
  gitgraphInitUrl,
} from '@/shared/state/API_ENDPOINTS';
import AppRail from '@/components/AppRail';
import type { AppEntry } from '@/components/AppPicker';
import CommitList from '@/components/CommitList';
import CommitSheet from '@/components/CommitSheet';
import DirtyWorkCard from '@/components/DirtyWorkCard';
import GitHubPanel from '@/components/GitHubPanel';
import HomeGrid from '@/components/HomeGrid';
import RepoHero from '@/components/RepoHero';
import { Placeholder, Scroller, Shell, Toolbar } from '@/components/Chrome';
import { githubStatusUrl } from '@/shared/state/API_ENDPOINTS';
import type { DirtyFile } from '@/components/CommitPanel';

interface HomeMeta {
  is_repo: boolean;
  commit_count: number;
  dirty_count: number;
  current_branch: string | null;
  head_subject: string | null;
  head_date: string | null;
}

interface Graph {
  is_repo: boolean;
  commits: Commit[];
  branches: string[];
  current_branch: string | null;
  head_sha: string | null;
  dirty: DirtyFile[];
  truncated: boolean;
}

interface CommitFile {
  path: string;
  added: number | null;
  removed: number | null;
}

const Home: React.FC = () => {
  const c = useClaudeTokens();
  const { mode: themeMode, toggleMode } = useThemeMode();

  const [apps, setApps] = useState<AppEntry[]>([]);
  const [selected, setSelected] = useState<AppEntry | null>(null);
  const [mode, setMode] = useState<'home' | 'app'>('home');
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [files, setFiles] = useState<CommitFile[] | null>(null);
  const [gitHubKey, setGitHubKey] = useState(0);
  const [hasRemote, setHasRemote] = useState(false);
  const [magicBusy, setMagicBusy] = useState(false);
  const [initBusy, setInitBusy] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  const [homeMeta, setHomeMeta] = useState<Record<string, HomeMeta>>({});
  const [metaLoading, setMetaLoading] = useState<Set<string>>(() => new Set());

  const refetchApps = useCallback(async (): Promise<AppEntry[]> => {
    const res = await fetch(GITGRAPH_APPS_URL);
    if (!res.ok) throw new Error(`apps ${res.status}`);
    const data = await res.json();
    const list: AppEntry[] = data.apps ?? [];
    setApps(list);
    return list;
  }, []);

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
        /* Non-fatal: the Magic Update button just skips pushing. */
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
        await refetchApps();
      } catch {
        if (!cancelled) setError("Couldn't reach the backend.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refetchApps]);

  const loadGraph = useCallback(async (app: AppEntry | null) => {
    if (!app) return;
    setLoading(true);
    setError(null);
    setSelectedSha(null);
    setFiles(null);
    try {
      const res = await fetch(gitgraphGraphUrl(app.workspace_id));
      if (!res.ok) throw new Error(`graph ${res.status}`);
      const data: Graph = await res.json();
      setGraph(data);
      // Refresh this app's home-grid meta so returning home matches reality.
      setHomeMeta(prev => ({
        ...prev,
        [app.workspace_id]: {
          is_repo: data.is_repo,
          commit_count: data.commits?.length ?? 0,
          dirty_count: data.dirty?.length ?? 0,
          current_branch: data.current_branch ?? null,
          head_subject: data.commits?.[0]?.subject ?? null,
          head_date: data.commits?.[0]?.date ?? null,
        },
      }));
    } catch {
      setGraph(null);
      setError("Couldn't read that workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'app') return;
    void loadGraph(selected);
  }, [selected, loadGraph, mode]);

  // Lazily fetch home meta for tracked apps so the grid can show branch,
  // commit count, and last-change time without spinning up every graph
  // eagerly on first paint.
  useEffect(() => {
    if (mode !== 'home') return;
    const needs = apps.filter(
      a =>
        a.has_git &&
        a.workspace_exists &&
        homeMeta[a.workspace_id] === undefined &&
        !metaLoading.has(a.workspace_id),
    );
    if (needs.length === 0) return;

    let cancelled = false;
    setMetaLoading(prev => {
      const next = new Set(prev);
      for (const a of needs) next.add(a.workspace_id);
      return next;
    });

    for (const app of needs) {
      void (async () => {
        try {
          const res = await fetch(gitgraphGraphUrl(app.workspace_id));
          if (!res.ok) throw new Error(`graph ${res.status}`);
          const data: Graph = await res.json();
          if (cancelled) return;
          setHomeMeta(prev => ({
            ...prev,
            [app.workspace_id]: {
              is_repo: data.is_repo,
              commit_count: data.commits?.length ?? 0,
              dirty_count: data.dirty?.length ?? 0,
              current_branch: data.current_branch ?? null,
              head_subject: data.commits?.[0]?.subject ?? null,
              head_date: data.commits?.[0]?.date ?? null,
            },
          }));
        } catch {
          /* leave meta undefined — the card falls back to "not tracked yet" */
        } finally {
          if (cancelled) return;
          setMetaLoading(prev => {
            const next = new Set(prev);
            next.delete(app.workspace_id);
            return next;
          });
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [apps, mode, homeMeta, metaLoading]);

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

  const trackApp = useCallback(
    async (app: AppEntry) => {
      setInitBusy(true);
      setTrackingId(app.workspace_id);
      setInitError(null);
      try {
        const res = await fetch(gitgraphInitUrl(app.workspace_id), { method: 'POST' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.detail || `init ${res.status}`);
        }
        const list = await refetchApps();
        const fresh = list.find(a => a.workspace_id === app.workspace_id) ?? app;
        // Drop any stale meta so the grid refetches once we're back home.
        setHomeMeta(prev => {
          const next = { ...prev };
          delete next[fresh.workspace_id];
          return next;
        });
        setSelected(fresh);
        setMode('app');
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Failed to track.');
      } finally {
        setInitBusy(false);
        setTrackingId(null);
      }
    },
    [refetchApps],
  );

  const openApp = useCallback((app: AppEntry) => {
    setSelected(app);
    setMode('app');
  }, []);

  const goHome = useCallback(() => {
    setMode('home');
    setSelectedSha(null);
  }, []);

  const layout = useMemo(
    () => layoutCommits(graph?.commits ?? []),
    [graph],
  );

  const detail = useMemo(
    () => layout.nodes.find(n => n.sha === selectedSha) ?? null,
    [layout, selectedSha],
  );

  const headCommit = useMemo(
    () => (graph?.head_sha ? layout.nodes.find(n => n.sha === graph.head_sha) ?? null : null),
    [graph, layout],
  );

  const refresh = useCallback(() => {
    setGitHubKey(k => k + 1);
    void loadGraph(selected);
  }, [loadGraph, selected]);

  const rail = (
    <AppRail
      apps={apps}
      selected={mode === 'app' ? selected : null}
      homeActive={mode === 'home'}
      onHome={goHome}
      onSelect={openApp}
      onTracked={app => {
        void (async () => {
          const list = await refetchApps().catch(() => null);
          const fresh = list?.find(a => a.workspace_id === app.workspace_id) ?? app;
          setHomeMeta(prev => {
            const next = { ...prev };
            delete next[fresh.workspace_id];
            return next;
          });
          setSelected(fresh);
          setMode('app');
        })();
      }}
    />
  );

  const refreshHome = useCallback(() => {
    setHomeMeta({});
    void refetchApps();
  }, [refetchApps]);

  const toolbarChrome = (
    <>
      <Tooltip title="Refresh">
        <ButtonBase
          onClick={mode === 'home' ? refreshHome : refresh}
          sx={{ ...iconButton(c), display: 'flex' }}
          aria-label="Refresh"
        >
          <RefreshRoundedIcon sx={{ fontSize: 16 }} />
        </ButtonBase>
      </Tooltip>
      <Tooltip title={themeMode === 'dark' ? 'Light mode' : 'Dark mode'}>
        <ButtonBase
          onClick={toggleMode}
          sx={{ ...iconButton(c), display: 'flex' }}
          aria-label="Toggle theme"
        >
          {themeMode === 'dark' ? (
            <LightModeRoundedIcon sx={{ fontSize: 16 }} />
          ) : (
            <DarkModeRoundedIcon sx={{ fontSize: 16 }} />
          )}
        </ButtonBase>
      </Tooltip>
    </>
  );

  if (mode === 'home') {
    return (
      <Shell rail={rail}>
        <Toolbar>
          <Box sx={{ ...c.type.headline, color: c.text.primary, letterSpacing: '-0.01em' }}>
            Home
          </Box>
          <Box sx={{ ...c.type.callout, color: c.text.tertiary }}>
            {apps.length} {apps.length === 1 ? 'app' : 'apps'}
          </Box>
          <Box sx={{ flex: 1 }} />
          {toolbarChrome}
        </Toolbar>
        <Scroller>
          {loading && apps.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 320,
              }}
            >
              <CircularProgress size={20} sx={{ color: c.text.tertiary }} />
            </Box>
          ) : error && apps.length === 0 ? (
            <Placeholder
              danger
              icon={<CloudOffRoundedIcon />}
              title="Couldn't reach the backend"
              hint={error}
            />
          ) : apps.length === 0 ? (
            <Placeholder
              icon={<SearchOffRoundedIcon />}
              title="No apps yet"
              hint="Once you have apps in your workspace they'll appear here."
            />
          ) : (
            <HomeGrid
              apps={apps}
              meta={homeMeta}
              metaLoading={metaLoading}
              onOpen={openApp}
              onTrack={trackApp}
              trackingId={trackingId}
            />
          )}
        </Scroller>
      </Shell>
    );
  }

  return (
    <Shell rail={rail}>
      <Toolbar>
        <Box sx={{ ...c.type.headline, color: c.text.primary, letterSpacing: '-0.01em' }}>
          {selected ? selected.name : 'Git Graph'}
        </Box>
        {selected && graph?.is_repo && (
          <Box sx={{ ...c.type.callout, color: c.text.tertiary }}>
            {layout.nodes.length} {layout.nodes.length === 1 ? 'commit' : 'commits'}
            {graph.truncated && '+'}
          </Box>
        )}

        <Box sx={{ flex: 1 }} />

        {selected && graph?.is_repo && (
          <GitHubPanel
            workspaceId={selected.workspace_id}
            appName={selected.name}
            refreshKey={gitHubKey}
          />
        )}

        {toolbarChrome}
      </Toolbar>

      <Scroller>
        {loading ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 320,
            }}
          >
            <CircularProgress size={20} sx={{ color: c.text.tertiary }} />
          </Box>
        ) : error ? (
          <Placeholder
            danger
            icon={<CloudOffRoundedIcon />}
            title="Couldn't reach the backend"
            hint={error}
          />
        ) : !selected ? (
          <Placeholder
            icon={<SearchOffRoundedIcon />}
            title="No apps yet"
            hint="Once you have apps in your workspace they'll appear in the sidebar."
          />
        ) : !graph?.is_repo ? (
          <Placeholder
            icon={<RocketLaunchRoundedIcon />}
            title={`Start tracking ${selected.name}`}
            hint="Turn this workspace into a real git repository so you can commit, branch, and roll back."
            action={
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <ButtonBase
                  onClick={() => void trackApp(selected)}
                  disabled={initBusy}
                  sx={{ ...primaryButton(c), height: 32, px: '18px' }}
                >
                  {initBusy ? (
                    <CircularProgress size={12} sx={{ color: c.text.onAccent }} />
                  ) : (
                    'Track this app'
                  )}
                </ButtonBase>
                {initError && (
                  <Box sx={{ ...c.type.caption, color: c.status.danger }}>
                    {initError}
                  </Box>
                )}
              </Box>
            }
          />
        ) : (
          <>
            <RepoHero
              app={selected}
              currentBranch={graph.current_branch}
              branches={graph.branches}
              headSubject={headCommit?.subject ?? null}
              headSha={graph.head_sha}
              headDate={headCommit?.date ?? null}
              commitCount={layout.nodes.length}
              dirtyCount={graph.dirty?.length ?? 0}
            />

            {graph.dirty && graph.dirty.length > 0 && (
              <DirtyWorkCard
                workspaceId={selected.workspace_id}
                dirty={graph.dirty}
                hasRemote={hasRemote}
                magicBusy={magicBusy}
                onBusyChange={setMagicBusy}
                onCommitted={refresh}
                onDiscarded={refresh}
                onMagicDone={refresh}
              />
            )}

            <Box
              sx={{
                mx: 3,
                mb: 1,
                pb: 1,
                display: 'flex',
                alignItems: 'baseline',
                gap: 1,
                borderBottom: `0.5px solid ${c.separator}`,
              }}
            >
              <Box
                sx={{
                  ...c.type.footnote,
                  fontWeight: 590,
                  color: c.text.tertiary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontSize: '10px',
                }}
              >
                History
              </Box>
              <Box sx={{ flex: 1 }} />
              <Box sx={{ ...c.type.caption, color: c.text.quaternary }}>
                Newest first
              </Box>
            </Box>

            <CommitList
              layout={layout}
              selectedSha={selectedSha}
              headSha={graph.head_sha}
              onSelect={sha => setSelectedSha(prev => (prev === sha ? null : sha))}
            />

            {graph.truncated && (
              <Box
                sx={{
                  ...c.type.caption,
                  color: c.text.quaternary,
                  px: 3,
                  pb: 3,
                }}
              >
                Showing the {layout.nodes.length} most recent commits.
              </Box>
            )}
          </>
        )}
      </Scroller>

      <CommitSheet
        commit={detail}
        files={files}
        workspaceId={selected?.workspace_id ?? null}
        headSha={graph?.head_sha ?? null}
        currentBranch={graph?.current_branch ?? null}
        branches={graph?.branches ?? []}
        onClose={() => setSelectedSha(null)}
        onRestored={refresh}
      />
    </Shell>
  );
};

export default Home;
