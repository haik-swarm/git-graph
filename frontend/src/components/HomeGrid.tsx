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
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { card, pushButton, segmentItem, segmentTrack, slimScroll, statusDot, sunkenField } from '@/shared/styles/ui';
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
  // Home decides its own kind now that the rail no longer dictates source.
  const [kind, setKind] = React.useState<'all' | 'apps' | 'skills'>('all');

  React.useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* private mode / storage disabled — the toggle still works in-session */
    }
  }, [view]);
  const nounPlural = kind === 'skills' ? 'skills' : kind === 'apps' ? 'apps' : 'items';
  const nounSingular = kind === 'skills' ? 'skill' : kind === 'apps' ? 'app' : 'item';
  const titleWord =
    kind === 'skills' ? 'Your skills' : kind === 'apps' ? 'Your apps' : 'Your workspace';

  // The headline stat cards read from whatever the kind toggle has selected,
  // so switching Apps/Skills visibly moves the big numbers at the top of the
  // page and not just the cards below the fold.
  const kindApps = React.useMemo(() => {
    if (kind === 'all') return apps;
    const wantKind = kind === 'apps' ? 'app' : 'skill';
    return apps.filter(a => a.kind === wantKind);
  }, [apps, kind]);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const wantKind = kind === 'apps' ? 'app' : 'skill';
    const base = apps.filter(a => {
      if (kind !== 'all' && a.kind !== wantKind) return false;
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
  }, [apps, meta, filter, sort, query, kind]);

  const counts = React.useMemo(() => {
    const wantKind = kind === 'apps' ? 'app' : 'skill';
    let tracked = 0;
    let total = 0;
    for (const a of apps) {
      if (kind !== 'all' && a.kind !== wantKind) continue;
      total += 1;
      if (a.has_git && a.workspace_exists) tracked += 1;
    }
    return { tracked, total };
  }, [apps, kind]);

  // Per-kind totals for the kind toggle labels, so switching is visibly a
  // filter and not cosmetic even when the changed cards sit below the fold.
  const kindCounts = React.useMemo(() => {
    let appCount = 0;
    let skillCount = 0;
    for (const a of apps) {
      if (a.kind === 'skill') skillCount += 1;
      else appCount += 1;
    }
    return { all: apps.length, apps: appCount, skills: skillCount };
  }, [apps]);

  const dirtyApps = React.useMemo(() => {
    const rows: BulkEntry[] = [];
    for (const a of kindApps) {
      const m = meta[a.workspace_id];
      if (a.has_git && a.workspace_exists && m?.dirty_count) {
        rows.push({ app: a, count: m.dirty_count, hasRemote: Boolean(m.has_remote) });
      }
    }
    // Most changes first so the "who needs attention" order is obvious.
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [kindApps, meta]);

  const unpushedApps = React.useMemo(() => {
    const rows: BulkEntry[] = [];
    for (const a of kindApps) {
      const m = meta[a.workspace_id];
      if (a.has_git && a.workspace_exists && m?.has_remote && m?.unpushed) {
        rows.push({ app: a, count: m.unpushed, hasRemote: true });
      }
    }
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [kindApps, meta]);

  // Tracked apps that have never been published — no remote at all. Publishing
  // one creates its private repo and pushes every commit, so the count is the
  // whole log rather than an unpushed delta.
  const unpublishedApps = React.useMemo(() => {
    const rows: BulkEntry[] = [];
    for (const a of kindApps) {
      const m = meta[a.workspace_id];
      if (isUnpublished(a, m)) {
        rows.push({ app: a, count: m?.commit_count ?? 0, hasRemote: false });
      }
    }
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [kindApps, meta]);

  return (
    <Box sx={{ px: 3, pb: 5, maxWidth: 1360, mx: 'auto' }}>
      <Box sx={{ pt: 3, pb: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Box
            sx={{
              ...c.type.title2,
              color: c.text.primary,
              lineHeight: 1.2,
            }}
          >
            {titleWord}
          </Box>
          <Box sx={{ ...c.type.callout, color: c.text.muted, fontVariantNumeric: 'tabular-nums' }}>
            {rows.length.toLocaleString()} shown
          </Box>
        </Box>

        <StatRow
          apps={kindApps}
          meta={meta}
          noun={nounSingular}
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
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { id: 'all', label: 'All', count: kindCounts.all },
              { id: 'apps', label: 'Apps', count: kindCounts.apps },
              { id: 'skills', label: 'Skills', count: kindCounts.skills },
            ]}
          />

          <Box sx={{ width: '1px', height: 16, background: c.border.medium, mx: 0.25 }} />

          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'Any status', count: counts.total },
              { id: 'tracked', label: 'Tracked', count: counts.tracked },
              { id: 'untracked', label: 'Untracked', count: counts.total - counts.tracked },
            ]}
          />

          <Box sx={{ flex: 1 }} />

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: 28,
              px: 1,
              flex: '0 1 200px',
              minWidth: 120,
              ...sunkenField(c),
            }}
          >
            <SearchRoundedIcon sx={{ fontSize: 15, color: c.text.muted, flexShrink: 0 }} />
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
                ...c.type.callout,
                color: c.text.primary,
                '&::placeholder': { color: c.text.muted },
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
              { id: 'cards', label: '', title: 'Cards', icon: <GridViewRoundedIcon sx={{ fontSize: 14 }} /> },
              { id: 'table', label: '', title: 'Table', icon: <TableRowsRoundedIcon sx={{ fontSize: 14 }} /> },
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
            noun={nounSingular}
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
                  ? `Every tracked ${nounSingular} is up to date with its remote.`
                  : filter === 'unpublished'
                    ? `Every tracked ${nounSingular} already has a GitHub remote.`
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
            gap: 1.25,
            gridTemplateColumns: 'repeat(auto-fill, minmax(272px, 1fr))',
          }}
        >
          {rows.map(app => (
            <AppCard
              key={app.id}
              app={app}
              meta={meta[app.workspace_id]}
              loading={metaBusy && meta[app.workspace_id] === undefined}
              onOpen={() => onOpen(app)}
              onTrack={onTrack}
              tracking={trackingId === (app.is_flat ? app.id : app.workspace_id)}
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
  const flat = Boolean(app.is_flat);
  const missing = !app.workspace_exists && !flat;
  const tracked = app.has_git && !missing && !flat;
  const dirty = meta?.dirty_count ?? 0;
  const commits = meta?.commit_count ?? 0;
  const unpushed = meta?.unpushed ?? 0;
  const needsPublish = isUnpublished(app, meta);

  const sep = <Box component="span" sx={{ color: c.text.ghost }}>·</Box>;

  return (
    <Box
      component="button"
      onClick={onOpen}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        p: 1.75,
        minHeight: 148,
        textAlign: 'left',
        overflow: 'hidden',
        fontFamily: c.font.sans,
        ...card(c, true),
        '&:hover': { borderColor: c.border.strong, boxShadow: c.shadow.md, '& .gg-open': { opacity: 1 } },
        '&:focus-visible': { outline: 'none', boxShadow: `0 0 0 3px rgba(${c.focusRgb},0.35)` },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <BrandGlyph
            seed={app.workspace_id}
            letter={app.name[0] || '?'}
            size={30}
            iconId={app.workspace_id}
            hasIcon={app.has_icon}
          />
          {meta?.runtime_running && (
            <Box
              title={meta.runtime_ready ? 'Running in OpenSwarm' : 'Starting…'}
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
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            sx={{
              ...c.type.headline,
              fontWeight: 600,
              color: c.text.primary,
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
              color: c.text.muted,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {tracked && meta?.current_branch ? (
              <>
                <CallSplitRoundedIcon sx={{ fontSize: 12 }} />
                <Box component="span" sx={{ fontFamily: c.font.mono, fontSize: '0.6875rem' }}>
                  {meta.current_branch}
                </Box>
              </>
            ) : missing ? (
              'workspace gone'
            ) : tracked ? (
              'no branch'
            ) : flat ? (
              'single file'
            ) : (
              'not tracked'
            )}
          </Box>
        </Box>
        {!tracked && !missing && !flat ? (
          <Box
            component="span"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              void onTrack(app);
            }}
            sx={{ ...pushButton(c), minHeight: 24, px: 1, ...c.type.caption, fontWeight: 500 }}
          >
            {tracking ? <CircularProgress size={11} sx={{ color: c.text.tertiary }} /> : 'Track'}
          </Box>
        ) : (
          <Box
            className="gg-open"
            sx={{
              opacity: 0,
              transition: c.transition,
              color: c.text.muted,
              display: 'flex',
              '& svg': { fontSize: 16 },
            }}
          >
            <ChevronRightRoundedIcon />
          </Box>
        )}
      </Box>

      <Box
        sx={{
          ...c.type.callout,
          color: app.description ? c.text.tertiary : c.text.ghost,
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: 37,
        }}
      >
        {app.description || 'No description'}
      </Box>

      <Box sx={{ flex: 1 }} />

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          pt: 1.25,
          borderTop: `1px solid ${c.border.subtle}`,
          ...c.type.caption,
          color: c.text.tertiary,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          minHeight: 18,
        }}
      >
        {loading && !meta ? (
          <>
            <CircularProgress size={9} sx={{ color: c.text.muted }} />
            Reading graph…
          </>
        ) : missing ? (
          <>
            <Box sx={statusDot(c.status.error)} />
            Workspace missing
          </>
        ) : !tracked ? (
          <Box component="span" sx={{ color: c.text.muted }}>
            {flat ? 'No history for single files' : 'No history yet'}
          </Box>
        ) : (
          <>
            <Box
              title={dirty ? `${dirty} uncommitted` : needsPublish ? 'Never published' : 'Clean'}
              sx={statusDot(
                dirty || unpushed ? c.status.warning : needsPublish ? c.text.muted : c.status.success,
              )}
            />
            <span>
              {commits.toLocaleString()} commit{commits === 1 ? '' : 's'}
            </span>
            {dirty > 0 && (
              <>
                {sep}
                <Box component="span" sx={{ color: c.text.secondary }}>{dirty} changed</Box>
              </>
            )}
            {unpushed > 0 && (
              <>
                {sep}
                <Box component="span" sx={{ color: c.text.secondary }}>{unpushed} to push</Box>
              </>
            )}
            {needsPublish && (
              <>
                {sep}
                <span>local only</span>
              </>
            )}
            <Box sx={{ flex: 1 }} />
            {meta?.head_date && (
              <Box component="span" title={absoluteTime(meta.head_date)} sx={{ color: c.text.muted }}>
                {relativeTime(meta.head_date)}
              </Box>
            )}
          </>
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
    py: '7px',
    borderBottom: `1px solid ${c.border.subtle}`,
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
  };
  const bodyCell = {
    px: 1.5,
    py: '7px',
    verticalAlign: 'middle' as const,
    borderTop: `1px solid ${c.border.subtle}`,
  };

  return (
    <Box sx={{ ...card(c), overflow: 'hidden' }}>
      <Box sx={{ overflowX: 'auto', ...slimScroll(c) }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={headCell}>Name</Box>
              <Box component="th" sx={headCell}>Branch</Box>
              <Box component="th" sx={headCell}>Status</Box>
              <Box component="th" sx={{ ...headCell, textAlign: 'right' }}>Commits</Box>
              <Box component="th" sx={headCell}>Changes</Box>
              <Box component="th" sx={headCell}>Last commit</Box>
              <Box component="th" sx={{ ...headCell, textAlign: 'right' }} />
            </Box>
          </Box>
          <Box component="tbody" sx={{ '& tr:first-of-type td': { borderTop: 'none' } }}>
            {rows.map(app => (
              <AppRow
                key={app.id}
                app={app}
                meta={meta[app.workspace_id]}
                loading={metaBusy && meta[app.workspace_id] === undefined}
                onOpen={() => onOpen(app)}
                onTrack={onTrack}
                tracking={trackingId === (app.is_flat ? app.id : app.workspace_id)}
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
  const flat = Boolean(app.is_flat);
  const missing = !app.workspace_exists && !flat;
  const tracked = app.has_git && !missing && !flat;
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
        '&:focus-visible': { outline: 'none', background: c.bg.secondary },
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
              size={22}
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
        ) : flat ? (
          <Pill tone="ghost">single file</Pill>
        ) : missing ? (
          <Pill tone="danger">missing</Pill>
        ) : !tracked ? (
          <Pill tone="ghost">not tracked</Pill>
        ) : (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', ...c.type.caption, color: c.text.secondary }}>
            <Box sx={statusDot(dirty > 0 ? c.status.warning : needsPublish ? c.text.muted : c.status.success)} />
            {dirty > 0 ? 'Uncommitted' : needsPublish ? 'Local only' : 'Clean'}
          </Box>
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
            <Pill>
              <RadioButtonCheckedRoundedIcon />
              {dirty}
            </Pill>
          )}
          {unpushed > 0 && (
            <Pill>
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
            sx={{ ...pushButton(c), minHeight: 24, px: 1, ...c.type.caption, fontWeight: 500 }}
          >
            {tracking ? <CircularProgress size={11} sx={{ color: c.text.tertiary }} /> : 'Track'}
          </Box>
        ) : tracked ? (
          <ChevronRightRoundedIcon sx={{ fontSize: 16, color: c.text.muted, verticalAlign: 'middle' }} />
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
  options: { id: T; label: string; icon?: React.ReactNode; count?: number; title?: string }[];
  onChange: (v: T) => void;
}) {
  const c = useClaudeTokens();
  return (
    <Box sx={{ ...segmentTrack(c), flexShrink: 0 }}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <Box
            component="button"
            key={o.id}
            title={o.title}
            aria-label={o.title ?? o.label}
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            sx={{ ...segmentItem(c, on), ...(o.label ? {} : { px: '6px' }) }}
          >
            {o.icon}
            {o.label}
            {o.count !== undefined && (
              <Box
                component="span"
                sx={{ color: on ? c.text.tertiary : c.text.muted, fontVariantNumeric: 'tabular-nums', fontWeight: 400 }}
              >
                {o.count}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export default HomeGrid;
