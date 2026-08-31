import React, { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import InputBase from '@mui/material/InputBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { popover, primaryButton, pushButton, slimScroll, sunkenField } from '@/shared/styles/ui';
import {
  GITGRAPH_ICON_CONFIG_URL,
  GITGRAPH_ICON_URL,
  gitgraphIconApplyUrl,
  gitgraphIconJobUrl,
} from '@/shared/state/API_ENDPOINTS';
import IconSettingsSheet from '@/components/IconSettingsSheet';

interface Props {
  workspaceId: string;
  appName: string;
  /** Seeds the prompt so one-click generation carries the app's own context. */
  appDescription?: string;
  /** A fresh apply commits a file, so the graph above has to redraw. */
  onApplied?: () => void;
  /**
   * Route the gear / "Global defaults" affordances to the Settings tab, which
   * now owns the icon config. Without it, they fall back to the inline sheet.
   */
  onOpenSettings?: () => void;
}

interface IconResult {
  engine: string;
  style: string;
  ok: boolean;
  error: string;
  svg: string;
  data_uri: string;
}

interface IconJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  results: IconResult[];
  error: string;
}

const MODELS = ['haiku', 'sonnet', 'opus'] as const;

const IconPanel: React.FC<Props> = ({
  workspaceId,
  appName,
  appDescription,
  onApplied,
  onOpenSettings,
}) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  // Every generation parameter is now driven entirely by the saved global
  // defaults — there is no per-run editing surface. The prompt still seeds from
  // the app's own description/name so one-click generation carries context.
  const [prompt, setPrompt] = useState('');
  const [styles, setStyles] = useState<string[]>(['flat']);
  const [engines, setEngines] = useState<string[]>(['svg']);
  const [model, setModel] = useState<(typeof MODELS)[number]>('haiku');

  // A live, throwaway line the user appends to the prompt for this generation
  // only. Never persisted; it rides along on the request and is gone on reload.
  const [nudge, setNudge] = useState('');

  const [job, setJob] = useState<IconJob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pollRef = useRef<number | null>(null);
  const oneClickRef = useRef(false);

  // Pull the global defaults that a one-click generate will use. Runs on mount
  // and again whenever the settings sheet saves.
  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(GITGRAPH_ICON_CONFIG_URL);
      const data = await res.json();
      if (Array.isArray(data?.default_styles) && data.default_styles.length)
        setStyles(data.default_styles);
      if (Array.isArray(data?.default_engines) && data.default_engines.length)
        setEngines(data.default_engines);
      const m = (data?.default_model || '').toLowerCase();
      if ((MODELS as readonly string[]).includes(m))
        setModel(m as (typeof MODELS)[number]);
    } catch {
      /* keep the built-in fallbacks */
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // A new entity clears the last run and re-seeds the prompt from the app's own
  // name/description so one app's context can't leak into another.
  useEffect(() => {
    setJob(null);
    setError(null);
    setDone(null);
    setNudge('');
    setPrompt((appDescription || appName || '').trim());
  }, [workspaceId, appDescription, appName]);

  useEffect(
    () => () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    },
    [],
  );

  const poll = useCallback((jobId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(gitgraphIconJobUrl(jobId));
        const data = await res.json();
        const j: IconJob | null = data?.job ?? null;
        if (!j) return;
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
          if (j.status === 'failed') setError(j.error || 'Generation failed.');
        }
      } catch {
        /* transient; keep polling */
      }
    }, 1500);
  }, []);

  const generate = async () => {
    if (!prompt.trim() && !appName.trim()) {
      setError('This app has no name or description to build an icon from.');
      return;
    }
    setGenerating(true);
    setError(null);
    setDone(null);
    setJob(null);
    // Fold the ephemeral nudge onto the end of the prompt for this run only.
    const finalPrompt = [prompt.trim(), nudge.trim()].filter(Boolean).join('\n\n');
    try {
      const res = await fetch(GITGRAPH_ICON_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          styles,
          engines,
          title: appName,
          model,
          entity_id: workspaceId,
        }),
      });
      const data = await res.json();
      if (!data?.ok || !data?.job) {
        throw new Error(data?.error || 'Could not start generation.');
      }
      setJob(data.job);
      poll(data.job.id);
    } catch (e) {
      setGenerating(false);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const apply = async (r: IconResult, idx: number) => {
    setApplyingIdx(idx);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(gitgraphIconApplyUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_uri: r.data_uri,
          message: `Set app icon (${r.engine}${r.style ? `/${r.style}` : ''})`,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof data?.detail === 'string' ? data.detail : `Failed (${res.status})`,
        );
      }
      setDone(`Committed ${data?.icon_path ?? 'icon'}. Push to send it to GitHub.`);
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply that icon.');
    } finally {
      setApplyingIdx(null);
    }
  };

  const results = (job?.results ?? []).filter(r => r.ok && r.data_uri);
  const failed = (job?.results ?? []).filter(r => !r.ok);

  // One click: generate straight away with the saved global defaults, opening
  // the popover so progress and results are visible. The gear opens the global
  // defaults sheet directly — there is no per-run configuration.
  const oneClick = (e: React.MouseEvent<HTMLElement>) => {
    oneClickRef.current = true;
    setAnchor(e.currentTarget);
  };

  // Fire the one-click generation once the popover is anchored, so `generate`
  // runs against the mounted panel rather than racing the state update.
  useEffect(() => {
    if (anchor && oneClickRef.current) {
      oneClickRef.current = false;
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  return (
    <>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'stretch',
          borderRadius: `${c.radius.sm}px`,
          overflow: 'hidden',
          border: `1px solid ${c.border.medium}`,
        }}
      >
        <ButtonBase
          onClick={oneClick}
          sx={{
            ...pushButton(c),
            color: c.text.secondary,
            gap: '4px',
            border: 'none',
            borderRadius: 0,
          }}
          title="Generate an icon now with your saved defaults"
        >
          <AutoAwesomeRoundedIcon sx={{ fontSize: 16 }} />
          Icon
        </ButtonBase>
        <ButtonBase
          onClick={e => setAnchor(e.currentTarget)}
          sx={{
            ...pushButton(c),
            color: nudge.trim() ? c.accent.primary : c.text.secondary,
            px: '6px',
            border: 'none',
            borderLeft: `1px solid ${c.border.medium}`,
            borderRadius: 0,
          }}
          title="Add a live nudge appended to the prompt for this generation"
        >
          <EditRoundedIcon sx={{ fontSize: 15 }} />
        </ButtonBase>
      </Box>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => !generating && applyingIdx === null && setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { ...popover(c), mt: 0.5, width: 360 } } }}
      >
        <Box
          sx={{
            px: 1.5,
            py: '8px',
            borderBottom: `1px solid ${c.border.subtle}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <Typography sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
            App icon
          </Typography>
          <ButtonBase
            onClick={() => {
              if (onOpenSettings) {
                setAnchor(null);
                onOpenSettings();
              } else {
                setSettingsOpen(true);
              }
            }}
            sx={{
              ...c.type.caption,
              color: c.accent.primary,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              px: '4px',
              borderRadius: `${c.radius.sm}px`,
              '&:hover': { background: c.bg.secondary },
            }}
            title="Edit the global defaults and view the raw prompt templates"
          >
            <TuneRoundedIcon sx={{ fontSize: 14 }} />
            Global defaults
          </ButtonBase>
        </Box>

        <Box
          sx={{
            p: 1.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            maxHeight: 460,
            overflowY: 'auto',
            ...slimScroll(c),
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
              Live nudge (appended to the prompt, this run only)
            </Typography>
            <InputBase
              value={nudge}
              onChange={e => setNudge(e.target.value)}
              multiline
              minRows={2}
              maxRows={4}
              placeholder="e.g. bolder outline, warmer palette, no text"
              sx={{
                ...sunkenField(c),
                ...c.type.body,
                color: c.text.primary,
                px: 1,
                py: '6px',
                '& textarea': { ...slimScroll(c) },
              }}
            />
          </Box>

          <ButtonBase
            disabled={generating}
            onClick={() => void generate()}
            sx={{ ...primaryButton(c) }}
          >
            {generating ? (
              <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
            ) : job ? (
              'Generate again'
            ) : (
              'Generate'
            )}
          </ButtonBase>

          {generating && (
            <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
              Generating {engines.length}×{styles.length || 1} candidate
              {engines.length * (styles.length || 1) === 1 ? '' : 's'} from your
              defaults…
            </Typography>
          )}

          {results.length > 0 && (
            <>
              <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                Pick one to commit it into the repo
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 0.75,
                }}
              >
                {results.map((r, idx) => (
                  <ButtonBase
                    key={`${r.engine}-${r.style}-${idx}`}
                    disabled={applyingIdx !== null}
                    onClick={() => void apply(r, idx)}
                    sx={{
                      position: 'relative',
                      aspectRatio: '1 / 1',
                      borderRadius: `${c.radius.sm}px`,
                      border: `1px solid ${c.border.medium}`,
                      overflow: 'hidden',
                      background: '#FFFFFF',
                      '&:hover': { borderColor: c.accent.primary },
                    }}
                    title={`${r.engine}${r.style ? ` · ${r.style}` : ''} — click to commit`}
                  >
                    <Box
                      component="img"
                      src={r.data_uri}
                      alt={`${r.engine} ${r.style}`}
                      sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                    {applyingIdx === idx && (
                      <Box
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(0,0,0,0.35)',
                        }}
                      >
                        <CircularProgress size={16} sx={{ color: '#FFFFFF' }} />
                      </Box>
                    )}
                  </ButtonBase>
                ))}
              </Box>
            </>
          )}

          {failed.length > 0 && (
            <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
              {failed.length} candidate{failed.length === 1 ? '' : 's'} failed:{' '}
              {failed[0].error}
            </Typography>
          )}

          {error && (
            <Typography sx={{ ...c.type.caption, color: c.status.error }}>
              {error}
            </Typography>
          )}
          {done && !error && (
            <Typography sx={{ ...c.type.caption, color: c.status.success }}>
              {done}
            </Typography>
          )}
        </Box>
      </Popover>

      <IconSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        // Saving new defaults reseeds what a fresh one-click generate will use.
        onSaved={() => void loadConfig()}
      />
    </>
  );
};

export default IconPanel;
