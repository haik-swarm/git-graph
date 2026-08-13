import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { primaryButton, pushButton, sunkenField } from '@/shared/styles/ui';
import { BrandGlyph, Pill, Placeholder } from '@/components/Chrome';
import BulkActionBar from '@/components/BulkActionBar';
import { relativeTime } from '@/shared/graphLayout';
import type { AppEntry } from '@/components/AppPicker';

type SortKey = 'recent' | 'name' | 'status';
type FilterKey = 'all' | 'tracked' | 'untracked';

interface Meta {
  is_repo: boolean;
  commit_count: number;
  dirty_count: number;
  current_branch: string | null;
  head_subject: string | null;
  head_date: string | null;
}

interface Props {
  apps: AppEntry[];
  meta: Record<string, Meta>;
  metaBusy: boolean;
  onOpen: (app: AppEntry) => void;
  onTrack: (app: AppEntry) => Promise<void> | void;
  trackingId: string | null;
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
  onBulkDone,
}) => {
  const c = useClaudeTokens();
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [sort, setSort] = React.useState<SortKey>('recent');

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = apps.filter(a => {
      if (filter === 'tracked' && !(a.has_git && a.workspace_exists)) return false;
      if (filter === 'untracked' && a.has_git) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q)
      );
    });
    const scored = base.slice();
    if (sort === 'name') {
      scored.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'status') {
      const rank = (a: AppEntry) => {
        const m = meta[a.workspace_id];
        if (m?.dirty_count) return 0;
        if (a.has_git) return 1;
        if (a.workspace_exists) return 2;
        return 3;
      };
      scored.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    } else {
      // Recent: prefer HEAD commit date, fall back to updated_at, then name.
      const stamp = (a: AppEntry) => {
        const m = meta[a.workspace_id];
        const iso = m?.head_date ?? a.updated_at ?? '';
        const t = new Date(iso).getTime();
        return Number.isNaN(t) ? 0 : t;
      };
      scored.sort((a, b) => stamp(b) - stamp(a) || a.name.localeCompare(b.name));
    }
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
    const rows: { app: AppEntry; dirtyCount: number }[] = [];
    for (const a of apps) {
      const m = meta[a.workspace_id];
      if (a.has_git && a.workspace_exists && m?.dirty_count) {
        rows.push({ app: a, dirtyCount: m.dirty_count });
      }
    }
    // Most changes first so the "who needs attention" order is obvious.
    rows.sort((a, b) => b.dirtyCount - a.dirtyCount);
    return rows;
  }, [apps, meta]);

  return (
    <Box sx={{ px: 3, pb: 4 }}>
      <Box sx={{ pt: 3, pb: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Box
            sx={{
              ...c.type.title,
              color: c.text.primary,
              letterSpacing: '-0.022em',
              lineHeight: 1.1,
            }}
          >
            Your apps
          </Box>
          <Box
            sx={{
              ...c.type.callout,
              color: c.text.secondary,
              mt: '4px',
              maxWidth: 640,
              lineHeight: 1.5,
            }}
          >
            Every workspace on your dashboard, at a glance. Pick one to open its
            commit history, or track a fresh app straight from the card.
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: 30,
              px: '10px',
              width: 300,
              maxWidth: '100%',
              ...sunkenField(c),
              '&:focus-within': { boxShadow: c.accent.ring },
            }}
          >
            <SearchRoundedIcon sx={{ fontSize: 14, color: c.text.tertiary, flexShrink: 0 }} />
            <Box
              component="input"
              value={query}
              placeholder="Search apps"
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
                  '& svg': { fontSize: 13 },
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
        </Box>
      </Box>

      {dirtyApps.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <BulkActionBar dirtyApps={dirtyApps} onDone={onBulkDone} />
        </Box>
      )}

      {rows.length === 0 ? (
        <Placeholder
          icon={<SearchOffRoundedIcon />}
          title={query ? 'No apps match that' : 'No apps in this filter'}
          hint={query ? 'Try a shorter term or clear the search.' : 'Switch filters to see the rest of your workspace.'}
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

  return (
    <Box
      component="button"
      onClick={onOpen}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        p: 2,
        minHeight: 176,
        textAlign: 'left',
        cursor: 'pointer',
        background: c.bg.raised,
        border: `0.5px solid ${c.border}`,
        borderRadius: `${c.radius.xl}px`,
        boxShadow: c.shadow.control,
        transition: c.transition,
        overflow: 'hidden',
        '&:hover': {
          borderColor: c.accent.edge,
          transform: 'translateY(-1px)',
          boxShadow: `0 4px 14px rgba(0,0,0,${c.isDark ? 0.32 : 0.08}), 0 0 0 0.5px ${c.accent.edge}`,
        },
        '&:focus-visible': { outline: 'none', boxShadow: c.accent.ring },
        // Signature stripe on tracked cards keeps the grid legible without
        // needing a status pill on every tile.
        '&::before': tracked
          ? {
              content: '""',
              position: 'absolute',
              inset: 0,
              width: 3,
              background: dirty ? c.status.warning : c.accent.base,
              opacity: dirty ? 0.9 : 0.55,
            }
          : undefined,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        <BrandGlyph seed={app.workspace_id} letter={app.name[0] || '?'} size={36} />
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
                <CallSplitRoundedIcon sx={{ fontSize: 11 }} />
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
            {meta?.head_date && (
              <Box
                sx={{
                  ...c.type.caption,
                  color: c.text.tertiary,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <ScheduleRoundedIcon sx={{ fontSize: 11 }} />
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
              height: 26,
              px: '12px',
              fontSize: '11px',
            }}
          >
            {tracking ? (
              <CircularProgress size={10} sx={{ color: c.text.onAccent }} />
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
              height: 26,
              px: '10px',
              fontSize: '11px',
              color: c.text.secondary,
            }}
          >
            Open →
          </Box>
        )}
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
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const c = useClaudeTokens();
  return (
    <Box sx={{ display: 'flex', gap: '2px', p: '2px', ...sunkenField(c), flexShrink: 0, height: 30 }}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <Box
            component="button"
            key={o.id}
            onClick={() => onChange(o.id)}
            sx={{
              height: 24,
              px: '11px',
              border: 'none',
              cursor: 'pointer',
              borderRadius: `${c.radius.xs}px`,
              fontFamily: c.font.sans,
              ...c.type.callout,
              color: on ? c.text.primary : c.text.secondary,
              background: on ? c.bg.controlRaised : 'transparent',
              boxShadow: on ? c.shadow.control : 'none',
              transition: c.transition,
              whiteSpace: 'nowrap',
              display: 'inline-grid',
              alignItems: 'center',
              justifyItems: 'center',
              '&:hover': { color: c.text.primary },
              '&::before': {
                content: `"${o.label}"`,
                gridArea: '1 / 1',
                fontWeight: 600,
                visibility: 'hidden',
                pointerEvents: 'none',
              },
            }}
          >
            <Box
              component="span"
              sx={{ gridArea: '1 / 1', fontWeight: on ? 600 : 450 }}
            >
              {o.label}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default HomeGrid;
