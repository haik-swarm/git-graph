import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded';
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
import { GITGRAPH_RELEASES_SWEEP_URL } from '@/shared/state/API_ENDPOINTS';

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(GITGRAPH_RELEASES_SWEEP_URL);
      if (!res.ok) throw new Error(`load ${res.status}`);
      const data = await res.json();
      setConnected(Boolean(data?.connected));
      setReleased((data?.released ?? {}) as Record<string, ReleasedApp>);
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

  const shown = useMemo(() => {
    const entries = Object.entries(released ?? {});
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          ([, a]) =>
            a.name.toLowerCase().includes(q) ||
            `${a.owner}/${a.repo}`.toLowerCase().includes(q),
        )
      : entries;
    // Most recently released first, so the freshest ship sits at the top.
    return filtered.sort(
      ([, a], [, b]) =>
        (b.latest.created_at ?? '').localeCompare(a.latest.created_at ?? ''),
    );
  }, [released, query]);

  const total = released ? Object.keys(released).length : 0;

  return (
    <>
      <Toolbar>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <LocalOfferRoundedIcon sx={{ fontSize: 16, color: c.text.tertiary }} />
          <Box sx={{ ...c.type.headline, color: c.text.primary }}>Releases</Box>
          {total > 0 && <Box sx={{ ...statusChip(c, 'neutral') }}>{total}</Box>}
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
                  <Box sx={{ ...statusChip(c, 'accent'), fontFamily: c.font.mono }}>
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
