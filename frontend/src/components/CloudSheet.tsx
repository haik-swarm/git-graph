import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { primaryButton, pushButton, slimScroll, sunkenField } from '@/shared/styles/ui';
import { BrandGlyph, Placeholder } from '@/components/Chrome';
import { absoluteTime, relativeTime } from '@/shared/graphLayout';
import {
  GITGRAPH_CLOUD_INSTALL_URL,
  GITGRAPH_CLOUD_REPOS_URL,
} from '@/shared/state/API_ENDPOINTS';

interface CloudRepo {
  owner: string;
  name: string;
  full_name: string;
  description: string | null;
  app_name: string;
  html_url: string;
  clone_url: string;
  private: boolean;
  updated_at: string | null;
  pushed_at: string | null;
  default_branch: string | null;
  installed_workspace_id: string | null;
}

interface CloudState {
  connected: boolean;
  repos: CloudRepo[];
  error?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onInstalled: (workspaceId: string) => void;
}

/**
 * "Your cloud" sheet: every OpenSwarm-tagged repo on the user's GitHub,
 * one-click install into a fresh workspace. Repos that are already
 * installed show a "Installed" badge instead of the Install button so a
 * double click can't spawn a duplicate.
 */
const CloudSheet: React.FC<Props> = ({ open, onClose, onInstalled }) => {
  const c = useClaudeTokens();
  const [state, setState] = useState<CloudState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(GITGRAPH_CLOUD_REPOS_URL);
      if (!res.ok) throw new Error(`load ${res.status}`);
      const data: CloudState = await res.json();
      setState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load that.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void load();
    } else {
      setState(null);
      setError(null);
      setQuery('');
      setInstallError(null);
      setInstallingSlug(null);
    }
  }, [open, load]);

  const install = async (repo: CloudRepo) => {
    setInstallingSlug(repo.full_name);
    setInstallError(null);
    try {
      const res = await fetch(GITGRAPH_CLOUD_INSTALL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clone_url: repo.clone_url,
          app_name: repo.app_name,
          description: repo.description ?? '',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `install ${res.status}`);
      // Update the in-memory list so the button flips to "Installed" without
      // another round trip.
      setState(prev =>
        prev
          ? {
              ...prev,
              repos: prev.repos.map(r =>
                r.full_name === repo.full_name
                  ? { ...r, installed_workspace_id: data.workspace_id }
                  : r,
              ),
            }
          : prev,
      );
      onInstalled(data.workspace_id);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Install failed.');
    } finally {
      setInstallingSlug(null);
    }
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!state) return [];
    if (!q) return state.repos;
    return state.repos.filter(r =>
      [r.app_name, r.name, r.full_name, r.description ?? ''].some(f =>
        f.toLowerCase().includes(q),
      ),
    );
  }, [state, query]);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        backdrop: { sx: { background: 'rgba(0,0,0,0.35)' } },
        paper: {
          sx: {
            width: 600,
            maxWidth: '92vw',
            background: c.bg.page,
            backgroundImage: 'none',
            border: 'none',
            boxShadow: c.shadow.lg,
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          height: 48,
          flexShrink: 0,
          borderBottom: `1px solid ${c.border.subtle}`,
        }}
      >
        <CloudRoundedIcon sx={{ fontSize: 16, color: c.accent.primary }} />
        <Box sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
          Your cloud
        </Box>
        <ButtonBase
          onClick={onClose}
          sx={{
            width: 26,
            height: 26,
            borderRadius: `${c.radius.sm}px`,
            color: c.text.secondary,
            '&:hover': { color: c.text.primary, background: c.bg.secondary },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </ButtonBase>
      </Box>

      <Box
        sx={{
          px: 2,
          pt: 1.5,
          pb: 1,
          ...c.type.callout,
          color: c.text.secondary,
          lineHeight: 1.5,
        }}
      >
        Every OpenSwarm app you've pushed to GitHub. Install one to clone it
        into a fresh workspace on this machine.
      </Box>

      <Box sx={{ px: 2, pb: 1, flexShrink: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            height: 30,
            px: '10px',
            ...sunkenField(c),
            '&:focus-within': { boxShadow: `0 0 0 3px rgba(${c.accentRgb},0.35)` },
          }}
        >
          <SearchRoundedIcon sx={{ fontSize: 14, color: c.text.tertiary, flexShrink: 0 }} />
          <Box
            component="input"
            value={query}
            placeholder="Filter repos"
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
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pb: 2, ...slimScroll(c) }}>
        {loading ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 200,
            }}
          >
            <CircularProgress size={20} sx={{ color: c.text.tertiary }} />
          </Box>
        ) : error ? (
          <Placeholder
            danger
            icon={<CloudRoundedIcon />}
            title="Couldn't reach GitHub"
            hint={error}
          />
        ) : !state?.connected ? (
          <Placeholder
            icon={<LockRoundedIcon />}
            title="Connect GitHub first"
            hint="Add the GitHub integration in OpenSwarm settings, then reopen this sheet."
          />
        ) : state.repos.length === 0 ? (
          <Placeholder
            icon={<SearchOffRoundedIcon />}
            title="No OpenSwarm apps in the cloud yet"
            hint="Push an app to GitHub from its repo view and it'll appear here."
          />
        ) : rows.length === 0 ? (
          <Placeholder
            icon={<SearchOffRoundedIcon />}
            title="No repos match that"
            hint="Try a shorter term or clear the search."
          />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {rows.map(repo => (
              <RepoRow
                key={repo.full_name}
                repo={repo}
                installing={installingSlug === repo.full_name}
                onInstall={() => void install(repo)}
              />
            ))}
          </Box>
        )}

        {installError && (
          <Box sx={{ mt: 1.5, ...c.type.caption, color: c.status.error }}>
            {installError}
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

const RepoRow: React.FC<{
  repo: CloudRepo;
  installing: boolean;
  onInstall: () => void;
}> = ({ repo, installing, onInstall }) => {
  const c = useClaudeTokens();
  const installed = Boolean(repo.installed_workspace_id);
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        p: 1.5,
        background: c.bg.surface,
        border: `1px solid ${c.border.subtle}`,
        borderRadius: `${c.radius.lg}px`,
        boxShadow: c.shadow.sm,
      }}
    >
      <BrandGlyph seed={repo.full_name} letter={repo.app_name[0] || '?'} size={32} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Box
            sx={{
              ...c.type.title3,
              color: c.text.primary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {repo.app_name}
          </Box>
          {repo.private && (
            <LockRoundedIcon sx={{ fontSize: 14, color: c.text.tertiary }} />
          )}
        </Box>
        <Box
          sx={{
            ...c.type.caption,
            color: c.text.tertiary,
            fontFamily: c.font.mono,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            mt: '2px',
          }}
        >
          {repo.full_name}
          <Box
            component="a"
            href={repo.html_url}
            target="_blank"
            rel="noreferrer"
            sx={{
              color: c.text.tertiary,
              display: 'inline-flex',
              '&:hover': { color: c.accent.primary },
            }}
          >
            <OpenInNewIcon sx={{ fontSize: 14 }} />
          </Box>
        </Box>
        {repo.description && (
          <Box
            sx={{
              ...c.type.callout,
              color: c.text.secondary,
              mt: '6px',
              lineHeight: 1.45,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {repo.description}
          </Box>
        )}
        {repo.pushed_at && (
          <Box
            title={absoluteTime(repo.pushed_at)}
            sx={{ ...c.type.caption, color: c.text.muted, mt: '6px' }}
          >
            updated {relativeTime(repo.pushed_at)}
          </Box>
        )}
      </Box>

      <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {installed ? (
          <Box
            sx={{
              ...pushButton(c),
              gap: '4px',
              color: c.status.success,
              borderColor: c.border.subtle,
              cursor: 'default',
              '&:hover': { background: c.bg.elevated },
            }}
            title="Already installed on this machine"
          >
            <CheckRoundedIcon sx={{ fontSize: 14 }} />
            Installed
          </Box>
        ) : (
          <ButtonBase
            onClick={onInstall}
            disabled={installing}
            sx={{
              ...primaryButton(c),
              gap: '4px',
            }}
          >
            {installing ? (
              <CircularProgress size={11} sx={{ color: "#FFFFFF" }} />
            ) : (
              <>
                <CloudDownloadRoundedIcon sx={{ fontSize: 14 }} />
                Install
              </>
            )}
          </ButtonBase>
        )}
      </Box>
    </Box>
  );
};

export default CloudSheet;
