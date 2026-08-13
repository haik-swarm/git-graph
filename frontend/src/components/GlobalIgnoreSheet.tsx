import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CheckIcon from '@mui/icons-material/Check';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { primaryButton, pushButton, slimScroll, sunkenField } from '@/shared/styles/ui';
import { BrandGlyph } from '@/components/Chrome';
import {
  GITGRAPH_GLOBAL_IGNORE_URL,
  gitgraphGlobalIgnoreToggleUrl,
} from '@/shared/state/API_ENDPOINTS';

interface AppRow {
  workspace_id: string;
  name: string;
  included: boolean;
}

interface State {
  content: string;
  apps: AppRow[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const GlobalIgnoreSheet: React.FC<Props> = ({ open, onClose, onSaved }) => {
  const c = useClaudeTokens();
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggleBusy, setToggleBusy] = useState<Set<string>>(() => new Set());
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(GITGRAPH_GLOBAL_IGNORE_URL);
      if (!res.ok) throw new Error(`load ${res.status}`);
      const data: State = await res.json();
      setState(data);
      setDraft(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load that.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    else {
      // Reset so the next open shows fresh state, not last session's draft.
      setState(null);
      setDraft('');
      setError(null);
      setSavedFlash(false);
    }
  }, [open, load]);

  const dirty = state ? draft !== state.content : false;
  const includedCount = state?.apps.filter(a => a.included).length ?? 0;

  const save = async () => {
    if (!state || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(GITGRAPH_GLOBAL_IGNORE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `save ${res.status}`);
      }
      setState(prev => (prev ? { ...prev, content: draft } : prev));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that.");
    } finally {
      setSaving(false);
    }
  };

  const toggleApp = async (row: AppRow) => {
    setToggleBusy(prev => {
      const next = new Set(prev);
      next.add(row.workspace_id);
      return next;
    });
    try {
      const res = await fetch(gitgraphGlobalIgnoreToggleUrl(row.workspace_id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ included: !row.included }),
      });
      if (!res.ok) throw new Error(`toggle ${res.status}`);
      setState(prev =>
        prev
          ? {
              ...prev,
              apps: prev.apps.map(a =>
                a.workspace_id === row.workspace_id
                  ? { ...a, included: !row.included }
                  : a,
              ),
            }
          : prev,
      );
      onSaved();
    } catch {
      /* Row stays visually as it was; next open re-reads truth from disk. */
    } finally {
      setToggleBusy(prev => {
        const next = new Set(prev);
        next.delete(row.workspace_id);
        return next;
      });
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      hideBackdrop={false}
      slotProps={{
        backdrop: { sx: { background: 'rgba(0,0,0,0.35)' } },
        paper: {
          sx: {
            width: 560,
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
        <Box sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
          Global .gitignore
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

      {loading ? (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CircularProgress size={20} sx={{ color: c.text.tertiary }} />
        </Box>
      ) : error && !state ? (
        <Box sx={{ p: 3, ...c.type.body, color: c.status.error }}>{error}</Box>
      ) : state ? (
        <>
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
            One list, mirrored into every tracked app as a managed block at
            the top of its <code>.gitignore</code>. Any app-specific rules
            below the block are yours; they're never overwritten.
          </Box>

          <Box sx={{ px: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <InputBase
              multiline
              value={draft}
              onChange={e => setDraft(e.target.value)}
              spellCheck={false}
              sx={{
                ...sunkenField(c),
                flex: 1,
                minHeight: 220,
                alignItems: 'flex-start',
                p: 1.25,
                fontFamily: c.font.mono,
                fontSize: '12.5px',
                lineHeight: 1.55,
                color: c.text.primary,
                '& textarea': {
                  height: '100% !important',
                  overflow: 'auto !important',
                  ...slimScroll(c),
                },
              }}
            />
          </Box>

          <Box sx={{ px: 2, pt: 1.25, pb: 1 }}>
            <Box
              sx={{
                ...c.type.headline,
                color: c.text.primary,
                display: 'flex',
                alignItems: 'baseline',
                gap: 1,
              }}
            >
              <Box>Applies to</Box>
              <Box sx={{ flex: 1 }} />
              <Box sx={{ ...c.type.caption, color: c.text.muted, fontWeight: 400 }}>
                {includedCount} of {state.apps.length} apps
              </Box>
            </Box>
          </Box>

          <Box sx={{ px: '10px', pb: 1, maxHeight: 220, overflowY: 'auto', ...slimScroll(c) }}>
            {state.apps.length === 0 ? (
              <Box sx={{ p: 2, ...c.type.body, color: c.text.tertiary }}>
                No tracked apps yet. Track an app from the Home grid and it
                will inherit these rules automatically.
              </Box>
            ) : (
              state.apps.map(app => {
                const busy = toggleBusy.has(app.workspace_id);
                return (
                  <Box
                    key={app.workspace_id}
                    component="button"
                    onClick={() => !busy && void toggleApp(app)}
                    disabled={busy}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      width: '100%',
                      px: '8px',
                      py: '7px',
                      border: 'none',
                      background: 'transparent',
                      cursor: busy ? 'default' : 'pointer',
                      textAlign: 'left',
                      borderRadius: `${c.radius.sm}px`,
                      '&:hover': { background: busy ? 'transparent' : c.bg.secondary },
                    }}
                  >
                    <Box
                      sx={{
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        borderRadius: `${c.radius.xs}px`,
                        border: `1px solid ${app.included ? c.accent.primary : c.border.subtle}`,
                        background: app.included ? c.accent.primary : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {app.included && (
                        <CheckIcon sx={{ fontSize: 14, color: "#FFFFFF" }} />
                      )}
                    </Box>
                    <BrandGlyph
                      seed={app.workspace_id}
                      letter={app.name[0] || '?'}
                      size={22}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box
                        sx={{
                          ...c.type.body,
                          color: c.text.primary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {app.name}
                      </Box>
                      <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                        {app.included ? 'block synced' : 'opted out'}
                      </Box>
                    </Box>
                    {busy ? (
                      <CircularProgress size={12} sx={{ color: c.text.tertiary }} />
                    ) : app.included ? (
                      <CheckRoundedIcon sx={{ fontSize: 14, color: c.status.success }} />
                    ) : (
                      <BlockRoundedIcon sx={{ fontSize: 14, color: c.text.tertiary }} />
                    )}
                  </Box>
                );
              })
            )}
          </Box>

          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderTop: `1px solid ${c.border.subtle}`,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexShrink: 0,
            }}
          >
            <Box sx={{ ...c.type.caption, color: c.text.tertiary, flex: 1 }}>
              {error ? (
                <Box component="span" sx={{ color: c.status.error }}>{error}</Box>
              ) : savedFlash ? (
                <Box component="span" sx={{ color: c.status.success }}>
                  Saved and synced to {includedCount} app
                  {includedCount === 1 ? '' : 's'}.
                </Box>
              ) : dirty ? (
                'Unsaved changes'
              ) : (
                'Editing the list also re-syncs every included app.'
              )}
            </Box>
            <ButtonBase onClick={onClose} sx={{ ...pushButton(c) }}>
              Close
            </ButtonBase>
            <ButtonBase
              onClick={() => void save()}
              disabled={!dirty || saving}
              sx={{ ...primaryButton(c) }}
            >
              {saving ? (
                <CircularProgress size={12} sx={{ color: "#FFFFFF" }} />
              ) : (
                'Save & sync'
              )}
            </ButtonBase>
          </Box>
        </>
      ) : null}
    </Drawer>
  );
};

export default GlobalIgnoreSheet;
