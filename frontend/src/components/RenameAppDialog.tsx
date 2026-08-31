import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import InputBase from '@mui/material/InputBase';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { pushButton, primaryButton, sunkenField, slimScroll } from '@/shared/styles/ui';
import { gitgraphRenamePreviewUrl, gitgraphRenameUrl } from '@/shared/state/API_ENDPOINTS';

interface FileRef {
  path: string;
  name_hits: number;
  slug_hits: number;
}

interface Preview {
  old_name: string;
  new_name: string;
  old_slug: string | null;
  new_slug: string | null;
  has_remote: boolean;
  slug_would_change: boolean;
  files: FileRef[];
}

interface Step {
  step: string;
  ok: boolean;
  skipped: boolean;
  detail: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  appName: string;
  hasRemote: boolean;
  /** Called after a successful rename with the new display name. */
  onRenamed: (newName: string) => void;
}

/**
 * Rename an app everywhere its name lives. The rename is metadata-only by
 * default (registry, host, meta.json, GitHub description); moving the GitHub
 * repo slug and rewriting the name inside tracked files are explicit opt-ins,
 * because those are the surfaces with real consequences. File rewrites land
 * as an uncommitted diff the user reviews in the graph — nothing is committed.
 */
const RenameAppDialog: React.FC<Props> = ({
  open,
  onClose,
  workspaceId,
  appName,
  hasRemote,
  onRenamed,
}) => {
  const c = useClaudeTokens();
  const [name, setName] = useState(appName);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [renameRemote, setRenameRemote] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);

  useEffect(() => {
    if (open) {
      setName(appName);
      setPreview(null);
      setRenameRemote(true);
      setPicked(new Set());
      setBusy(false);
      setError(null);
      setSteps(null);
    }
  }, [open, appName]);

  // Debounced dry-run: re-ask the backend what the typed name would touch.
  useEffect(() => {
    if (!open) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewBusy(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(gitgraphRenamePreviewUrl(workspaceId), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_name: trimmed }),
          });
          const data = await res.json().catch(() => null);
          if (cancelled) return;
          if (!res.ok) {
            setPreview(null);
            return;
          }
          setPreview(data);
          // Default to rewriting every file that mentions the old name.
          setPicked(new Set((data?.files ?? []).map((f: FileRef) => f.path)));
        } finally {
          if (!cancelled) setPreviewBusy(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [name, open, workspaceId]);

  const changed = name.trim() && name.trim() !== appName.trim();
  const canRename = Boolean(changed) && !busy;

  const togglePath = (path: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const doRename = async () => {
    if (!canRename) return;
    setBusy(true);
    setError(null);
    setSteps(null);
    try {
      const res = await fetch(gitgraphRenameUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_name: name.trim(),
          rename_remote: renameRemote,
          rewrite_paths: Array.from(picked),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `rename ${res.status}`);
      if (Array.isArray(data?.steps)) setSteps(data.steps);
      onRenamed(name.trim());
      // Leave the dialog open briefly so the per-step report is visible; the
      // parent has already refreshed. Close on the user's next action.
      if (Array.isArray(data?.steps) && data.steps.every((s: Step) => s.ok)) {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't rename that.");
    } finally {
      setBusy(false);
    }
  };

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
            width: 500,
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
              background: `rgba(${c.accentRgb},0.12)`,
              color: c.accent.primary,
            }}
          >
            <DriveFileRenameOutlineRoundedIcon sx={{ fontSize: 18 }} />
          </Box>
          <Box sx={{ ...c.type.headline, color: c.text.primary }}>
            Rename {appName}
          </Box>
        </Box>

        <Box>
          <Box sx={{ ...c.type.caption, color: c.text.tertiary, mb: '4px' }}>
            New name
          </Box>
          <InputBase
            value={name}
            onChange={e => setName(e.target.value)}
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

        <Box sx={{ ...c.type.body, color: c.text.secondary, lineHeight: 1.5 }}>
          Updates the name on your dashboard, in this app's{' '}
          <code>meta.json</code>
          {hasRemote && ', and in its GitHub description'}. This part is safe
          and reversible.
        </Box>

        {hasRemote && preview?.slug_would_change && (
          <Box
            component="label"
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1,
              px: 1.25,
              py: 1,
              borderRadius: `${c.radius.md}px`,
              background: c.bg.secondary,
              border: `1px solid ${c.border.subtle}`,
              cursor: 'pointer',
            }}
          >
            <Checkbox
              checked={renameRemote}
              onChange={e => setRenameRemote(e.target.checked)}
              size="small"
              sx={{ p: 0, mt: '2px', color: c.text.tertiary }}
            />
            <Box>
              <Box sx={{ ...c.type.callout, color: c.text.primary }}>
                Also rename the GitHub repo
              </Box>
              <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: '2px' }}>
                <code>{preview.old_slug?.split('/').pop()}</code> →{' '}
                <code>{preview.new_slug}</code>. GitHub keeps a permanent
                redirect, so collaborators' clones keep working.
              </Box>
            </Box>
          </Box>
        )}

        {preview && preview.files.length > 0 && (
          <Box>
            <Box sx={{ ...c.type.caption, color: c.text.tertiary, mb: '4px' }}>
              These tracked files mention the old name or slug. Pick which to
              rewrite — the changes land as an uncommitted diff you review.
            </Box>
            <Box
              sx={{
                ...slimScroll(c),
                maxHeight: 168,
                overflowY: 'auto',
                border: `1px solid ${c.border.subtle}`,
                borderRadius: `${c.radius.md}px`,
              }}
            >
              {preview.files.map(f => (
                <Box
                  key={f.path}
                  component="label"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: '5px',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${c.border.subtle}`,
                    '&:last-of-type': { borderBottom: 'none' },
                    '&:hover': { background: c.bg.secondary },
                  }}
                >
                  <Checkbox
                    checked={picked.has(f.path)}
                    onChange={() => togglePath(f.path)}
                    size="small"
                    sx={{ p: 0, color: c.text.tertiary }}
                  />
                  <Box
                    sx={{
                      ...c.type.caption,
                      fontFamily: c.font.mono,
                      color: c.text.primary,
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.path}
                  </Box>
                  <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                    {f.name_hits + f.slug_hits}×
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {previewBusy && !preview && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={12} sx={{ color: c.text.tertiary }} />
            <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
              Checking what this would touch…
            </Box>
          </Box>
        )}

        {steps && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
              px: 1.25,
              py: 1,
              borderRadius: `${c.radius.md}px`,
              background: c.bg.secondary,
              border: `1px solid ${c.border.subtle}`,
            }}
          >
            {steps.map(s => (
              <Box
                key={s.step}
                sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {s.skipped ? (
                  <RemoveCircleOutlineRoundedIcon
                    sx={{ fontSize: 14, color: c.text.tertiary }}
                  />
                ) : s.ok ? (
                  <CheckCircleRoundedIcon
                    sx={{ fontSize: 14, color: c.status.success }}
                  />
                ) : (
                  <ErrorOutlineRoundedIcon
                    sx={{ fontSize: 14, color: c.status.error }}
                  />
                )}
                <Box
                  sx={{
                    ...c.type.caption,
                    fontFamily: c.font.mono,
                    color: c.text.secondary,
                  }}
                >
                  {s.step}
                </Box>
                <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                  {s.detail}
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {error && (
          <Box sx={{ ...c.type.caption, color: c.status.error }}>{error}</Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: '4px' }}>
          <Box sx={{ flex: 1 }} />
          <ButtonBase onClick={onClose} disabled={busy} sx={{ ...pushButton(c) }}>
            {steps ? 'Close' : 'Cancel'}
          </ButtonBase>
          <ButtonBase
            onClick={() => void doRename()}
            disabled={!canRename}
            sx={{
              ...primaryButton(c),
              '&:disabled': { opacity: 0.45, cursor: 'default' },
            }}
          >
            {busy ? (
              <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
            ) : (
              'Rename'
            )}
          </ButtonBase>
        </Box>
      </Box>
    </Dialog>
  );
};

export default RenameAppDialog;
