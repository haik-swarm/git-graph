import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  card,
  primaryButton,
  pushButton,
  statusChip,
  sunkenField,
} from '@/shared/styles/ui';
import { BrandGlyph, Placeholder, Toolbar, Scroller } from '@/components/Chrome';
import { relativeTime } from '@/shared/graphLayout';
import {
  GITGRAPH_CLOUD_INSTALL_URL,
  GITGRAPH_MARKETPLACE_LISTINGS_URL,
} from '@/shared/state/API_ENDPOINTS';

export interface Listing {
  name: string;
  repo: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  description: string | null;
  stars: number;
  updated_at: string | null;
  default_branch: string | null;
  /** Whoever's repo this was forked from; null if the fork link is gone. */
  author: string | null;
  author_url: string | null;
  fork: boolean;
  installed_workspace_id: string | null;
}

interface Props {
  onInstalled: (workspaceId: string) => void;
}

/**
 * The marketplace: every public app repo in the `os-marketplace` org.
 *
 * Read-only by design. Getting an app in here means submitting it from
 * its own page and having someone approve it in the management app, so
 * there's nothing to publish from this screen.
 */
const Marketplace: React.FC<Props> = ({ onInstalled }) => {
  const c = useClaudeTokens();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [orgUrl, setOrgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(GITGRAPH_MARKETPLACE_LISTINGS_URL);
      if (!res.ok) throw new Error(`load ${res.status}`);
      const data = await res.json();
      setOrgUrl(data?.org_url ?? null);
      if (!data?.ok) {
        setListings([]);
        setError(data?.error || "We couldn't reach the marketplace.");
        return;
      }
      setListings((data.listings ?? []) as Listing[]);
    } catch (err) {
      setListings([]);
      setError(err instanceof Error ? err.message : "We couldn't load the marketplace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async (listing: Listing) => {
    setInstalling(listing.full_name);
    setInstallError(null);
    try {
      const res = await fetch(GITGRAPH_CLOUD_INSTALL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clone_url: listing.clone_url,
          app_name: listing.name,
          description: listing.description ?? '',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `install ${res.status}`);
      setListings(prev =>
        prev
          ? prev.map(l =>
              l.full_name === listing.full_name
                ? { ...l, installed_workspace_id: data.workspace_id }
                : l,
            )
          : prev,
      );
      onInstalled(data.workspace_id);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "That didn't install.");
    } finally {
      setInstalling(null);
    }
  };

  const shown = useMemo(() => {
    if (!listings) return [];
    const q = query.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter(
      l =>
        l.name.toLowerCase().includes(q) ||
        (l.author || '').toLowerCase().includes(q),
    );
  }, [listings, query]);

  return (
    <>
      <Toolbar>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <StorefrontRoundedIcon sx={{ fontSize: 16, color: c.text.tertiary }} />
          <Box sx={{ ...c.type.headline, color: c.text.primary }}>Marketplace</Box>
          {listings && listings.length > 0 && (
            <Box sx={{ ...statusChip(c, 'neutral') }}>{listings.length}</Box>
          )}
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
            placeholder="Search apps"
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

      {installError && (
        <Box
          sx={{
            mx: 3,
            mt: 2,
            px: 2,
            py: 1,
            borderRadius: `${c.radius.md}px`,
            background: c.status.errorBg,
            color: c.status.error,
            ...c.type.caption,
          }}
        >
          {installError}
        </Box>
      )}

      <Scroller>
        {loading && !listings && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
            <CircularProgress size={20} sx={{ color: c.text.tertiary }} />
          </Box>
        )}

        {!loading && error && (
          <Placeholder
            danger
            icon={<StorefrontRoundedIcon />}
            title="The marketplace is out of reach"
            hint={error}
            action={
              <ButtonBase onClick={() => void load()} sx={{ ...pushButton(c) }}>
                Try again
              </ButtonBase>
            }
          />
        )}

        {!loading && !error && listings?.length === 0 && (
          <Placeholder
            icon={<StorefrontRoundedIcon />}
            title="Nothing published yet"
            hint="Approved apps show up here. Submit one from its own page with the Publish button."
            action={
              orgUrl ? (
                <ButtonBase
                  onClick={() => window.open(orgUrl, '_blank', 'noopener')}
                  sx={{ ...pushButton(c) }}
                >
                  <OpenInNewIcon sx={{ fontSize: 13 }} />
                  View the org
                </ButtonBase>
              ) : undefined
            }
          />
        )}

        {!error && shown.length === 0 && (listings?.length ?? 0) > 0 && (
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
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 2,
              px: 3,
              py: 2,
            }}
          >
            {shown.map(listing => {
              const installed = Boolean(listing.installed_workspace_id);
              const busy = installing === listing.full_name;
              return (
                <Box key={listing.full_name} sx={{ ...card(c), p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                    <BrandGlyph
                      seed={listing.full_name}
                      letter={(listing.name || '?').charAt(0).toUpperCase()}
                      size={28}
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
                        {listing.name}
                      </Box>
                      <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                        {listing.author ? `by ${listing.author}` : listing.full_name}
                      </Box>
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
                    {listing.updated_at && <span>{relativeTime(listing.updated_at)}</span>}
                    {listing.stars > 0 && <span>{listing.stars} ★</span>}
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
                    {installed ? (
                      <Box sx={{ ...statusChip(c, 'success') }}>
                        <CheckRoundedIcon sx={{ fontSize: 12 }} />
                        Installed
                      </Box>
                    ) : (
                      <ButtonBase
                        onClick={() => void install(listing)}
                        disabled={busy}
                        sx={{ ...primaryButton(c) }}
                      >
                        {busy ? (
                          <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
                        ) : (
                          <CloudDownloadRoundedIcon sx={{ fontSize: 14 }} />
                        )}
                        {busy ? 'Installing' : 'Install'}
                      </ButtonBase>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <ButtonBase
                      onClick={() => window.open(listing.html_url, '_blank', 'noopener')}
                      sx={{ ...pushButton(c) }}
                      aria-label={`Open ${listing.name} on GitHub`}
                    >
                      <OpenInNewIcon sx={{ fontSize: 13 }} />
                    </ButtonBase>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Scroller>
    </>
  );
};

export default Marketplace;
