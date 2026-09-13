import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import ExtensionRoundedIcon from '@mui/icons-material/ExtensionRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { card, pushButton, statusChip, sunkenField } from '@/shared/styles/ui';
import { BrandGlyph, Placeholder, Toolbar, Scroller } from '@/components/Chrome';
import { relativeTime } from '@/shared/graphLayout';
import {
  GITGRAPH_RELEASES_SWEEP_URL,
  GITGRAPH_SKILLS_RELEASES_SWEEP_URL,
} from '@/shared/state/API_ENDPOINTS';

interface ReleaseEntry {
  tag: string | null;
  name: string | null;
  html_url: string | null;
  created_at: string | null;
  draft: boolean;
  asset_url: string | null;
  asset_name: string | null;
}

interface ReleasedApp {
  name: string;
  description: string | null;
  has_icon: boolean;
  owner: string;
  repo: string;
  html_url: string;
  latest: ReleaseEntry;
  releases: ReleaseEntry[];
  count: number;
  /** Which sweep this entry came from. Tagged when the merged map is built. */
  kind: 'app' | 'skill';
}

interface Props {
  /** Jump to an app's git-graph view when its card is clicked. */
  onOpen: (workspaceId: string) => void;
}

/**
 * Every app the user has actually cut a GitHub Release for, one card each.
 * The reverse of the per-app Release panel: that panel publishes a release,
 * this tab is the shelf of everything already shipped, newest release first.
 */
const Releases: React.FC<Props> = ({ onOpen }) => {
  const c = useClaudeTokens();
  const [released, setReleased] = useState<Record<string, ReleasedApp> | null>(null);
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Releases owns its own kind filter now that there is no global source.
  const [kind, setKind] = useState<'all' | 'apps' | 'skills'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [appsRes, skillsRes] = await Promise.allSettled([
        fetch(GITGRAPH_RELEASES_SWEEP_URL),
        fetch(GITGRAPH_SKILLS_RELEASES_SWEEP_URL),
      ]);
      const read = async (
        r: PromiseSettledResult<Response>,
        entryKind: 'app' | 'skill',
      ): Promise<{ connected: boolean; released: Record<string, ReleasedApp> }> => {
        if (r.status !== 'fulfilled' || !r.value.ok) {
          return { connected: false, released: {} };
        }
        const data = await r.value.json();
        const raw = (data?.released ?? {}) as Record<string, ReleasedApp>;
        const tagged: Record<string, ReleasedApp> = {};
        for (const [id, app] of Object.entries(raw)) {
          tagged[id] = { ...app, kind: entryKind };
        }
        return { connected: Boolean(data?.connected), released: tagged };
      };
      const [apps, skills] = await Promise.all([
        read(appsRes, 'app'),
        read(skillsRes, 'skill'),
      ]);
      // Both sweeps failing is the only real error; a single failure still
      // shows the other's shelf. Keyed by prefixed id, so the spread is safe.
      if (appsRes.status === 'rejected' && skillsRes.status === 'rejected') {
        throw new Error('both release sweeps failed');
      }
      setConnected(apps.connected || skills.connected);
      setReleased({ ...apps.released, ...skills.released });
    } catch (err) {
      setReleased({});
      setError(err instanceof Error ? err.message : "We couldn't load releases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The kind-filtered set, before search. The count chip reflects this so it
  // tracks the active local filter rather than the whole merged shelf.
  const kindEntries = useMemo(() => {
    const entries = Object.entries(released ?? {});
    if (kind === 'all') return entries;
    const wantKind = kind === 'apps' ? 'app' : 'skill';
    return entries.filter(([, a]) => a.kind === wantKind);
  }, [released, kind]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? kindEntries.filter(
          ([, a]) =>
            a.name.toLowerCase().includes(q) ||
            `${a.owner}/${a.repo}`.toLowerCase().includes(q),
        )
      : kindEntries;
    // Most recently released first, so the freshest ship sits at the top.
    return [...filtered].sort(
      ([, a], [, b]) =>
        (b.latest.created_at ?? '').localeCompare(a.latest.created_at ?? ''),
    );
  }, [kindEntries, query]);

  const total = kindEntries.length;

  return (
    <>
      <Toolbar>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <LocalOfferRoundedIcon sx={{ fontSize: 16, color: c.text.tertiary }} />
          <Box sx={{ ...c.type.headline, color: c.text.primary }}>Releases</Box>
          {total > 0 && <Box sx={{ ...statusChip(c, 'neutral') }}>{total}</Box>}
        </Box>

        <Box
          role="tablist"
          aria-label="Show apps, skills, or all releases"
          sx={{
            display: 'flex',
            gap: '2px',
            p: '2px',
            ml: 1,
            borderRadius: `${c.radius.sm}px`,
            background: c.bg.secondary,
            border: `1px solid ${c.border.subtle}`,
          }}
        >
          {(['all', 'apps', 'skills'] as const).map(key => {
            const active = kind === key;
            return (
              <ButtonBase
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => setKind(key)}
                sx={{
                  px: '10px',
                  height: 24,
                  borderRadius: `${c.radius.xs}px`,
                  ...c.type.caption,
                  fontWeight: active ? 600 : 500,
                  textTransform: 'capitalize',
                  color: active ? c.text.primary : c.text.tertiary,
                  background: active ? c.bg.surface : 'transparent',
                  boxShadow: active ? c.shadow.sm : 'none',
                  transition: c.transition,
                  '&:hover': { color: c.text.primary },
                }}
              >
                {key}
              </ButtonBase>
            );
          })}
        </Box>

        <Box sx={{ flex: 1 }} />

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            height: 28,
            px: '8px',
            width: 200,
            ...sunkenField(c),
          }}
        >
          <SearchRoundedIcon sx={{ fontSize: 14, color: c.text.tertiary }} />
          <Box
            component="input"
            value={query}
            placeholder="Search released apps"
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
        </Box>

        <ButtonBase onClick={() => void load()} disabled={loading} sx={{ ...pushButton(c) }}>
          {loading ? (
            <CircularProgress size={12} sx={{ color: c.text.tertiary }} />
          ) : (
            <RefreshRoundedIcon sx={{ fontSize: 14 }} />
          )}
          Refresh
        </ButtonBase>
      </Toolbar>

      <Scroller>
        {loading && !released && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
            <CircularProgress size={20} sx={{ color: c.text.tertiary }} />
          </Box>
        )}

        {!loading && error && (
          <Placeholder
            danger
            icon={<CloudOffRoundedIcon />}
            title="Couldn't load releases"
            hint={error}
            action={
              <ButtonBase onClick={() => void load()} sx={{ ...pushButton(c) }}>
                Try again
              </ButtonBase>
            }
          />
        )}

        {!loading && !error && !connected && total === 0 && (
          <Placeholder
            icon={<LocalOfferRoundedIcon />}
            title="Connect GitHub to see releases"
            hint="Releases live on GitHub. Connect the GitHub integration in OpenSwarm settings, then cut a release from any app's page."
          />
        )}

        {!loading && !error && connected && total === 0 && (
          <Placeholder
            icon={<LocalOfferRoundedIcon />}
            title="No releases yet"
            hint="Open an app, then use its Release button to build a .swarm and cut a versioned GitHub Release. Every app you've released shows up here."
          />
        )}

        {!error && shown.length === 0 && total > 0 && (
          <Placeholder
            icon={<SearchOffRoundedIcon />}
            title="No apps match that"
            hint="Try a different name."
          />
        )}

        {shown.length > 0 && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 2,
              px: 3,
              py: 2,
            }}
          >
            {shown.map(([wid, app]) => (
              <Box
                key={wid}
                sx={{ ...card(c, true), p: 2, cursor: 'pointer' }}
                onClick={() => onOpen(wid)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                  <BrandGlyph
                    seed={wid}
                    letter={(app.name || '?').charAt(0).toUpperCase()}
                    size={28}
                    iconId={wid}
                    hasIcon={app.has_icon}
                  />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Box
                      sx={{
                        ...c.type.headline,
                        color: c.text.primary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {app.name}
                    </Box>
                    <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                      {app.owner}/{app.repo}
                    </Box>
                  </Box>
                  <Box
                    sx={statusChip(c, app.kind === 'skill' ? 'success' : 'accent')}
                    title={app.kind === 'skill' ? 'Skill release' : 'App release'}
                  >
                    {app.kind === 'skill' ? (
                      <ExtensionRoundedIcon />
                    ) : (
                      <WidgetsRoundedIcon />
                    )}
                    {app.kind === 'skill' ? 'Skill' : 'App'}
                  </Box>
                  <Box sx={{ ...statusChip(c, 'neutral'), fontFamily: c.font.mono }}>
                    {app.latest.tag ?? app.latest.name}
                  </Box>
                </Box>

                <Box
                  sx={{
                    ...c.type.caption,
                    color: c.text.tertiary,
                    mt: 1.5,
                    display: 'flex',
                    gap: 1.5,
                  }}
                >
                  {app.latest.created_at && (
                    <span>Released {relativeTime(app.latest.created_at)}</span>
                  )}
                  <span>
                    {app.count} {app.count === 1 ? 'release' : 'releases'}
                  </span>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
                  {app.latest.asset_url && (
                    <Box
                      component="a"
                      href={app.latest.asset_url}
                      title={app.latest.asset_name ?? 'Download .swarm'}
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      sx={{
                        ...pushButton(c),
                        textDecoration: 'none',
                        color: c.text.secondary,
                      }}
                    >
                      <DownloadIcon sx={{ fontSize: 14 }} />
                      .swarm
                    </Box>
                  )}
                  <Box sx={{ flex: 1 }} />
                  <Box
                    component="a"
                    href={app.latest.html_url ?? app.html_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    sx={{
                      ...pushButton(c),
                      textDecoration: 'none',
                      color: c.text.secondary,
                    }}
                    aria-label={`Open ${app.name} releases on GitHub`}
                  >
                    <OpenInNewIcon sx={{ fontSize: 13 }} />
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Scroller>
    </>
  );
};

export default Releases;
