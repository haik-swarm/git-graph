import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import PublishRoundedIcon from '@mui/icons-material/PublishRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import TableRowsRoundedIcon from '@mui/icons-material/TableRowsRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { card, primaryButton, pushButton, slimScroll, sunkenField } from '@/shared/styles/ui';
import { BrandGlyph, Pill, Placeholder } from '@/components/Chrome';
import BulkActionBar from '@/components/BulkActionBar';
import type { BulkEntry } from '@/components/BulkActionBar';
import StatRow from '@/components/StatRow';
import { absoluteTime, relativeTime } from '@/shared/graphLayout';
import type { AppEntry } from '@/components/AppPicker';

type SortKey = 'recent' | 'name' | 'status';
type FilterKey = 'all' | 'tracked' | 'untracked' | 'dirty' | 'unpushed' | 'unpublished';
type ViewKey = 'cards' | 'table';

const VIEW_STORAGE_KEY = 'gitgraph:homeView';

function loadView(): ViewKey {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
}

/**
 * Tracked, holds at least one commit, and has no remote at all — the app has
 * never been published to GitHub. Distinct from `unpushed`, which is commits
 * ahead of a remote that already exists. `has_remote` is undefined until the
 * per-app status lands, so an app mid-load isn't flagged prematurely.
 */
function isUnpublished(app: AppEntry, m?: Meta): boolean {
  return Boolean(
    app.has_git &&
      app.workspace_exists &&
      m?.is_repo &&
      m.has_remote === false &&
      (m.commit_count ?? 0) > 0,
  );
}

interface Meta {
  is_repo: boolean;
  commit_count: number;
  dirty_count: number;
  current_branch: string | null;
  head_subject: string | null;
  head_date: string | null;
  head_sha?: string | null;
  has_remote?: boolean;
  unpushed?: number;
  runtime_running?: boolean;
  runtime_ready?: boolean;
}

interface Props {
  apps: AppEntry[];
  meta: Record<string, Meta>;
  metaBusy: boolean;
  source?: 'apps' | 'skills';
  onOpen: (app: AppEntry) => void;
  onTrack: (app: AppEntry) => Promise<void> | void;
  trackingId: string | null;
  syncing: boolean;
  syncedAt: string | null;
  onSyncRemotes: () => void;
  onBulkDone: (workspaceIds: string[]) => void;
}

/**
 * Dashboard-style landing view. Every app on the account shown at the same
 * scale so the graph feature isn't a hidden dropdown — it's the front door.
 */
const HomeGrid: React.FC<Props> = ({
  apps,
  meta,
  metaBusy,
  source = 'apps',
  onOpen,
  onTrack,
  trackingId,
  syncing,
  syncedAt,
  onSyncRemotes,
  onBulkDone,
}) => {
  const c = useClaudeTokens();
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [sort, setSort] = React.useState<SortKey>('recent');
  const [view, setView] = React.useState<ViewKey>(loadView);

  React.useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* private mode / storage disabled — the toggle still works in-session */
    }
  }, [view]);
  const nounPlural = source === 'skills' ? 'skills' : 'apps';
  const titleWord = source === 'skills' ? 'Your skills' : 'Your apps';

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = apps.filter(a => {
      if (filter === 'tracked' && !(a.has_git && a.workspace_exists)) return false;
      if (filter === 'untracked' && a.has_git) return false;
      if (filter === 'dirty' && !(meta[a.workspace_id]?.dirty_count)) return false;
      if (filter === 'unpushed' && !(meta[a.workspace_id]?.unpushed)) return false;
      if (filter === 'unpublished' && !isUnpublished(a, meta[a.workspace_id])) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q)
      );
    });
    const scored = base.slice();
    // Dirty apps always float first, most-changes-first, no matter which
    // sort is picked — the whole point of Home is "who needs my attention?".
    // Within the dirty group and within the clean group the chosen sort
    // still applies as a secondary key.
    const dirtyCount = (a: AppEntry) => meta[a.workspace_id]?.dirty_count ?? 0;

    let secondary: (a: AppEntry, b: AppEntry) => number;
    if (sort === 'name') {
      secondary = (a, b) => a.name.localeCompare(b.name);
    } else if (sort === 'status') {
      const rank = (a: AppEntry) => {
        if (a.has_git) return 0;
        if (a.workspace_exists) return 1;
        return 2;
      };
      secondary = (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name);
    } else {
      // Recent: prefer HEAD commit date, fall back to updated_at, then name.
      const stamp = (a: AppEntry) => {
        const m = meta[a.workspace_id];
        const iso = m?.head_date ?? a.updated_at ?? '';
        const t = new Date(iso).getTime();
        return Number.isNaN(t) ? 0 : t;
      };
      secondary = (a, b) => stamp(b) - stamp(a) || a.name.localeCompare(b.name);
    }

    scored.sort((a, b) => {
      const da = dirtyCount(a);
      const db = dirtyCount(b);
      const aDirty = da > 0;
      const bDirty = db > 0;
      if (aDirty !== bDirty) return aDirty ? -1 : 1;
      if (aDirty && bDirty && da !== db) return db - da;
      return secondary(a, b);
    });
    return scored;
  }, [apps, meta, filter, sort, query]);

  const counts = React.useMemo(() => {
    let tracked = 0;
    for (const a of apps) {
      if (a.has_git && a.workspace_exists) tracked += 1;
    }
    return { tracked, total: apps.length };
  }, [apps]);

  const dirtyApps = React.useMemo(() => {
    const rows: BulkEntry[] = [];
    for (const a of apps) {
      const m = meta[a.workspace_id];
      if (a.has_git && a.workspace_exists && m?.dirty_count) {
        rows.push({ app: a, count: m.dirty_count, hasRemote: Boolean(m.has_remote) });
      }
    }
    // Most changes first so the "who needs attention" order is obvious.
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [apps, meta]);

  const unpushedApps = React.useMemo(() => {
    const rows: BulkEntry[] = [];
    for (const a of apps) {
      const m = meta[a.workspace_id];
      if (a.has_git && a.workspace_exists && m?.has_remote && m?.unpushed) {
        rows.push({ app: a, count: m.unpushed, hasRemote: true });
      }
    }
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [apps, meta]);

  // Tracked apps that have never been published — no remote at all. Publishing
  // one creates its private repo and pushes every commit, so the count is the
  // whole log rather than an unpushed delta.
  const unpublishedApps = React.useMemo(() => {
    const rows: BulkEntry[] = [];
    for (const a of apps) {
      const m = meta[a.workspace_id];
      if (isUnpublished(a, m)) {
        rows.push({ app: a, count: m?.commit_count ?? 0, hasRemote: false });
      }
    }
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [apps, meta]);

  return (
    <Box sx={{ px: 3, pb: 4 }}>
      <Box sx={{ pt: 3, pb: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box
          sx={{
            ...c.type.title,
            color: c.text.primary,
            letterSpacing: '-0.022em',
            lineHeight: 1.1,
          }}
        >
          {titleWord}
        </Box>

        <StatRow
          apps={apps}
          meta={meta}
          source={source}
          dirtyActive={filter === 'dirty'}
          onFocusDirty={() => setFilter(f => (f === 'dirty' ? 'all' : 'dirty'))}
          unpushedActive={filter === 'unpushed'}
          onFocusUnpushed={() => setFilter(f => (f === 'unpushed' ? 'all' : 'unpushed'))}
          unpublishedActive={filter === 'unpublished'}
          onFocusUnpublished={() =>
            setFilter(f => (f === 'unpublished' ? 'all' : 'unpublished'))
          }
          syncing={syncing}
          syncedAt={syncedAt}
          onSyncRemotes={onSyncRemotes}
        />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              minHeight: 38,
              px: 1.5,
              width: 320,
              maxWidth: '100%',
              ...sunkenField(c),
            }}
          >
            <SearchRoundedIcon sx={{ fontSize: 18, color: c.text.muted, flexShrink: 0 }} />
            <Box
              component="input"
              value={query}
              placeholder={`Search ${nounPlural}`}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              sx={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: c.font.sans,
                ...c.type.body,
                color: c.text.primary,
                '&::placeholder': { color: c.text.tertiary },
              }}
            />
            {query && (
              <Box
                component="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                sx={{
                  display: 'flex',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  p: 0,
                  color: c.text.tertiary,
                  '&:hover': { color: c.text.primary },
                  '& svg': { fontSize: 14 },
                }}
              >
                <CloseRoundedIcon />
              </Box>
            )}
          </Box>

          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: `All · ${counts.total}` },
              { id: 'tracked', label: `Tracked · ${counts.tracked}` },
              { id: 'untracked', label: `Untracked · ${counts.total - counts.tracked}` },
            ]}
          />

          <Box sx={{ flex: 1 }} />

          <Segmented
            value={sort}
            onChange={setSort}
            options={[
              { id: 'recent', label: 'Recent' },
              { id: 'name', label: 'Name' },
              { id: 'status', label: 'Status' },
            ]}
          />

          <Segmented
            value={view}
            onChange={setView}
            options={[
              { id: 'cards', label: 'Cards', icon: <GridViewRoundedIcon sx={{ fontSize: 15 }} /> },
              { id: 'table', label: 'Table', icon: <TableRowsRoundedIcon sx={{ fontSize: 15 }} /> },
            ]}
          />
        </Box>
      </Box>

      {(dirtyApps.length > 0 || unpushedApps.length > 0 || unpublishedApps.length > 0) && (
        <Box sx={{ mb: 2 }}>
          <BulkActionBar
            dirtyApps={dirtyApps}
            unpushedApps={unpushedApps}
            unpublishedApps={unpublishedApps}
            onDone={onBulkDone}
          />
        </Box>
      )}

      {rows.length === 0 ? (
        <Placeholder
          icon={<SearchOffRoundedIcon />}
          title={
            query
              ? `No ${nounPlural} match that`
              : filter === 'dirty'
                ? 'Everything is committed'
                : filter === 'unpushed'
                  ? 'Everything is pushed'
                  : filter === 'unpublished'
                    ? 'Everything is published'
                    : `No ${nounPlural} in this filter`
          }
          hint={
            query
              ? 'Try a shorter term or clear the search.'
              : filter === 'dirty'
                ? 'No workspace has uncommitted changes right now.'
                : filter === 'unpushed'
                  ? `Every tracked ${source === 'skills' ? 'skill' : 'app'} is up to date with its remote.`
                  : filter === 'unpublished'
                    ? `Every tracked ${source === 'skills' ? 'skill' : 'app'} already has a GitHub remote.`
                    : 'Switch filters to see the rest of your workspace.'
          }
        />
      ) : view === 'table' ? (
        <AppTable
          rows={rows}
          meta={meta}
          metaBusy={metaBusy}
          onOpen={onOpen}
          onTrack={onTrack}
          trackingId={trackingId}
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 1.75,
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          }}
        >
          {rows.map(app => (
            <AppCard
              key={app.workspace_id}
              app={app}
              meta={meta[app.workspace_id]}
              loading={metaBusy && meta[app.workspace_id] === undefined}
              onOpen={() => onOpen(app)}
              onTrack={onTrack}
              tracking={trackingId === app.workspace_id}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

const AppCard: React.FC<{
  app: AppEntry;
  meta?: Meta;
  loading: boolean;
  onOpen: () => void;
  onTrack: (app: AppEntry) => Promise<void> | void;
  tracking: boolean;
}> = ({ app, meta, loading, onOpen, onTrack, tracking }) => {
  const c = useClaudeTokens();
  const missing = !app.workspace_exists;
  const tracked = app.has_git && !missing;
  const dirty = meta?.dirty_count ?? 0;
  const commits = meta?.commit_count ?? 0;
  const unpushed = meta?.unpushed ?? 0;
  const needsPublish = isUnpublished(app, meta);

  return (
    <Box
      component="button"
      onClick={onOpen}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        p: 2.5,
        minHeight: 176,
        textAlign: 'left',
        overflow: 'hidden',
        ...card(c, true),
        '&:focus-visible': { outline: 'none', boxShadow: `0 0 0 3px rgba(${c.accentRgb},0.35)` },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <BrandGlyph
            seed={app.workspace_id}
            letter={app.name[0] || '?'}
            size={36}
            iconId={app.workspace_id}
            hasIcon={app.has_icon}
          />
          {meta?.runtime_running && (
            <Box
              title={meta.runtime_ready ? 'Open in OpenSwarm' : 'Starting…'}
              sx={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: meta.runtime_ready ? c.status.success : c.status.warning,
                border: `2px solid ${c.bg.surface}`,
                boxShadow: meta.runtime_ready
                  ? `0 0 0 3px rgba(52,199,89,0.18)`
                  : `0 0 0 3px rgba(255,149,0,0.18)`,
              }}
            />
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            sx={{
              ...c.type.title3,
              color: c.text.primary,
              letterSpacing: '-0.012em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {app.name}
          </Box>
          <Box
            sx={{
              ...c.type.caption,
              color: c.text.tertiary,
              mt: '2px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tracked && meta?.current_branch ? (
              <>
                <CallSplitRoundedIcon sx={{ fontSize: 14 }} />
                <Box component="span" sx={{ fontFamily: c.font.mono }}>
                  {meta.current_branch}
                </Box>
              </>
            ) : missing ? (
              'workspace gone'
            ) : tracked ? (
              'no branch'
            ) : (
              'not tracked'
            )}
          </Box>
        </Box>
        {tracked ? (
          <CheckCircleRoundedIcon
            sx={{ fontSize: 16, color: dirty ? c.status.warning : c.status.success, flexShrink: 0 }}
          />
        ) : null}
      </Box>

      {app.description && (
        <Box
          sx={{
            ...c.type.callout,
            color: c.text.secondary,
            lineHeight: 1.45,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: 34,
          }}
        >
          {app.description}
        </Box>
      )}

      <Box sx={{ flex: 1 }} />

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          minHeight: 22,
        }}
      >
        {loading && !meta ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CircularProgress size={10} sx={{ color: c.text.tertiary }} />
            <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
              Reading graph…
            </Box>
          </Box>
        ) : missing ? (
          <Pill tone="danger">workspace missing</Pill>
        ) : !tracked ? (
          <Pill tone="ghost">not tracked yet</Pill>
        ) : (
          <>
            <Pill>
              <HistoryRoundedIcon />
              {commits.toLocaleString()} commit{commits === 1 ? '' : 's'}
            </Pill>
            {dirty > 0 && (
              <Pill tone="warning">
                <RadioButtonCheckedRoundedIcon />
                {dirty} uncommitted
              </Pill>
            )}
            {unpushed > 0 && (
              <Pill tone="warning">
                <CloudUploadRoundedIcon />
                {unpushed} to push
              </Pill>
            )}
            {needsPublish && (
              <Pill tone="accent">
                <PublishRoundedIcon />
                never published
              </Pill>
            )}
            {meta?.head_date && (
              <Box
                title={absoluteTime(meta.head_date)}
                sx={{
                  ...c.type.caption,
                  color: c.text.tertiary,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <ScheduleRoundedIcon sx={{ fontSize: 14 }} />
                {relativeTime(meta.head_date)}
              </Box>
            )}
          </>
        )}

        <Box sx={{ flex: 1 }} />

        {!tracked && !missing && (
          <Box
            component="span"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              void onTrack(app);
            }}
            sx={{
              ...primaryButton(c),
              minHeight: 30,
              px: 1.5,
            }}
          >
            {tracking ? (
              <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
            ) : (
              'Track'
            )}
          </Box>
        )}
        {tracked && (
          <Box
            component="span"
            sx={{
              ...pushButton(c),
              minHeight: 30,
              px: 1.5,
            }}
          >
            Open
          </Box>
        )}
      </Box>
    </Box>
  );
};

const AppTable: React.FC<{
  rows: AppEntry[];
  meta: Record<string, Meta>;
  metaBusy: boolean;
  onOpen: (app: AppEntry) => void;
  onTrack: (app: AppEntry) => Promise<void> | void;
  trackingId: string | null;
}> = ({ rows, meta, metaBusy, onOpen, onTrack, trackingId }) => {
  const c = useClaudeTokens();

  const headCell = {
    ...c.type.caption,
    fontWeight: 500,
    color: c.text.muted,
    textAlign: 'left' as const,
    px: 1.5,
    py: 1,
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
  };
  const bodyCell = {
    px: 1.5,
    py: 1.25,
    verticalAlign: 'middle' as const,
    borderTop: `1px solid ${c.border.subtle}`,
  };

  return (
    <Box sx={{ ...card(c), overflow: 'hidden' }}>
      <Box sx={{ overflowX: 'auto', ...slimScroll(c) }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <Box component="thead">
            <Box component="tr" sx={{ background: c.bg.secondary }}>
              <Box component="th" sx={headCell}>Name</Box>
              <Box component="th" sx={headCell}>Branch</Box>
              <Box component="th" sx={headCell}>Status</Box>
              <Box component="th" sx={{ ...headCell, textAlign: 'right' }}>Commits</Box>
              <Box component="th" sx={headCell}>Changes</Box>
              <Box component="th" sx={headCell}>Last commit</Box>
              <Box component="th" sx={{ ...headCell, textAlign: 'right' }} />
            </Box>
          </Box>
          <Box component="tbody">
            {rows.map(app => (
              <AppRow
                key={app.workspace_id}
                app={app}
                meta={meta[app.workspace_id]}
                loading={metaBusy && meta[app.workspace_id] === undefined}
                onOpen={() => onOpen(app)}
                onTrack={onTrack}
                tracking={trackingId === app.workspace_id}
                bodyCell={bodyCell}
              />
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

const AppRow: React.FC<{
  app: AppEntry;
  meta?: Meta;
  loading: boolean;
  onOpen: () => void;
  onTrack: (app: AppEntry) => Promise<void> | void;
  tracking: boolean;
  bodyCell: Record<string, unknown>;
}> = ({ app, meta, loading, onOpen, onTrack, tracking, bodyCell }) => {
  const c = useClaudeTokens();
  const missing = !app.workspace_exists;
  const tracked = app.has_git && !missing;
  const dirty = meta?.dirty_count ?? 0;
  const commits = meta?.commit_count ?? 0;
  const unpushed = meta?.unpushed ?? 0;
  const needsPublish = isUnpublished(app, meta);

  return (
    <Box
      component="tr"
      onClick={onOpen}
      sx={{
        cursor: 'pointer',
        transition: c.transition,
        '&:hover': { background: c.bg.secondary },
        '&:focus-visible': { outline: 'none', background: `rgba(${c.accentRgb},0.06)` },
      }}
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <Box component="td" sx={bodyCell}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box sx={{ position: 'relative', flexShrink: 0 }}>
            <BrandGlyph
              seed={app.workspace_id}
              letter={app.name[0] || '?'}
              size={28}
              iconId={app.workspace_id}
              hasIcon={app.has_icon}
            />
            {meta?.runtime_running && (
              <Box
                title={meta.runtime_ready ? 'Open in OpenSwarm' : 'Starting…'}
                sx={{
                  position: 'absolute',
                  right: -2,
                  bottom: -2,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: meta.runtime_ready ? c.status.success : c.status.warning,
                  border: `2px solid ${c.bg.surface}`,
                }}
              />
            )}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Box
              sx={{
                ...c.type.body,
                fontWeight: 500,
                color: c.text.primary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 220,
              }}
            >
              {app.name}
            </Box>
            {app.description && (
              <Box
                sx={{
                  ...c.type.caption,
                  color: c.text.tertiary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 260,
                }}
              >
                {app.description}
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      <Box component="td" sx={bodyCell}>
        {tracked && meta?.current_branch ? (
          <Box
            component="span"
            sx={{
              ...c.type.caption,
              fontFamily: c.font.mono,
              color: c.text.secondary,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <CallSplitRoundedIcon sx={{ fontSize: 13, color: c.text.tertiary }} />
            {meta.current_branch}
          </Box>
        ) : (
          <Box component="span" sx={{ ...c.type.caption, color: c.text.tertiary }}>
            —
          </Box>
        )}
      </Box>

      <Box component="td" sx={bodyCell}>
        {loading && !meta ? (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <CircularProgress size={10} sx={{ color: c.text.tertiary }} />
            <Box component="span" sx={{ ...c.type.caption, color: c.text.tertiary }}>
              Reading…
            </Box>
          </Box>
        ) : missing ? (
          <Pill tone="danger">missing</Pill>
        ) : !tracked ? (
          <Pill tone="ghost">not tracked</Pill>
        ) : dirty > 0 ? (
          <Pill tone="warning">
            <RadioButtonCheckedRoundedIcon />
            uncommitted
          </Pill>
        ) : needsPublish ? (
          <Pill tone="accent">
            <PublishRoundedIcon />
            unpublished
          </Pill>
        ) : (
          <Pill tone="success">
            <CheckCircleRoundedIcon />
            clean
          </Pill>
        )}
      </Box>

      <Box component="td" sx={{ ...bodyCell, textAlign: 'right' }}>
        <Box
          component="span"
          sx={{ ...c.type.body, fontVariantNumeric: 'tabular-nums', color: tracked ? c.text.primary : c.text.tertiary }}
        >
          {tracked ? commits.toLocaleString() : '—'}
        </Box>
      </Box>

      <Box component="td" sx={bodyCell}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {dirty > 0 && (
            <Pill tone="warning">
              <RadioButtonCheckedRoundedIcon />
              {dirty}
            </Pill>
          )}
          {unpushed > 0 && (
            <Pill tone="warning">
              <CloudUploadRoundedIcon />
              {unpushed}
            </Pill>
          )}
          {tracked && dirty === 0 && unpushed === 0 && (
            <Box component="span" sx={{ ...c.type.caption, color: c.text.tertiary }}>
              —
            </Box>
          )}
        </Box>
      </Box>

      <Box component="td" sx={bodyCell}>
        {tracked && meta?.head_date ? (
          <Box
            title={absoluteTime(meta.head_date)}
            sx={{
              ...c.type.caption,
              color: c.text.tertiary,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
            }}
          >
            <ScheduleRoundedIcon sx={{ fontSize: 13 }} />
            {relativeTime(meta.head_date)}
          </Box>
        ) : (
          <Box component="span" sx={{ ...c.type.caption, color: c.text.tertiary }}>
            —
          </Box>
        )}
      </Box>

      <Box component="td" sx={{ ...bodyCell, textAlign: 'right' }}>
        {!tracked && !missing ? (
          <Box
            component="span"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              void onTrack(app);
            }}
            sx={{ ...primaryButton(c), minHeight: 28, px: 1.5 }}
          >
            {tracking ? <CircularProgress size={12} sx={{ color: '#FFFFFF' }} /> : 'Track'}
          </Box>
        ) : tracked ? (
          <Box component="span" sx={{ ...pushButton(c), minHeight: 28, px: 1.5 }}>
            Open
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  const c = useClaudeTokens();
  return (
    <Box sx={{ display: 'flex', gap: '2px', p: '3px', ...sunkenField(c), flexShrink: 0, minHeight: 38 }}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <Box
            component="button"
            key={o.id}
            onClick={() => onChange(o.id)}
            sx={{
              px: 1.75,
              border: 'none',
              cursor: 'pointer',
              borderRadius: `${c.radius.xs}px`,
              fontFamily: c.font.sans,
              ...c.type.body,
              color: on ? c.text.primary : c.text.muted,
              background: on ? c.bg.surface : 'transparent',
              boxShadow: on ? c.shadow.sm : 'none',
              transition: c.transition,
              whiteSpace: 'nowrap',
              display: 'inline-grid',
              alignItems: 'center',
              justifyItems: 'center',
              '&:hover': { color: c.text.primary },
              // Reserve the bold width up front so the row doesn't reflow
              // when the active item's weight changes.
              '&::before': {
                content: `"${o.label}"`,
                gridArea: '1 / 1',
                fontWeight: 500,
                visibility: 'hidden',
                pointerEvents: 'none',
                paddingLeft: o.icon ? '21px' : 0,
              },
            }}
          >
            <Box
              component="span"
              sx={{
                gridArea: '1 / 1',
                fontWeight: on ? 500 : 400,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {o.icon}
              {o.label}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default HomeGrid;
