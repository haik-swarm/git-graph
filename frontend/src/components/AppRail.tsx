import React, { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { slimScroll, sunkenField } from '@/shared/styles/ui';
import { BrandGlyph, RailLabel } from '@/components/Chrome';
import { gitgraphInitUrl } from '@/shared/state/API_ENDPOINTS';
import type { AppEntry } from '@/components/AppPicker';

interface Props {
  apps: AppEntry[];
  selected: AppEntry | null;
  homeActive: boolean;
  onHome: () => void;
  onSelect: (app: AppEntry) => void;
  onTracked: (app: AppEntry) => void;
  runningIds?: Set<string>;
}

/**
 * Persistent left rail listing every workspace on the dashboard. Tracked
 * repos come first with a small colour glyph; untracked ones sit in a
 * quieter group with a hover "Track" pill so a new repo is one click away
 * without opening a picker.
 */
const AppRail: React.FC<Props> = ({
  apps,
  selected,
  homeActive,
  onHome,
  onSelect,
  onTracked,
  runningIds,
}) => {
  const c = useClaudeTokens();
  const [query, setQuery] = useState('');
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  const { tracked, untracked } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? apps.filter(a => a.name.toLowerCase().includes(q))
      : apps;
    return {
      tracked: filtered.filter(a => a.has_git && a.workspace_exists),
      untracked: filtered.filter(a => !a.has_git || !a.workspace_exists),
    };
  }, [apps, query]);

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
      setTrackError(err instanceof Error ? err.message : 'Failed to track.');
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
          borderBottom: `0.5px solid ${c.separator}`,
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
            background: `linear-gradient(135deg, ${c.accent.base}, ${c.accent.hover})`,
            color: c.text.onAccent,
            boxShadow: c.shadow.control,
          }}
        >
          <CallSplitRoundedIcon sx={{ fontSize: 13 }} />
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
            '&:focus-within': { boxShadow: c.accent.ring },
          }}
        >
          <SearchRoundedIcon sx={{ fontSize: 13, color: c.text.tertiary, flexShrink: 0 }} />
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
                '& svg': { fontSize: 12 },
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
            background: homeActive ? c.accent.wash : 'transparent',
            color: c.text.primary,
            transition: 'background 100ms linear',
            '&:hover': { background: homeActive ? c.accent.wash : c.bg.fill },
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
              color: homeActive ? c.accent.base : c.text.tertiary,
              background: homeActive ? c.accent.wash : 'transparent',
            }}
          >
            <GridViewRoundedIcon sx={{ fontSize: 13 }} />
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

        {tracked.length > 0 && (
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
              color: c.status.danger,
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

const RailAppRow: React.FC<{
  app: AppEntry;
  selected: boolean;
  onSelect: (app: AppEntry) => void;
  tracking?: boolean;
  onTrack?: () => void;
  running?: boolean;
}> = ({ app, selected, onSelect, tracking, onTrack, running }) => {
  const c = useClaudeTokens();
  const missing = !app.workspace_exists;
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
        background: selected ? c.accent.wash : 'transparent',
        color: selected ? c.text.primary : c.text.primary,
        transition: 'background 100ms linear',
        '& .track-slot': { opacity: 0, transition: 'opacity 120ms linear' },
        '&:hover': {
          background: selected ? c.accent.wash : c.bg.fill,
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
                border: `1.5px solid ${selected ? c.accent.wash : c.bg.raised}`,
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
            color: c.text.quaternary,
          }}
        >
          <RadioButtonUncheckedRoundedIcon sx={{ fontSize: 13 }} />
        </Box>
      )}

      <Box
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

      {missing ? (
        <Box sx={{ ...c.type.caption, color: c.status.danger, opacity: 0.85 }}>gone</Box>
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
            color: c.accent.base,
            borderRadius: `${c.radius.xs}px`,
            border: `0.5px solid ${c.accent.edge}`,
            '&:hover': { background: c.accent.wash },
          }}
        >
          {tracking ? <CircularProgress size={9} sx={{ color: c.accent.base }} /> : 'Track'}
        </Box>
      ) : null}
    </Box>
  );
};

export default AppRail;
