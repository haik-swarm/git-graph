import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded';
import GitHubIcon from '@mui/icons-material/GitHub';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { pushButton, sunkenField } from '@/shared/styles/ui';
import { gitgraphLocalDeleteUrl } from '@/shared/state/API_ENDPOINTS';

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  appName: string;
  hasRemote: boolean;
  remoteHtmlUrl: string | null;
  onDeleted: (workspaceId: string) => void;
}

/**
 * Two-button local delete confirm. Requires typing the app name so a
 * misclick can't wipe a workspace; also surfaces a "Delete on GitHub"
 * shortcut for synced apps so the user can finish the job upstream in one
 * flow instead of hunting for repo settings later.
 */
const DeleteAppDialog: React.FC<Props> = ({
  open,
  onClose,
  workspaceId,
  appName,
  hasRemote,
  remoteHtmlUrl,
  onDeleted,
}) => {
  const c = useClaudeTokens();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTyped('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const canDelete = typed.trim().toLowerCase() === appName.trim().toLowerCase();

  const deleteLocal = async () => {
    if (!canDelete || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(gitgraphLocalDeleteUrl(workspaceId), {
        method: 'POST',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `delete ${res.status}`);
      onDeleted(workspaceId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't delete that.");
    } finally {
      setBusy(false);
    }
  };

  const githubDeleteHref = remoteHtmlUrl ? `${remoteHtmlUrl}/settings#danger-zone` : null;

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      slotProps={{
        backdrop: { sx: { background: 'rgba(0,0,0,0.35)' } },
        paper: {
          sx: {
            background: c.bg.page,
            backgroundImage: 'none',
            border: `1px solid ${c.border.subtle}`,
            borderRadius: `${c.radius.xl}px`,
            boxShadow: c.shadow.lg,
            width: 460,
            maxWidth: '92vw',
          },
        },
      }}
    >
      <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: `${c.radius.md}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: c.status.errorBg,
              color: c.status.error,
            }}
          >
            <DeleteForeverRoundedIcon sx={{ fontSize: 18 }} />
          </Box>
          <Box sx={{ ...c.type.headline, color: c.text.primary }}>
            Delete {appName}?
          </Box>
        </Box>

        <Box sx={{ ...c.type.body, color: c.text.secondary, lineHeight: 1.5 }}>
          Removes the workspace and the dashboard entry on this machine.
          Uncommitted changes will be lost.
          {hasRemote && (
            <>
              {' '}The GitHub repo is <b>not</b> deleted — the app will still
              show up in Your cloud, and you can reinstall it from there.
            </>
          )}
        </Box>

        <Box>
          <Box sx={{ ...c.type.caption, color: c.text.tertiary, mb: '4px' }}>
            Type <b>{appName}</b> to confirm
          </Box>
          <InputBase
            value={typed}
            onChange={e => setTyped(e.target.value)}
            autoFocus
            sx={{
              ...sunkenField(c),
              width: '100%',
              px: 1,
              py: '5px',
              ...c.type.body,
              color: c.text.primary,
            }}
          />
        </Box>

        {error && (
          <Box sx={{ ...c.type.caption, color: c.status.error }}>{error}</Box>
        )}

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mt: '4px',
            flexWrap: 'wrap',
          }}
        >
          {githubDeleteHref && (
            <Box
              component="a"
              href={githubDeleteHref}
              target="_blank"
              rel="noreferrer"
              sx={{
                ...pushButton(c),
                textDecoration: 'none',
              }}
              title="Open the GitHub repo's Danger Zone in a new tab"
            >
              <GitHubIcon sx={{ fontSize: 16 }} />
              Delete on GitHub
              <OpenInNewIcon sx={{ fontSize: 14 }} />
            </Box>
          )}

          <Box sx={{ flex: 1 }} />

          <ButtonBase
            onClick={onClose}
            disabled={busy}
            sx={{ ...pushButton(c) }}
          >
            Cancel
          </ButtonBase>
          <ButtonBase
            onClick={() => void deleteLocal()}
            disabled={!canDelete || busy}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              height: 28,
              px: '14px',
              cursor: 'pointer',
              fontFamily: c.font.sans,
              ...c.type.callout,
              fontWeight: 590,
              color: "#FFFFFF",
              background: c.status.error,
              border: 'none',
              borderRadius: `${c.radius.sm}px`,
              boxShadow: c.shadow.sm,
              transition: c.transition,
              '&:hover': { opacity: 0.9 },
              '&:disabled': { opacity: 0.45, cursor: 'default' },
            }}
          >
            {busy ? (
              <CircularProgress size={12} sx={{ color: "#FFFFFF" }} />
            ) : (
              'Delete forever'
            )}
          </ButtonBase>
        </Box>
      </Box>
    </Dialog>
  );
};

export default DeleteAppDialog;
