import React, { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  popover,
  primaryButton,
  pushButton,
  slimScroll,
  sunkenField,
} from '@/shared/styles/ui';
import {
  GITGRAPH_ICON_CONFIG_URL,
  GITGRAPH_ICON_URL,
  gitgraphIconApplyUrl,
  gitgraphIconJobUrl,
} from '@/shared/state/API_ENDPOINTS';

interface Props {
  workspaceId: string;
  appName: string;
  /** A fresh apply commits a file, so the graph above has to redraw. */
  onApplied?: () => void;
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

const STYLES = ['flat', 'gradient', 'line', '3d', 'monochrome', 'playful'];
const MODELS = ['haiku', 'sonnet', 'opus'] as const;

const IconPanel: React.FC<Props> = ({ workspaceId, appName, onApplied }) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [prompt, setPrompt] = useState('');
  const [styles, setStyles] = useState<string[]>(['flat']);
  const [engines, setEngines] = useState<string[]>(['svg']);
  const [model, setModel] = useState<(typeof MODELS)[number]>('haiku');
  const [keySet, setKeySet] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  const [job, setJob] = useState<IconJob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(GITGRAPH_ICON_CONFIG_URL);
      const data = await res.json();
      setKeySet(Boolean(data?.openai_key_set));
    } catch {
      setKeySet(false);
    }
  }, []);

  useEffect(() => {
    if (anchor) void loadConfig();
  }, [anchor, loadConfig]);

  // A new entity resets the draft so one app's prompt can't leak into another.
  useEffect(() => {
    setJob(null);
    setError(null);
    setDone(null);
  }, [workspaceId]);

  useEffect(
    () => () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    },
    [],
  );

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    set(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
  };

  const saveKey = async () => {
    setSavingKey(true);
    setError(null);
    try {
      const res = await fetch(GITGRAPH_ICON_CONFIG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openai_api_key: apiKey.trim() }),
      });
      const data = await res.json();
      setKeySet(Boolean(data?.openai_key_set));
      setApiKey('');
    } catch {
      setError('Could not save the key.');
    } finally {
      setSavingKey(false);
    }
  };

  const poll = useCallback(
    (jobId: string) => {
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
    },
    [],
  );

  const generate = async () => {
    if (!prompt.trim() && !appName.trim()) {
      setError('Describe the icon first.');
      return;
    }
    setGenerating(true);
    setError(null);
    setDone(null);
    setJob(null);
    try {
      const res = await fetch(GITGRAPH_ICON_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
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
  const needsKey = engines.includes('image') && !keySet;

  const chip = (active: boolean) => ({
    ...c.type.caption,
    px: 1,
    py: '3px',
    borderRadius: `${c.radius.sm}px`,
    border: `1px solid ${active ? c.accent.primary : c.border.medium}`,
    color: active ? c.accent.primary : c.text.secondary,
    background: active ? c.bg.secondary : 'transparent',
    cursor: 'pointer',
  });

  return (
    <>
      <ButtonBase
        onClick={e => setAnchor(e.currentTarget)}
        sx={{ ...pushButton(c), color: c.text.secondary, gap: '4px' }}
        title="Generate and commit an icon for this app"
      >
        <AutoAwesomeRoundedIcon sx={{ fontSize: 16 }} />
        Icon
      </ButtonBase>

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
          }}
        >
          <Typography sx={{ ...c.type.headline, color: c.text.primary }}>
            App icon
          </Typography>
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
          <InputBase
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={`Describe an icon for ${appName || 'this app'}…`}
            multiline
            minRows={2}
            sx={{
              ...sunkenField(c),
              ...c.type.body,
              color: c.text.primary,
              px: 1,
              py: '6px',
            }}
          />

          <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
            Styles
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {STYLES.map(s => (
              <Box
                key={s}
                onClick={() => toggle(styles, setStyles, s)}
                sx={chip(styles.includes(s))}
              >
                {s}
              </Box>
            ))}
          </Box>

          <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
            Engine
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Box
              onClick={() => toggle(engines, setEngines, 'svg')}
              sx={chip(engines.includes('svg'))}
            >
              SVG (host model)
            </Box>
            <Box
              onClick={() => toggle(engines, setEngines, 'image')}
              sx={chip(engines.includes('image'))}
            >
              AI image (gpt-image)
            </Box>
          </Box>

          {engines.includes('svg') && (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                Model
              </Typography>
              {MODELS.map(m => (
                <Box key={m} onClick={() => setModel(m)} sx={chip(model === m)}>
                  {m}
                </Box>
              ))}
            </Box>
          )}

          {needsKey && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
                p: 1,
                borderRadius: `${c.radius.sm}px`,
                background: c.bg.secondary,
                border: `1px solid ${c.border.subtle}`,
              }}
            >
              <Typography sx={{ ...c.type.caption, color: c.text.secondary }}>
                The AI-image engine needs an OpenAI API key.
              </Typography>
              <InputBase
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-…"
                type="password"
                sx={{
                  ...sunkenField(c),
                  ...c.type.body,
                  fontFamily: c.font.mono,
                  color: c.text.primary,
                  px: 1,
                  py: '5px',
                }}
              />
              <ButtonBase
                disabled={savingKey || !apiKey.trim()}
                onClick={() => void saveKey()}
                sx={{ ...pushButton(c), alignSelf: 'flex-start' }}
              >
                {savingKey ? <CircularProgress size={12} /> : 'Save key'}
              </ButtonBase>
            </Box>
          )}

          <ButtonBase
            disabled={
              generating ||
              engines.length === 0 ||
              (needsKey && !engines.includes('svg'))
            }
            onClick={() => void generate()}
            sx={{ ...primaryButton(c) }}
          >
            {generating ? (
              <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
            ) : (
              'Generate'
            )}
          </ButtonBase>

          {generating && (
            <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
              Generating {engines.length}×{styles.length || 1} candidate
              {engines.length * (styles.length || 1) === 1 ? '' : 's'}…
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
    </>
  );
};

export default IconPanel;
