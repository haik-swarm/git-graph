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
import RuleFolderRoundedIcon from '@mui/icons-material/RuleFolderRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import Tooltip from '@mui/material/Tooltip';
import { useClaudeTokens, useThemeMode } from '@/shared/styles/ThemeContext';
import { iconButton, primaryButton, pushButton, slimScroll } from '@/shared/styles/ui';
import { layoutCommits, type Commit } from '@/shared/graphLayout';
import {
  GITGRAPH_APPS_URL,
  GITGRAPH_COLLAB_SWEEP_URL,
  GITGRAPH_SKILLS_URL,
  GITGRAPH_SKILLS_STATUS_URL,
  GITGRAPH_STATUS_URL,
  GITGRAPH_SYNC_REMOTES_URL,
  gitgraphCommitUrl,
  gitgraphGraphUrl,
  gitgraphInitUrl,
} from '@/shared/state/API_ENDPOINTS';
import AppRail, {
  type RepoState,
  type Sharing,
  type SharingPhase,
} from '@/components/AppRail';
import Releases from '@/components/Releases';
import type { AppEntry } from '@/components/AppPicker';
import CloudSheet from '@/components/CloudSheet';
import BulkIconSheet from '@/components/BulkIconSheet';
import CommitList from '@/components/CommitList';
import DeleteAppDialog from '@/components/DeleteAppDialog';
import RenameAppDialog from '@/components/RenameAppDialog';
import DirtyWorkCard from '@/components/DirtyWorkCard';
import GitHubPanel from '@/components/GitHubPanel';
import ReleasePanel from '@/components/ReleasePanel';
import IconPanel from '@/components/IconPanel';
import CollaboratorsPanel from '@/components/CollaboratorsPanel';
import SettingsPage from '@/components/SettingsPage';
import HomeGrid from '@/components/HomeGrid';
import RepoHero from '@/components/RepoHero';
import { RestartNotice } from '@/components/RestartNotice';
import { Placeholder, Scroller, Shell, Toolbar } from '@/components/Chrome';
import { githubStatusUrl } from '@/shared/state/API_ENDPOINTS';
import type { DirtyFile } from '@/components/DirtyWorkCard';

interface HomeMeta {
  is_repo: boolean;
  commit_count: number;
  dirty_count: number;
  current_branch: string | null;
  head_subject: string | null;
  head_date: string | null;
  head_sha: string | null;
  has_remote: boolean;
  unpushed: number;
  runtime_running?: boolean;
  runtime_ready?: boolean;
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

  // Both entity sources are loaded at once and merged into one list, each entry
  // tagged with its `kind`. Apps read from the workspace registry; skills read
  // from the on-disk skill trees. Both return the same AppEntry shape and both
  // flow through the id-keyed git endpoints, so the graph, commit, restore, and
  // GitHub panels are already generic. There is no global source switch — the
  // rail and each page own their own display filter.
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [selected, setSelected] = useState<AppEntry | null>(null);
  const [mode, setMode] = useState<'home' | 'app' | 'releases' | 'settings'>('home');
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
  const [metaBusy, setMetaBusy] = useState(false);
  // Who else is on each app. Only GitHub knows, so the rail withholds its
  // Private/Shared split until this lands rather than guessing.
  const [sharing, setSharing] = useState<Record<string, Sharing>>({});
  const [sharingPhase, setSharingPhase] = useState<SharingPhase>('loading');
  // Remote-tracking refs only move when something fetches, so until the
  // background sync lands, every unpushed count is a local-only guess.
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [iconSheetOpen, setIconSheetOpen] = useState(false);
  // Bumped after an install/delete to re-poll the restart notice immediately.
  const [noticeKey, setNoticeKey] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [remoteHtmlUrl, setRemoteHtmlUrl] = useState<string | null>(null);

  // Fetch both sources in parallel and merge. Each list is tagged with its
  // kind so downstream filters never have to parse the id prefix. If one fetch
  // fails we keep the other's results rather than blanking the whole list.
  const refetchApps = useCallback(async (): Promise<AppEntry[]> => {
    const [appsRes, skillsRes] = await Promise.allSettled([
      fetch(GITGRAPH_APPS_URL),
      fetch(GITGRAPH_SKILLS_URL),
    ]);
    const read = async (
      r: PromiseSettledResult<Response>,
      kind: 'app' | 'skill',
    ): Promise<AppEntry[]> => {
      if (r.status !== 'fulfilled' || !r.value.ok) return [];
      try {
        const data = await r.value.json();
        const list: AppEntry[] = data.apps ?? [];
        return list.map(a => ({ ...a, kind }));
      } catch {
        return [];
      }
    };
    const [appList, skillList] = await Promise.all([
      read(appsRes, 'app'),
      read(skillsRes, 'skill'),
    ]);
    // Both fetches failing is the only real error — surface it so the effect
    // can show the backend-unreachable state instead of an empty list.
    if (
      appsRes.status === 'rejected' &&
      skillsRes.status === 'rejected'
    ) {
      throw new Error('both list fetches failed');
    }
    const merged = [...appList, ...skillList];
    setApps(merged);
    return merged;
  }, []);

  useEffect(() => {
    if (!selected) {
      setHasRemote(false);
      setRemoteHtmlUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(githubStatusUrl(selected.workspace_id));
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setHasRemote(Boolean(data?.has_remote));
          setRemoteHtmlUrl(typeof data?.html_url === 'string' ? data.html_url : null);
        }
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
        if (!cancelled) setError("We couldn't reach the backend.");
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
    } catch {
      setGraph(null);
      setError("We couldn't read that workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'app') return;
    void loadGraph(selected);
  }, [selected, loadGraph, mode]);

  // Batch fetch every app's status in one call (backend fans out across
  // threads). Cheap enough to re-run on Home entry and on window focus,
  // which is what keeps the grid honest when the user commits outside the
  // app or the workspace changes between visits.
  const refreshHomeMeta = useCallback(async () => {
    setMetaBusy(true);
    try {
      const [appsRes, skillsRes] = await Promise.allSettled([
        fetch(GITGRAPH_STATUS_URL),
        fetch(GITGRAPH_SKILLS_STATUS_URL),
      ]);
      const read = async (
        r: PromiseSettledResult<Response>,
      ): Promise<Record<string, HomeMeta>> => {
        if (r.status !== 'fulfilled' || !r.value.ok) return {};
        try {
          const data = await r.value.json();
          return (data?.status ?? {}) as Record<string, HomeMeta>;
        } catch {
          return {};
        }
      };
      const [appMeta, skillMeta] = await Promise.all([read(appsRes), read(skillsRes)]);
      // Keyed by prefixed id, so a plain spread can't collide across sources.
      setHomeMeta({ ...appMeta, ...skillMeta });
    } catch {
      /* Non-fatal: cards keep whatever they last saw. */
    } finally {
      setMetaBusy(false);
    }
  }, []);

  // Who each app is shared with. Merged rather than replaced so an app the
  // sweep couldn't read keeps whatever it last knew instead of dropping
  // back to private and making the rail jump.
  const refreshSharing = useCallback(async () => {
    try {
      const collabRes = await fetch(GITGRAPH_COLLAB_SWEEP_URL);
      if (!collabRes.ok) throw new Error(`collab-sweep ${collabRes.status}`);
      const data = await collabRes.json();
      const fresh = (data?.sharing ?? {}) as Record<string, Sharing>;
      setSharing(prev => {
        const next = { ...prev };
        for (const [id, s] of Object.entries(fresh)) {
          if (s?.known) next[id] = s;
        }
        return next;
      });
      // No GitHub connected means sharing isn't just unread, it's
      // unknowable; the rail says so instead of spinning forever.
      setSharingPhase(data?.connected ? 'ready' : 'unavailable');
    } catch {
      // Offline or the sweep failed: don't strand the rail in a skeleton.
      setSharingPhase('unavailable');
    }
  }, []);

  // The network half. Fires after the local read has already painted, so a
  // slow remote costs freshness rather than time-to-first-render. Merged
  // per app instead of replacing wholesale: a fetch that failed for one app
  // leaves that app's local numbers alone rather than blanking the grid.
  const syncRemotes = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch(GITGRAPH_SYNC_REMOTES_URL, { method: 'POST' });
      if (!res.ok) throw new Error(`sync ${res.status}`);
      const data = await res.json();
      const fresh = (data?.status ?? {}) as Record<string, HomeMeta>;
      setHomeMeta(prev => ({ ...prev, ...fresh }));
      setSyncedAt(new Date().toISOString());
    } catch {
      /* Offline or no GitHub: the local counts stay, the badge stays "local". */
    } finally {
      setSyncing(false);
    }
  }, []);

  // How many app-kind entries are loaded. The collab sweep is
  // workspace-app-only, so skill entries never enter it; their rail rows stay a
  // plain Tracked/Untracked list. Derived once here and reused as an effect dep.
  const appKindCount = useMemo(
    () => apps.filter(a => a.kind === 'app').length,
    [apps],
  );

  // The rail is on screen in every mode, not just Home, so its grouping is
  // swept once the app list is known rather than on Home entry. Runs whenever
  // any app-kind entries exist; skills are excluded on the backend sweep.
  useEffect(() => {
    if (appKindCount === 0) return;
    void refreshSharing();
  }, [appKindCount, refreshSharing]);

  // Re-scan on every view change so returning to Home (or to an app page,
  // or from another window entirely) doesn't leave stale numbers.
  //
  // Not gated on Home any more: the rail's "Needs you" group reads the same
  // batch, and it's on screen in every mode. Gated, the rail would sit empty
  // on an app page until the user happened to visit Home.
  useEffect(() => {
    // Local first so the grid paints immediately, then the network pass
    // corrects the unpushed counts once it lands. The network half stays
    // Home-only: it's the expensive one, and Home is where its freshness
    // badge is actually rendered.
    const scan = refreshHomeMeta();
    // The remote sync is workspace-app-only (it fetches app GitHub remotes) and
    // merges results by id, so skill entries are simply never touched by it.
    if (mode === 'home') void scan.then(() => syncRemotes());
    const onFocus = () => {
      if (document.visibilityState === 'visible') void refreshHomeMeta();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [mode, refreshHomeMeta, syncRemotes, apps.length]);

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
      setTrackingId(app.is_flat ? app.id : app.workspace_id);
      setInitError(null);
      try {
        const res = await fetch(gitgraphInitUrl(app.workspace_id), { method: 'POST' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.detail || `init ${res.status}`);
        }
        // Tracking a flat skill converts it server-side, so the record we
        // re-select is the new folder skill named by the returned id, not the
        // flat id we started from. A normal app keeps its workspace_id.
        const data = await res.json().catch(() => ({}));
        const list = await refetchApps();
        const fresh = app.is_flat
          ? list.find(a => a.id === data?.id)
          : list.find(a => a.workspace_id === app.workspace_id);
        setSelected(fresh ?? app);
        setMode('app');
      } catch (err) {
        setInitError(err instanceof Error ? err.message : "We couldn't track that app.");
      } finally {
        setInitBusy(false);
        setTrackingId(null);
      }
    },
    [refetchApps],
  );

  const openApp = useCallback((app: AppEntry) => {
    // A flat skill has no repo to show a graph for; opening it would load an
    // empty workspace. Its only action is Convert, so a body click is a no-op.
    if (app.is_flat) return;
    setSelected(app);
    setMode('app');
  }, []);

  const goHome = useCallback(() => {
    setMode('home');
    setSelectedSha(null);
  }, []);

  const goReleases = useCallback(() => {
    setMode('releases');
    setSelectedSha(null);
  }, []);

  const goSettings = useCallback(() => {
    setMode('settings');
    setSelectedSha(null);
  }, []);

  const layout = useMemo(
    () => layoutCommits(graph?.commits ?? []),
    [graph],
  );

  const commitDates = useMemo(
    () => layout.nodes.map(n => n.date),
    [layout],
  );

  const headCommit = useMemo(
    () => (graph?.head_sha ? layout.nodes.find(n => n.sha === graph.head_sha) ?? null : null),
    [graph, layout],
  );

  const refresh = useCallback(() => {
    setGitHubKey(k => k + 1);
    void loadGraph(selected);
    // App-page commits are the most common way home's counts go stale,
    // so eagerly rescan the batch too instead of waiting for the user to
    // navigate back and trigger the focus effect.
    void refreshHomeMeta();
    // Applying an icon commits a file the app list reports via has_icon,
    // so refetch it here or a freshly-set icon wouldn't show until reload.
    void refetchApps();
  }, [loadGraph, selected, refreshHomeMeta, refetchApps]);

  const runningIds = useMemo(() => {
    const set = new Set<string>();
    for (const [id, m] of Object.entries(homeMeta)) {
      if (m?.runtime_running) set.add(id);
    }
    return set;
  }, [homeMeta]);

  // Outstanding work per app, for the rail's "Needs you" group. Only apps
  // with something pending are kept, so a clean workspace costs no entry.
  const repoState = useMemo(() => {
    const out: Record<string, RepoState> = {};
    for (const [id, m] of Object.entries(homeMeta)) {
      const dirty = m?.dirty_count ?? 0;
      // An app with no remote can't be "unpushed" — every commit would
      // count as outstanding against a push that isn't possible yet.
      const unpushed = m?.has_remote ? m?.unpushed ?? 0 : 0;
      // Tracked with commits but no remote yet: it has never been published.
      const needsPublish = Boolean(m?.is_repo) && m?.has_remote === false && (m?.commit_count ?? 0) > 0;
      if (dirty > 0 || unpushed > 0 || needsPublish) out[id] = { dirty, unpushed, needsPublish };
    }
    return out;
  }, [homeMeta]);

  const rail = (
    <AppRail
      apps={apps}
      selected={mode === 'app' ? selected : null}
      homeActive={mode === 'home'}
      releasesActive={mode === 'releases'}
      settingsActive={mode === 'settings'}
      onReleases={goReleases}
      onSettings={goSettings}
      onHome={goHome}
      onSelect={openApp}
      runningIds={runningIds}
      sharing={sharing}
      sharingPhase={sharingPhase}
      repoState={repoState}
      onTracked={app => {
        void (async () => {
          const list = await refetchApps().catch(() => null);
          const fresh = list?.find(a => a.workspace_id === app.workspace_id) ?? app;
          setSelected(fresh);
          setMode('app');
        })();
      }}
    />
  );

  const refreshHome = useCallback(() => {
    void refetchApps();
    void refreshHomeMeta();
  }, [refetchApps, refreshHomeMeta]);

  const handleDeleted = useCallback(
    (deletedId: string) => {
      setNoticeKey(k => k + 1);
      // Bounce back to home if the deleted app was the one being viewed;
      // otherwise the app-page effect would try to reload a graph that no
      // longer exists.
      if (selected?.workspace_id === deletedId) {
        setSelected(null);
        setMode('home');
        setSelectedSha(null);
      }
      void refetchApps();
      void refreshHomeMeta();
    },
    [selected, refetchApps, refreshHomeMeta],
  );

  const handleRenamed = useCallback(
    async (newName: string) => {
      setNoticeKey(k => k + 1);
      // Refetch the app list so the new name flows into `selected` (its name,
      // the toolbar title, and the hero all read from that record).
      const list = await refetchApps().catch(() => null);
      void refreshHomeMeta();
      if (selected && list) {
        const fresh = list.find(a => a.workspace_id === selected.workspace_id);
        // A slug rename rewrites origin, so refresh the GitHub status strip too.
        setGitHubKey(k => k + 1);
        setSelected(fresh ?? { ...selected, name: newName });
      }
    },
    [selected, refetchApps, refreshHomeMeta],
  );

  const handleInstalled = useCallback(
    async (workspaceId: string) => {
      setNoticeKey(k => k + 1);
      const list = await refetchApps().catch(() => null);
      void refreshHomeMeta();
      const fresh = list?.find(a => a.workspace_id === workspaceId);
      if (fresh) {
        setSelected(fresh);
        setMode('app');
        setCloudOpen(false);
      }
    },
    [refetchApps, refreshHomeMeta],
  );

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

  if (mode === 'releases') {
    return (
      <Shell rail={rail}>
        <Releases
          onOpen={workspaceId => {
            const app = apps.find(a => a.workspace_id === workspaceId);
            if (app) openApp(app);
          }}
        />
      </Shell>
    );
  }

  if (mode === 'settings') {
    return (
      <Shell rail={rail}>
        <SettingsPage onIgnoreSaved={() => void refreshHomeMeta()} />
      </Shell>
    );
  }

  if (mode === 'home') {
    return (
      <Shell rail={rail}>
        <Toolbar>
          <Box sx={{ ...c.type.headline, color: c.text.primary, letterSpacing: '-0.01em' }}>
            Home
          </Box>
          <Box sx={{ ...c.type.callout, color: c.text.tertiary }}>
            {apps.length} {apps.length === 1 ? 'item' : 'items'}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Your cloud — install any OpenSwarm app you've pushed to GitHub">
            <ButtonBase
              onClick={() => setCloudOpen(true)}
              sx={{
                ...pushButton(c),
                gap: '6px',
                color: c.accent.primary,
                borderColor: `rgba(${c.accentRgb},0.35)`,
                '& svg': { fontSize: 16 },
              }}
              aria-label="Your cloud"
            >
              <CloudRoundedIcon />
              Your cloud
            </ButtonBase>
          </Tooltip>
          <Tooltip title="Generate icons — make icons for many apps at once with your saved defaults">
            <ButtonBase
              onClick={() => setIconSheetOpen(true)}
              sx={{
                ...pushButton(c),
                gap: '6px',
                '& svg': { fontSize: 16 },
              }}
              aria-label="Generate icons"
            >
              <AutoAwesomeRoundedIcon />
              Generate icons
            </ButtonBase>
          </Tooltip>
          <Tooltip title="Global .gitignore — one list, mirrored into every tracked app">
            <ButtonBase
              onClick={goSettings}
              sx={{
                ...pushButton(c),
                gap: '6px',
                '& svg': { fontSize: 16 },
              }}
              aria-label="Global .gitignore"
            >
              <RuleFolderRoundedIcon />
              Global .gitignore
            </ButtonBase>
          </Tooltip>
          {toolbarChrome}
        </Toolbar>
        <RestartNotice refreshKey={noticeKey} />
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
              metaBusy={metaBusy}
              onOpen={openApp}
              onTrack={trackApp}
              trackingId={trackingId}
              syncing={syncing}
              syncedAt={syncedAt}
              onSyncRemotes={() => void syncRemotes()}
              onBulkDone={() =>
                void refreshHomeMeta().then(() => syncRemotes())
              }
            />
          )}
        </Scroller>
        <CloudSheet
          open={cloudOpen}
          onClose={() => setCloudOpen(false)}
          onInstalled={id => void handleInstalled(id)}
        />
        <BulkIconSheet
          open={iconSheetOpen}
          onClose={() => setIconSheetOpen(false)}
          apps={apps}
          onDone={refreshHome}
        />
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
          <CollaboratorsPanel
            workspaceId={selected.workspace_id}
            refreshKey={gitHubKey}
            onRosterChanged={refreshSharing}
          />
        )}

        {selected && graph?.is_repo && (
          <IconPanel
            workspaceId={selected.workspace_id}
            appName={selected.name}
            appDescription={selected.description}
            // Applying an icon commits a file, so the graph redraws to show it.
            onApplied={refresh}
            // The gear / "Global defaults" link now lands on the Settings tab,
            // which owns the icon config, instead of the inline sheet.
            onOpenSettings={goSettings}
          />
        )}

        {selected && graph?.is_repo && (
          <GitHubPanel
            workspaceId={selected.workspace_id}
            appName={selected.name}
            refreshKey={gitHubKey}
            // A pull rewrites local history, so the graph has to redraw.
            onSynced={refresh}
          />
        )}

        {selected && graph?.is_repo && (
          <ReleasePanel
            workspaceId={selected.workspace_id}
            appName={selected.name}
            refreshKey={gitHubKey}
            onReleased={refresh}
          />
        )}

        {selected && (
          <Tooltip title="Rename this app everywhere its name lives">
            <ButtonBase
              onClick={() => setRenameOpen(true)}
              sx={{
                ...pushButton(c),
                gap: '4px',
                color: c.text.secondary,
                '&:hover': { color: c.accent.primary, borderColor: c.accent.primary },
                '& svg': { fontSize: 16 },
              }}
              aria-label="Rename app"
            >
              <DriveFileRenameOutlineRoundedIcon />
              Rename
            </ButtonBase>
          </Tooltip>
        )}

        {selected && (
          <Tooltip title="Delete this app locally (workspace + dashboard entry)">
            <ButtonBase
              onClick={() => setDeleteOpen(true)}
              sx={{
                ...pushButton(c),
                gap: '4px',
                color: c.text.secondary,
                '&:hover': { color: c.status.error, borderColor: c.status.error },
                '& svg': { fontSize: 16 },
              }}
              aria-label="Delete app"
            >
              <DeleteOutlineRoundedIcon />
              Delete
            </ButtonBase>
          </Tooltip>
        )}

        {toolbarChrome}
      </Toolbar>

      <RestartNotice refreshKey={noticeKey} />

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
            title="We couldn't load that"
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
                  sx={{ ...primaryButton(c) }}
                >
                  {initBusy ? (
                    <CircularProgress size={12} sx={{ color: "#FFFFFF" }} />
                  ) : (
                    'Track this app'
                  )}
                </ButtonBase>
                {initError && (
                  <Box sx={{ ...c.type.caption, color: c.status.error }}>
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
              commitDates={commitDates}
              onIconChange={refresh}
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
                onIgnored={refresh}
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
                borderBottom: `1px solid ${c.border.subtle}`,
              }}
            >
              <Box sx={{ ...c.type.headline, color: c.text.primary }}>
                History
              </Box>
              <Box sx={{ flex: 1 }} />
              <Box sx={{ ...c.type.caption, color: c.text.muted }}>
                Newest first
              </Box>
            </Box>

            <CommitList
              layout={layout}
              selectedSha={selectedSha}
              headSha={graph.head_sha}
              onSelect={sha => setSelectedSha(prev => (prev === sha ? null : sha))}
              files={files}
              workspaceId={selected?.workspace_id ?? null}
              currentBranch={graph.current_branch ?? null}
              branches={graph.branches ?? []}
              onRestored={refresh}
            />

            {graph.truncated && (
              <Box
                sx={{
                  ...c.type.caption,
                  color: c.text.muted,
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

      {selected && (
        <RenameAppDialog
          open={renameOpen}
          onClose={() => setRenameOpen(false)}
          workspaceId={selected.workspace_id}
          appName={selected.name}
          hasRemote={hasRemote}
          onRenamed={handleRenamed}
        />
      )}

      {selected && (
        <DeleteAppDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          workspaceId={selected.workspace_id}
          appName={selected.name}
          hasRemote={hasRemote}
          remoteHtmlUrl={remoteHtmlUrl}
          orphanOutputId={selected.workspace_id ? null : selected.output_id ?? selected.id}
          isSkill={selected.kind === 'skill'}
          onDeleted={handleDeleted}
        />
      )}
    </Shell>
  );
};

export default Home;
