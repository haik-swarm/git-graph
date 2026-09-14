import React, { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WebAssetRoundedIcon from '@mui/icons-material/WebAssetRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { skeleton, slimScroll, sunkenField } from '@/shared/styles/ui';
import { BrandGlyph, RailLabel } from '@/components/Chrome';
import { gitgraphInitUrl } from '@/shared/state/API_ENDPOINTS';
import type { AppEntry } from '@/components/AppPicker';

export interface Sharing {
  /** False when the sweep couldn't read this repo; don't file it as private. */
  known: boolean;
  shared: boolean;
  owner: string | null;
  /** Someone else owns the repo and let this account in. */
  theirs: boolean;
  people: string[];
  pending: number;
}

/** Outstanding local git work on an app: what a commit or a push would clear. */
export interface RepoState {
  dirty: number;
  unpushed: number;
  /** Tracked with commits but no remote yet — never published. */
  needsPublish?: boolean;
}

/** The latest shipped GitHub Release for an app, shown as a rail version tag. */
export interface Release {
  version: string;
  url: string | null;
}

/** How much the rail is allowed to claim about who can see each app. */
export type SharingPhase =
  /** Sweep still in flight: grouping is unknown, so it isn't drawn yet. */
  | 'loading'
  /** Answers are in; Private and Shared are real. */
  | 'ready'
  /** No GitHub, or the sweep failed. Sharing is unknowable, so don't guess. */
  | 'unavailable';

/** The rail's display-only filter over the merged apps+skills list. */
type RailKind = 'all' | 'apps' | 'skills';

const RAIL_KIND_KEY = 'gitgraph.railKind';

const RAIL_KINDS: RailKind[] = ['all', 'apps', 'skills'];

const RAIL_KIND_LABEL: Record<RailKind, string> = {
  all: 'All',
  apps: 'Apps',
  skills: 'Skills',
};

/** One line of the rail's indicator legend: the exact glyph, then its meaning. */
const LegendItem: React.FC<{ glyph: React.ReactNode; label: string }> = ({ glyph, label }) => {
  const c = useClaudeTokens();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <Box
        sx={{
          width: 18,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: c.text.secondary,
        }}
      >
        {glyph}
      </Box>
      <Box sx={{ ...c.type.caption, color: c.text.secondary }}>{label}</Box>
    </Box>
  );
};

interface Props {
  apps: AppEntry[];
  selected: AppEntry | null;
  homeActive: boolean;
  releasesActive: boolean;
  settingsActive: boolean;
  onReleases: () => void;
  onSettings: () => void;
  onHome: () => void;
  onSelect: (app: AppEntry) => void;
  onTracked: (app: AppEntry) => void;
  runningIds?: Set<string>;
  sharing?: Record<string, Sharing>;
  sharingPhase?: SharingPhase;
  repoState?: Record<string, RepoState>;
  releases?: Record<string, Release>;
}

/**
 * Persistent left rail listing every workspace on the dashboard. Tracked
 * repos split by who can see them, Shared above Private, since "who else
 * is in this" is the thing you want to know before you touch an app.
 * Untracked ones sit in a quieter group with a hover "Track" pill so a new
 * repo is one click away without opening a picker.
 *
 * Apps carrying uncommitted or unpushed work show a count badge and sort to
 * the top of their own group. They are deliberately NOT collected into a
 * separate "needs attention" section: which group an app lives in is a
 * stable fact the user navigates by, and having work pending is a temporary
 * state that shouldn't move an app out from under them.
 *
 * Only GitHub knows who an app is shared with, so that split can't be
 * computed locally. Rather than open on a guess and reshuffle when the
 * answer lands, the tracked section shows placeholders until the sweep
 * finishes: a rail that briefly calls a shared app private is worse than
 * a rail that admits it doesn't know yet. The work badges are exempt from
 * that gate — they're read from local git, so they're already true when the
 * rail first paints and don't need to wait on the network.
 */
const AppRail: React.FC<Props> = ({
  apps,
  selected,
  homeActive,
  releasesActive,
  settingsActive,
  onReleases,
  onSettings,
  onHome,
  onSelect,
  onTracked,
  runningIds,
  sharing,
  sharingPhase = 'ready',
  repoState,
  releases,
}) => {
  const c = useClaudeTokens();
  // Display-only filter. The rail no longer drives a global source — both apps
  // and skills are always loaded, and this just narrows what the rail shows.
  const [railKind, setRailKind] = useState<RailKind>(() => {
    try {
      const saved = localStorage.getItem(RAIL_KIND_KEY);
      return saved === 'apps' || saved === 'skills' ? saved : 'all';
    } catch {
      return 'all';
    }
  });
  const [query, setQuery] = useState('');
  const [kindAnchor, setKindAnchor] = useState<HTMLElement | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KIND_KEY, railKind);
    } catch {
      /* private mode / storage disabled — the toggle still works in-session */
    }
  }, [railKind]);

  const { tracked, privateApps, sharedApps, untracked } = useMemo(() => {
    // Narrow to the selected kind first; search and grouping run over the
    // result. 'all' keeps the merged list untouched. The control is plural
    // ('apps'/'skills') while an entry's kind is singular, so map across.
    const wantKind = railKind === 'apps' ? 'app' : 'skill';
    const kindFiltered =
      railKind === 'all' ? apps : apps.filter(a => a.kind === wantKind);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? kindFiltered.filter(a => a.name.toLowerCase().includes(q))
      : kindFiltered;
    const trackedApps = filtered.filter(a => a.has_git && a.workspace_exists);

    /**
     * Float the apps with outstanding work to the top. Urgency is the primary
     * key: uncommitted outranks unpushed (committing is what makes work
     * recoverable; pushing only moves work that is already safe), which
     * outranks clean. Within a single urgency tier we group by kind so apps
     * and skills stay together even under the 'all' filter, and within a kind
     * the larger pile of pending work sorts first.
     */
    const urgencyRank = (id: string) => {
      const s = repoState?.[id];
      if ((s?.dirty ?? 0) > 0) return 0;
      if ((s?.unpushed ?? 0) > 0) return 1;
      return 2;
    };
    const kindRank = (k: AppEntry['kind']) => (k === 'skill' ? 1 : 0);
    const byUrgency = (list: AppEntry[]) =>
      list.slice().sort((a, b) => {
        const sa = repoState?.[a.workspace_id];
        const sb = repoState?.[b.workspace_id];
        return (
          urgencyRank(a.workspace_id) - urgencyRank(b.workspace_id) ||
          kindRank(a.kind) - kindRank(b.kind) ||
          (sb?.dirty ?? 0) - (sa?.dirty ?? 0) ||
          (sb?.unpushed ?? 0) - (sa?.unpushed ?? 0) ||
          0
        );
      });

    return {
      tracked: byUrgency(trackedApps),
      privateApps: byUrgency(trackedApps.filter(a => !sharing?.[a.workspace_id]?.shared)),
      sharedApps: byUrgency(trackedApps.filter(a => sharing?.[a.workspace_id]?.shared)),
      untracked: filtered.filter(a => !a.has_git || !a.workspace_exists),
    };
  }, [apps, query, sharing, repoState, railKind]);

  const track = async (app: AppEntry) => {
    setTrackingId(app.workspace_id);
    setTrackError(null);
    try {
      const res = await fetch(gitgraphInitUrl(app.workspace_id), { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || `init ${res.status}`);
      }
      onTracked(app);
    } catch (err) {
      setTrackError(err instanceof Error ? err.message : "We couldn't track that app.");
    } finally {
      setTrackingId(null);
    }
  };

  return (
    <>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: '6px', pt: '10px', pb: '10px', ...slimScroll(c) }}>
        <Box
          component="button"
          onClick={onHome}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            width: '100%',
            height: 32,
            px: '8px',
            mb: '4px',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            borderRadius: `${c.radius.sm}px`,
            background: homeActive ? `rgba(${c.accentRgb},0.10)` : 'transparent',
            color: c.text.primary,
            transition: 'background 100ms linear',
            '&:hover': { background: homeActive ? `rgba(${c.accentRgb},0.10)` : c.bg.secondary },
          }}
        >
          <Box
            sx={{
              width: 20,
              height: 20,
              flexShrink: 0,
              borderRadius: `${c.radius.sm}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: homeActive ? c.accent.primary : c.text.tertiary,
              background: homeActive ? `rgba(${c.accentRgb},0.10)` : 'transparent',
            }}
          >
            <GridViewRoundedIcon sx={{ fontSize: 14 }} />
          </Box>
          <Box
            sx={{
              flex: 1,
              ...c.type.body,
              fontWeight: homeActive ? 590 : 400,
              color: c.text.primary,
            }}
          >
            Home
          </Box>
        </Box>

        <Box sx={{ px: '2px', mb: '4px' }}>
          <NavRow
            icon={<LocalOfferRoundedIcon sx={{ fontSize: 15 }} />}
            label="Releases"
            active={releasesActive}
            onClick={onReleases}
          />
        </Box>

        <Box sx={{ px: '2px', mb: '4px' }}>
          <NavRow
            icon={<SettingsRoundedIcon sx={{ fontSize: 15 }} />}
            label="Settings"
            active={settingsActive}
            onClick={onSettings}
          />
        </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          px: '6px',
          pt: '40px',
          pb: '0px',
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            height: 26,
            px: '8px',
            ...sunkenField(c),
            '&:focus-within': { boxShadow: `0 0 0 3px rgba(${c.accentRgb},0.35)` },
          }}
        >
          <SearchRoundedIcon sx={{ fontSize: 14, color: c.text.tertiary, flexShrink: 0 }} />
          <Box
            component="input"
            value={query}
            placeholder={
              railKind === 'skills'
                ? 'Filter skills'
                : railKind === 'apps'
                  ? 'Filter apps'
                  : 'Filter'
            }
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
              '&::placeholder': { color: c.text.tertiary },
            }}
          />
          {query && (
            <Box
              component="button"
              onClick={() => setQuery('')}
              aria-label="Clear filter"
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

        <ButtonBase
          aria-haspopup="listbox"
          aria-expanded={Boolean(kindAnchor)}
          aria-label={`Filter by kind: ${RAIL_KIND_LABEL[railKind]}`}
          onClick={(e: React.MouseEvent<HTMLElement>) => setKindAnchor(e.currentTarget)}
          sx={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            height: 26,
            pl: '10px',
            pr: '6px',
            borderRadius: `${c.radius.sm}px`,
            background: c.bg.surface,
            border: `1px solid ${c.border.subtle}`,
            ...c.type.caption,
            fontWeight: 600,
            color: c.text.primary,
            boxShadow: c.shadow.sm,
            transition: c.transition,
            '&:hover': { background: c.bg.secondary },
          }}
        >
          {RAIL_KIND_LABEL[railKind]}
          <KeyboardArrowDownRoundedIcon
            sx={{
              fontSize: 16,
              color: c.text.tertiary,
              transition: c.transition,
              transform: kindAnchor ? 'rotate(180deg)' : 'none',
            }}
          />
        </ButtonBase>

        <Menu
          anchorEl={kindAnchor}
          open={Boolean(kindAnchor)}
          onClose={() => setKindAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{
            paper: {
              sx: {
                mt: '4px',
                minWidth: 140,
                borderRadius: `${c.radius.sm}px`,
                background: c.bg.surface,
                border: `1px solid ${c.border.subtle}`,
                boxShadow: c.shadow.md,
              },
            },
          }}
          MenuListProps={{ sx: { py: '4px' }, role: 'listbox' }}
        >
          {RAIL_KINDS.map(key => {
            const active = railKind === key;
            return (
              <MenuItem
                key={key}
                role="option"
                aria-selected={active}
                selected={active}
                onClick={() => {
                  setRailKind(key);
                  setKindAnchor(null);
                }}
                sx={{
                  mx: '4px',
                  px: '8px',
                  minHeight: 30,
                  borderRadius: `${c.radius.xs}px`,
                  gap: '8px',
                  ...c.type.callout,
                  fontWeight: active ? 600 : 500,
                  color: active ? c.text.primary : c.text.secondary,
                  '&.Mui-selected': { background: `rgba(${c.accentRgb},0.10)` },
                  '&.Mui-selected:hover': { background: `rgba(${c.accentRgb},0.16)` },
                  '&:hover': { background: c.bg.secondary },
                }}
              >
                <Box sx={{ flex: 1 }}>{RAIL_KIND_LABEL[key]}</Box>
                <CheckRoundedIcon
                  sx={{
                    fontSize: 15,
                    color: c.accent.primary,
                    visibility: active ? 'visible' : 'hidden',
                  }}
                />
              </MenuItem>
            );
          })}
        </Menu>

        {/* Legend: one place that names every glyph the rail can draw, so the
            indicators stay self-explanatory as more of them accumulate. */}
        <Tooltip
          arrow
          placement="bottom-end"
          title={
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '7px', py: '2px' }}>
              <LegendItem glyph={<WebAssetRoundedIcon sx={{ fontSize: 14 }} />} label="App" />
              <LegendItem glyph={<AutoAwesomeRoundedIcon sx={{ fontSize: 13 }} />} label="Skill" />
              <LegendItem
                glyph={<RadioButtonCheckedRoundedIcon sx={{ fontSize: 11, color: c.status.warning }} />}
                label="Uncommitted changes"
              />
              <LegendItem
                glyph={<CloudUploadRoundedIcon sx={{ fontSize: 12, color: c.accent.primary }} />}
                label="Commits to push"
              />
              <LegendItem
                glyph={<GroupRoundedIcon sx={{ fontSize: 12 }} />}
                label="Shared collaborators"
              />
              <LegendItem
                glyph={<LocalOfferRoundedIcon sx={{ fontSize: 11, color: c.status.success }} />}
                label="Latest release"
              />
              <LegendItem
                glyph={
                  <Box sx={{ width: 7, height: 7, borderRadius: '50%', background: c.status.success }} />
                }
                label="Running now"
              />
              <LegendItem
                glyph={
                  <Box sx={{ width: 7, height: 7, borderRadius: '50%', background: c.accent.primary }} />
                }
                label="Never published"
              />
            </Box>
          }
          slotProps={{
            tooltip: {
              sx: {
                background: c.bg.surface,
                border: `1px solid ${c.border.subtle}`,
                boxShadow: c.shadow.md,
                borderRadius: `${c.radius.sm}px`,
                p: '10px 12px',
                maxWidth: 'none',
              },
            },
            arrow: { sx: { color: c.bg.surface } },
          }}
        >
          <Box
            component="span"
            aria-label="Indicator legend"
            sx={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              color: c.text.tertiary,
              cursor: 'help',
              '&:hover': { color: c.text.primary },
            }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 16 }} />
          </Box>
        </Tooltip>
      </Box>

        {/* Sharing unknown: show the apps, withhold the split. */}
        {sharingPhase === 'loading' && tracked.length > 0 && (
          <>
            <RailLabelSkeleton />
            {tracked.map(app => (
              <RailAppRow
                key={app.workspace_id}
                app={app}
                selected={selected?.workspace_id === app.workspace_id}
                onSelect={onSelect}
                running={runningIds?.has(app.workspace_id) ?? false}
                state={repoState?.[app.workspace_id]}
                release={releases?.[app.workspace_id]}
                sharingPending
              />
            ))}
          </>
        )}

        {sharingPhase === 'unavailable' && tracked.length > 0 && (
          <>
            <RailLabel>Tracked · {tracked.length}</RailLabel>
            {tracked.map(app => (
              <RailAppRow
                key={app.workspace_id}
                app={app}
                selected={selected?.workspace_id === app.workspace_id}
                onSelect={onSelect}
                running={runningIds?.has(app.workspace_id) ?? false}
                state={repoState?.[app.workspace_id]}
                release={releases?.[app.workspace_id]}
              />
            ))}
          </>
        )}

        {sharingPhase === 'ready' && sharedApps.length > 0 && (
          <>
            <RailLabel>Shared · {sharedApps.length}</RailLabel>
            {sharedApps.map(app => (
              <RailAppRow
                key={app.workspace_id}
                app={app}
                selected={selected?.workspace_id === app.workspace_id}
                onSelect={onSelect}
                running={runningIds?.has(app.workspace_id) ?? false}
                sharing={sharing?.[app.workspace_id]}
                state={repoState?.[app.workspace_id]}
                release={releases?.[app.workspace_id]}
              />
            ))}
          </>
        )}

        {sharingPhase === 'ready' && privateApps.length > 0 && (
          <>
            <RailLabel>Private · {privateApps.length}</RailLabel>
            {privateApps.map(app => (
              <RailAppRow
                key={app.workspace_id}
                app={app}
                selected={selected?.workspace_id === app.workspace_id}
                onSelect={onSelect}
                running={runningIds?.has(app.workspace_id) ?? false}
                sharing={sharing?.[app.workspace_id]}
                state={repoState?.[app.workspace_id]}
                release={releases?.[app.workspace_id]}
              />
            ))}
          </>
        )}

        {untracked.length > 0 && (
          <>
            <RailLabel>Untracked · {untracked.length}</RailLabel>
            {untracked.map(app => (
              <RailAppRow
                key={app.workspace_id}
                app={app}
                selected={selected?.workspace_id === app.workspace_id}
                onSelect={onSelect}
                tracking={trackingId === app.workspace_id}
                onTrack={app.workspace_exists ? () => track(app) : undefined}
              />
            ))}
          </>
        )}

        {trackError && (
          <Box
            sx={{
              ...c.type.caption,
              color: c.status.error,
              px: '8px',
              py: '6px',
              lineHeight: 1.35,
            }}
          >
            {trackError}
          </Box>
        )}

        {tracked.length === 0 && untracked.length === 0 && (
          <Box
            sx={{
              ...c.type.callout,
              color: c.text.tertiary,
              px: '10px',
              py: '18px',
              textAlign: 'center',
            }}
          >
            {query
              ? 'No matches'
              : railKind === 'skills'
                ? 'No skills yet'
                : railKind === 'apps'
                  ? 'No apps yet'
                  : 'Nothing here yet'}
          </Box>
        )}
      </Box>
    </>
  );
};

/**
 * A destination in the rail that isn't one of the user's apps. Styled to
 * match an app row so the rail reads as one list of places to go.
 */
const NavRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ icon, label, active, onClick }) => {
  const c = useClaudeTokens();
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: '8px',
        height: 30,
        px: '8px',
        borderRadius: `${c.radius.sm}px`,
        color: active ? c.accent.primary : c.text.secondary,
        background: active ? `rgba(${c.accentRgb},0.10)` : 'transparent',
        transition: c.transition,
        '&:hover': {
          background: active ? `rgba(${c.accentRgb},0.14)` : c.bg.secondary,
          color: active ? c.accent.primary : c.text.primary,
        },
      }}
    >
      {icon}
      <Box sx={{ ...c.type.callout, fontWeight: active ? 600 : 500 }}>{label}</Box>
    </ButtonBase>
  );
};

/**
 * Stands in for the "Shared · n" / "Private · n" heading while the sweep
 * runs. Same height as a real label so the list below it doesn't shift
 * down when the heading resolves.
 */
const RailLabelSkeleton: React.FC = () => {
  const c = useClaudeTokens();
  return (
    <Box
      role="status"
      aria-label="Checking which apps are shared"
      sx={{ display: 'flex', alignItems: 'center', height: 26, px: '8px', mt: '6px' }}
    >
      <Box sx={{ ...skeleton(c), width: 58, height: 8 }} />
    </Box>
  );
};

const RailAppRow: React.FC<{
  app: AppEntry;
  selected: boolean;
  onSelect: (app: AppEntry) => void;
  tracking?: boolean;
  onTrack?: () => void;
  running?: boolean;
  sharing?: Sharing;
  /** Sweep still running: hold a placeholder where the count will go. */
  sharingPending?: boolean;
  state?: RepoState;
  release?: Release;
}> = ({
  app,
  selected,
  onSelect,
  tracking,
  onTrack,
  running,
  sharing,
  sharingPending,
  state,
  release,
}) => {
  const c = useClaudeTokens();
  const missing = !app.workspace_exists;
  const dirty = state?.dirty ?? 0;
  const unpushed = state?.unpushed ?? 0;
  const needsPublish = state?.needsPublish ?? false;
  const people = sharing?.people ?? [];
  const shareTitle = sharing?.shared
    ? `${sharing.theirs ? `${sharing.owner}'s app · ` : ''}with ${people.join(', ')}${
        sharing.pending ? ` (${sharing.pending} pending)` : ''
      }`
    : undefined;
  return (
    <Box
      component="button"
      onClick={() => onSelect(app)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        width: '100%',
        height: 32,
        px: '8px',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        borderRadius: `${c.radius.sm}px`,
        background: selected ? `rgba(${c.accentRgb},0.10)` : 'transparent',
        color: selected ? c.text.primary : c.text.primary,
        transition: 'background 100ms linear',
        '& .track-slot': { opacity: 0, transition: 'opacity 120ms linear' },
        '&:hover': {
          background: selected ? `rgba(${c.accentRgb},0.10)` : c.bg.secondary,
          '& .track-slot': { opacity: 1 },
        },
      }}
    >
      {app.has_git ? (
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <BrandGlyph
            seed={app.workspace_id}
            letter={app.name[0] || '?'}
            size={20}
            active={selected}
            iconId={app.workspace_id}
            hasIcon={app.has_icon}
          />
          {running && (
            <Box
              title="Open in OpenSwarm"
              sx={{
                position: 'absolute',
                right: -1,
                bottom: -1,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: c.status.success,
                border: `1.5px solid ${selected ? `rgba(${c.accentRgb},0.10)` : c.bg.surface}`,
              }}
            />
          )}
          {needsPublish && !missing && (
            <Box
              title="Never published — publish this app for the first time"
              sx={{
                position: 'absolute',
                right: -1,
                top: -1,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: c.accent.primary,
                border: `1.5px solid ${selected ? `rgba(${c.accentRgb},0.10)` : c.bg.surface}`,
              }}
            />
          )}
        </Box>
      ) : (
        <Box
          sx={{
            width: 20,
            height: 20,
            flexShrink: 0,
            borderRadius: `${c.radius.sm}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: c.text.muted,
          }}
        >
          <RadioButtonUncheckedRoundedIcon sx={{ fontSize: 14 }} />
        </Box>
      )}

      {/* Kind marker: which of the two things this row is, at a glance.
          Muted so it reads as a type hint, not another status badge. */}
      <Box
        component="span"
        title={app.kind === 'skill' ? 'Skill' : 'App'}
        sx={{ display: 'inline-flex', flexShrink: 0, color: c.text.tertiary }}
      >
        {app.kind === 'skill' ? (
          <AutoAwesomeRoundedIcon sx={{ fontSize: 13 }} />
        ) : (
          <WebAssetRoundedIcon sx={{ fontSize: 14 }} />
        )}
      </Box>

      <Box
        title={app.name}
        sx={{
          flex: 1,
          minWidth: 0,
          ...c.type.body,
          fontWeight: selected ? 590 : 400,
          color: missing ? c.text.tertiary : c.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {app.name}
      </Box>

      {/* All trailing indicators live in one shrink-proof cluster so several
          badges (dirty, unpushed, shared, release) keep even spacing and the
          label yields (ellipsizes) before any of them get clipped. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexShrink: 0,
          minWidth: 0,
        }}
      >
      {/* Uncommitted and unpushed are separate badges rather than one total:
          they take different actions to clear, and collapsing them would
          hide which one this app is actually waiting on. */}
      {dirty > 0 && !missing && (
        <Box
          title={`${dirty} uncommitted ${dirty === 1 ? 'file' : 'files'}`}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            flexShrink: 0,
            ...c.type.caption,
            fontWeight: 500,
            color: c.status.warning,
          }}
        >
          <RadioButtonCheckedRoundedIcon sx={{ fontSize: 11 }} />
          {dirty}
        </Box>
      )}

      {unpushed > 0 && !missing && (
        <Box
          title={`${unpushed} ${unpushed === 1 ? 'commit' : 'commits'} to push`}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            flexShrink: 0,
            ...c.type.caption,
            fontWeight: 500,
            color: c.accent.primary,
          }}
        >
          <CloudUploadRoundedIcon sx={{ fontSize: 12 }} />
          {unpushed}
        </Box>
      )}

      {sharingPending && !missing && (
        <Box sx={{ ...skeleton(c), width: 22, height: 8, flexShrink: 0 }} />
      )}

      {sharing?.shared && !missing && (
        <Box
          title={shareTitle}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            flexShrink: 0,
            ...c.type.caption,
            color: c.text.tertiary,
          }}
        >
          <GroupRoundedIcon sx={{ fontSize: 12 }} />
          {people.length}
        </Box>
      )}

      {/* Latest shipped release, as a version tag. A distinct pill (not a bare
          count) so it reads as a label rather than another status number. */}
      {release?.version && !missing && (
        <Box
          title={`Latest release ${release.version}`}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            flexShrink: 0,
            maxWidth: 72,
            height: 15,
            pl: '3px',
            pr: '5px',
            ...c.type.caption,
            fontWeight: 600,
            color: c.status.success,
            background: `rgba(${c.accentRgb},0.10)`,
            border: `1px solid ${c.border.subtle}`,
            borderRadius: `${c.radius.xs}px`,
          }}
        >
          <LocalOfferRoundedIcon sx={{ fontSize: 10, flexShrink: 0 }} />
          <Box
            component="span"
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {release.version}
          </Box>
        </Box>
      )}

      {missing ? (
        <Box sx={{ ...c.type.caption, color: c.status.error, opacity: 0.85 }}>gone</Box>
      ) : onTrack ? (
        <Box
          component="span"
          className="track-slot"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onTrack();
          }}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 18,
            px: '7px',
            ...c.type.caption,
            fontWeight: 500,
            color: c.accent.primary,
            borderRadius: `${c.radius.xs}px`,
            border: `1px solid ${`rgba(${c.accentRgb},0.35)`}`,
            '&:hover': { background: `rgba(${c.accentRgb},0.10)` },
          }}
        >
          {tracking ? <CircularProgress size={9} sx={{ color: c.accent.primary }} /> : 'Track'}
        </Box>
      ) : null}
      </Box>
    </Box>
  );
};

export default AppRail;
