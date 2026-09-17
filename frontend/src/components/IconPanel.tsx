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
import UploadRoundedIcon from '@mui/icons-material/UploadRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
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
  /**
   * Optional custom apply. Apps commit the chosen icon into their git repo (the
   * default); a bundle has no repo, so it passes this to persist the data URI
   * its own way (a PATCH). When set, the repo-commit path is skipped entirely.
   */
  onApply?: (dataUri: string) => Promise<void> | void;
  /**
   * The heading shown in the popover ("App icon" by default). Bundles say
   * "Bundle icon" so the surface reads correctly.
   */
  heading?: string;
  /**
   * Copy under the candidate grid. Apps say "commit it into the repo"; a bundle
   * has no repo so it overrides this.
   */
  pickHint?: string;
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

// The popover opens on a chooser, then drills into one of these surfaces.
type Mode = 'menu' | 'auto' | 'custom' | 'upload';

// Committed icons are capped to this square so an uploaded photo can't land a
// multi-megabyte base64 blob in the repo.
const MAX_ICON_DIM = 512;

// Canvas can only re-encode these raster types; anything else falls back to png.
const UPLOAD_CANVAS_MIME: Record<string, string> = {
  'image/webp': 'image/webp',
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
};

// Read a local image file, downscale it to fit MAX_ICON_DIM, and return a data
// URI ready to hand to the same apply path the generated icons use. The source
// type is preserved (a webp stays webp) when the canvas can encode it; otherwise
// it falls back to png.
function fileToIconDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const src = String(reader.result || '');
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be loaded.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_ICON_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          // No canvas: fall back to the raw file, still a valid data URI.
          resolve(src);
          return;
        }
        const outMime = UPLOAD_CANVAS_MIME[file.type] || 'image/png';
        // jpeg has no alpha; paint white first so transparent source pixels
        // don't come out black.
        if (outMime === 'image/jpeg') {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);
        // quality arg is ignored by png, honored by webp/jpeg.
        resolve(canvas.toDataURL(outMime, 0.95));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

const IconPanel: React.FC<Props> = ({
  workspaceId,
  appName,
  appDescription,
  onApplied,
  onOpenSettings,
  onApply,
  heading = 'App icon',
  pickHint,
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

  // Which surface the popover is showing, plus the pending upload preview.
  const [mode, setMode] = useState<Mode>('menu');
  const [uploadUri, setUploadUri] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setUploadUri(null);
    setUploadName('');
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
      // A caller that owns persistence (e.g. a bundle, which has no repo) takes
      // the data URI and stores it itself; the repo-commit path is skipped.
      if (onApply) {
        await onApply(r.data_uri);
        setDone('Icon set.');
        onApplied?.();
        return;
      }
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

  // Open the popover on the three-way chooser, resetting any prior run so the
  // menu is clean every time.
  const openMenu = (e: React.MouseEvent<HTMLElement>) => {
    setMode('menu');
    setJob(null);
    setError(null);
    setDone(null);
    setNudge('');
    setUploadUri(null);
    setUploadName('');
    setAnchor(e.currentTarget);
  };

  // Read a picked file into a preview; committing happens on "Set as icon".
  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked later
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      const uri = await fileToIconDataUri(file);
      setUploadUri(uri);
      setUploadName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that image.');
    }
  };

  // Commit the uploaded image through the same path generated icons use: a
  // caller-owned persist (bundles) or a repo commit (apps).
  const applyUpload = async () => {
    if (!uploadUri) return;
    setUploading(true);
    setError(null);
    setDone(null);
    try {
      if (onApply) {
        await onApply(uploadUri);
        setDone('Icon set.');
        onApplied?.();
        return;
      }
      const res = await fetch(gitgraphIconApplyUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_uri: uploadUri, message: 'Set app icon (upload)' }),
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
      setUploading(false);
    }
  };

  const busy = generating || applyingIdx !== null || uploading;
  const headings: Record<Mode, string> = {
    menu: heading,
    auto: 'Auto-generate',
    custom: 'Customize',
    upload: 'Upload an image',
  };

  return (
    <>
      <ButtonBase
        onClick={openMenu}
        sx={{
          ...pushButton(c),
          color: c.text.secondary,
          gap: '4px',
        }}
        title="Set this icon — auto-generate, customize, or upload"
      >
        <AutoAwesomeRoundedIcon sx={{ fontSize: 16 }} />
        Icon
      </ButtonBase>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => !busy && setAnchor(null)}
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
          {mode !== 'menu' && (
            <ButtonBase
              onClick={() => !busy && setMode('menu')}
              disabled={busy}
              sx={{
                color: c.text.secondary,
                borderRadius: `${c.radius.sm}px`,
                p: '2px',
                '&:hover': { background: c.bg.secondary },
              }}
              title="Back to options"
            >
              <ArrowBackRoundedIcon sx={{ fontSize: 16 }} />
            </ButtonBase>
          )}
          <Typography sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
            {headings[mode]}
          </Typography>
          {(mode === 'auto' || mode === 'custom') && (
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
          )}
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
          {mode === 'menu' &&
            (
              [
                {
                  key: 'auto',
                  icon: <AutoAwesomeRoundedIcon sx={{ fontSize: 18 }} />,
                  title: 'Auto',
                  desc: 'Generate an icon from your saved defaults',
                  onClick: () => {
                    setNudge('');
                    setMode('auto');
                    void generate();
                  },
                },
                {
                  key: 'custom',
                  icon: <EditRoundedIcon sx={{ fontSize: 18 }} />,
                  title: 'Custom',
                  desc: 'Add a nudge, then generate variations to pick from',
                  onClick: () => setMode('custom'),
                },
                {
                  key: 'upload',
                  icon: <UploadRoundedIcon sx={{ fontSize: 18 }} />,
                  title: 'Upload',
                  desc: 'Use an image from your device',
                  onClick: () => setMode('upload'),
                },
              ] as const
            ).map(opt => (
              <ButtonBase
                key={opt.key}
                onClick={opt.onClick}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  width: '100%',
                  textAlign: 'left',
                  p: 1,
                  borderRadius: `${c.radius.sm}px`,
                  border: `1px solid ${c.border.medium}`,
                  color: c.text.primary,
                  '&:hover': { borderColor: c.accent.primary, background: c.bg.secondary },
                }}
              >
                <Box sx={{ color: c.accent.primary, display: 'inline-flex' }}>{opt.icon}</Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ ...c.type.body, color: c.text.primary }}>
                    {opt.title}
                  </Typography>
                  <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                    {opt.desc}
                  </Typography>
                </Box>
                <ChevronRightRoundedIcon sx={{ fontSize: 18, color: c.text.tertiary }} />
              </ButtonBase>
            ))}

          {mode === 'custom' && (
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
          )}

          {(mode === 'auto' || mode === 'custom') && (
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
          )}

          {mode === 'upload' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => void onFilePicked(e)}
              />
              {uploadUri && (
                <Box
                  sx={{
                    alignSelf: 'center',
                    width: 96,
                    height: 96,
                    borderRadius: `${c.radius.sm}px`,
                    border: `1px solid ${c.border.medium}`,
                    overflow: 'hidden',
                    background: '#FFFFFF',
                  }}
                >
                  <Box
                    component="img"
                    src={uploadUri}
                    alt={uploadName || 'Selected image'}
                    sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                </Box>
              )}
              <ButtonBase
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                sx={{ ...pushButton(c), gap: '4px' }}
              >
                <UploadRoundedIcon sx={{ fontSize: 16 }} />
                {uploadUri ? 'Choose a different image' : 'Choose an image…'}
              </ButtonBase>
              {uploadUri && (
                <ButtonBase
                  disabled={uploading}
                  onClick={() => void applyUpload()}
                  sx={{ ...primaryButton(c) }}
                >
                  {uploading ? (
                    <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
                  ) : (
                    'Set as icon'
                  )}
                </ButtonBase>
              )}
              <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                {pickHint
                  ? 'Your image is resized to a square-safe 512px, then set as the icon.'
                  : 'Your image is resized to 512px and committed as the icon. Push to send it to GitHub.'}
              </Typography>
            </>
          )}

          {generating && (
            <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
              Generating {engines.length}×{styles.length || 1} candidate
              {engines.length * (styles.length || 1) === 1 ? '' : 's'} from your
              defaults…
            </Typography>
          )}

          {(mode === 'auto' || mode === 'custom') && results.length > 0 && (
            <>
              <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                {pickHint ?? 'Pick one to commit it into the repo'}
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

          {(mode === 'auto' || mode === 'custom') && failed.length > 0 && (
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
