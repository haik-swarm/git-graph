import React, { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
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

/** How much the rail is allowed to claim about who can see each app. */
export type SharingPhase =
  /** Sweep still in flight: grouping is unknown, so it isn't drawn yet. */
  | 'loading'
  /** Answers are in; Private and Shared are real. */
  | 'ready'
  /** No GitHub, or the sweep failed. Sharing is unknowable, so don't guess. */
  | 'unavailable';

interface Props {
  apps: AppEntry[];
  selected: AppEntry | null;
  homeActive: boolean;
  onHome: () => void;
  onSelect: (app: AppEntry) => void;
  onTracked: (app: AppEntry) => void;
  runningIds?: Set<string>;
  sharing?: Record<string, Sharing>;
  sharingPhase?: SharingPhase;
}

/**
 * Persistent left rail listing every workspace on the dashboard. Tracked
 * repos split by who can see them, Shared above Private, since "who else
 * is in this" is the thing you want to know before you touch an app.
 * Untracked ones sit in a quieter group with a hover "Track" pill so a new
 * repo is one click away without opening a picker.
 *
 * Only GitHub knows who an app is shared with, so that split can't be
 * computed locally. Rather than open on a guess and reshuffle when the
 * answer lands, the tracked section shows placeholders until the sweep
 * finishes: a rail that briefly calls a shared app private is worse than
 * a rail that admits it doesn't know yet.
 */
const AppRail: React.FC<Props> = ({
  apps,
  selected,
  homeActive,
  onHome,
  onSelect,
  onTracked,
  runningIds,
  sharing,
  sharingPhase = 'ready',
}) => {
  const c = useClaudeTokens();
  const [query, setQuery] = useState('');
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  const { tracked, privateApps, sharedApps, untracked } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? apps.filter(a => a.name.toLowerCase().includes(q))
      : apps;
    const trackedApps = filtered.filter(a => a.has_git && a.workspace_exists);
    return {
      tracked: trackedApps,
      privateApps: trackedApps.filter(a => !sharing?.[a.workspace_id]?.shared),
      sharedApps: trackedApps.filter(a => sharing?.[a.workspace_id]?.shared),
      untracked: filtered.filter(a => !a.has_git || !a.workspace_exists),
    };
  }, [apps, query, sharing]);

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
      <ButtonBase
        onClick={onHome}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 1,
          height: 48,
          flexShrink: 0,
          px: '14px',
          borderBottom: `1px solid ${c.border.subtle}`,
          cursor: 'pointer',
          '&:hover .brand-title': { color: c.text.primary },
        }}
        aria-label="Home"
      >
        <Box
          sx={{
            width: 22,
            height: 22,
            borderRadius: `${c.radius.sm}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `linear-gradient(135deg, ${c.accent.primary}, ${c.accent.hover})`,
            color: "#FFFFFF",
            boxShadow: c.shadow.sm,
          }}
        >
          <CallSplitRoundedIcon sx={{ fontSize: 14 }} />
        </Box>
        <Box
          className="brand-title"
          sx={{ ...c.type.headline, color: c.text.primary, letterSpacing: '-0.01em' }}
        >
          Git Graph
        </Box>
      </ButtonBase>

      <Box sx={{ px: '10px', pt: '10px', pb: '6px', flexShrink: 0 }}>
        <Box
          sx={{
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
            placeholder="Filter apps"
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
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: '6px', pb: '10px', ...slimScroll(c) }}>
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
            {query ? 'No matches' : 'No apps yet'}
          </Box>
        )}
      </Box>
    </>
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
}> = ({ app, selected, onSelect, tracking, onTrack, running, sharing, sharingPending }) => {
  const c = useClaudeTokens();
  const missing = !app.workspace_exists;
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
          <BrandGlyph seed={app.workspace_id} letter={app.name[0] || '?'} size={20} active={selected} />
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
            color: sharing.pending ? c.status.warning : c.text.tertiary,
          }}
        >
          <GroupRoundedIcon sx={{ fontSize: 12 }} />
          {people.length}
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
  );
};

export default AppRail;
