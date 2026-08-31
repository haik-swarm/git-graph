import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  primaryButton,
  pushButton,
  slimScroll,
  sunkenField,
} from '@/shared/styles/ui';
import {
  GITGRAPH_ICON_CONFIG_URL,
  GITGRAPH_ICON_PREVIEW_URL,
  GITGRAPH_ICON_TEMPLATE_URL,
} from '@/shared/state/API_ENDPOINTS';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fired after a save so an open panel can re-pull the fresh defaults. */
  onSaved?: () => void;
}

// The raw templates and variable glossary, independent of any form input, so the
// {placeholders} are shown literally.
interface TemplateRef {
  styles: Record<string, string>;
  variables: Record<string, string>;
  svg: { system: string; user: string };
  image: { prompt: string };
  style_line: string;
}

interface ConfigState {
  openai_key_set: boolean;
  default_styles: string[];
  default_engines: string[];
  default_model: string;
}

// One resolved candidate: the exact payload one engine×style combo will send,
// with the {placeholders} already filled from the sample subject.
interface ResolvedPreview {
  engine: 'svg' | 'image';
  style: string;
  target: string;
  system?: string;
  user?: string;
  prompt?: string;
}

const STYLES = ['flat', 'gradient', 'line', '3d', 'monochrome', 'playful'];
const ENGINES: { key: string; label: string }[] = [
  { key: 'svg', label: 'SVG (host model)' },
  { key: 'image', label: 'AI image (gpt-image)' },
];
const MODELS = ['haiku', 'sonnet', 'opus'];

/**
 * Global icon defaults: pick the style/engine/model a one-click generate and a
 * freshly opened panel start from, save the OpenAI key for the image engine, and
 * read the raw prompt templates with their {variables} still in place so nothing
 * about what reaches the model is hidden.
 */
const IconSettingsSheet: React.FC<Props> = ({ open, onClose, onSaved }) => {
  const c = useClaudeTokens();
  const [tpl, setTpl] = useState<TemplateRef | null>(null);
  const [styles, setStyles] = useState<string[]>([]);
  const [engines, setEngines] = useState<string[]>([]);
  const [model, setModel] = useState('haiku');
  const [keySet, setKeySet] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live resolved preview: a sample subject the user can edit, plus the fully
  // filled prompts for the cross product of the currently-selected defaults.
  const [sample, setSample] = useState('a habit tracker');
  const [previews, setPreviews] = useState<ResolvedPreview[]>([]);
  const [previewOpen, setPreviewOpen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, tplRes] = await Promise.all([
        fetch(GITGRAPH_ICON_CONFIG_URL),
        fetch(GITGRAPH_ICON_TEMPLATE_URL),
      ]);
      const cfg: ConfigState = await cfgRes.json();
      const t: TemplateRef = await tplRes.json();
      setStyles(cfg.default_styles || []);
      setEngines(cfg.default_engines || []);
      setModel(cfg.default_model || 'haiku');
      setKeySet(Boolean(cfg.openai_key_set));
      setTpl(t);
    } catch {
      setError("Couldn't load the icon settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void load();
    } else {
      setApiKey('');
      setSaved(false);
      setError(null);
    }
  }, [open, load]);

  // Resolve the selected default styles×engines×model against the sample subject
  // through the same backend builder generation uses, so the preview is literally
  // what the model would receive. Debounced; only runs while the sheet is open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(GITGRAPH_ICON_PREVIEW_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: sample.trim(),
            styles,
            engines,
            title: '',
            model,
            entity_id: 'settings-preview',
          }),
        });
        const data = await res.json();
        if (!cancelled)
          setPreviews(Array.isArray(data?.prompts) ? data.prompts : []);
      } catch {
        if (!cancelled) setPreviews([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, sample, styles, engines, model]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => {
    setSaved(false);
    set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        default_styles: styles,
        default_engines: engines,
        default_model: model,
      };
      // Only send the key when the user typed one, so a blank field never
      // clears an already-saved key.
      if (apiKey.trim()) body.openai_api_key = apiKey.trim();
      const res = await fetch(GITGRAPH_ICON_CONFIG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: ConfigState = await res.json();
      setKeySet(Boolean(data.openai_key_set));
      setApiKey('');
      setSaved(true);
      onSaved?.();
    } catch {
      setError('Could not save the settings.');
    } finally {
      setSaving(false);
    }
  };

  const chip = (active: boolean) => ({
    ...c.type.caption,
    px: 1,
    py: '4px',
    borderRadius: `${c.radius.sm}px`,
    border: `1px solid ${active ? c.accent.primary : c.border.medium}`,
    color: active ? c.accent.primary : c.text.secondary,
    background: active ? c.bg.secondary : 'transparent',
    cursor: 'pointer',
    userSelect: 'none' as const,
  });

  const label = (text: string) => (
    <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: 0.5 }}>{text}</Box>
  );

  const mono = (text: string) => (
    <Box
      component="pre"
      sx={{
        m: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: c.font.mono,
        fontSize: 11,
        lineHeight: 1.5,
        color: c.text.primary,
        p: 1,
        borderRadius: `${c.radius.sm}px`,
        background: c.bg.secondary,
        border: `1px solid ${c.border.subtle}`,
      }}
    >
      {text}
    </Box>
  );

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
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
        <TuneRoundedIcon sx={{ fontSize: 16, color: c.accent.primary }} />
        <Box sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
          Icon generation settings
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
        Global defaults every Icon button uses. One-click generate sends exactly
        these; the resolved preview below shows the literal prompts they produce.
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
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            px: 2,
            pb: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            ...slimScroll(c),
          }}
        >
          {label('Default styles')}
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

          {label('Default engines')}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {ENGINES.map(e => (
              <Box
                key={e.key}
                onClick={() => toggle(engines, setEngines, e.key)}
                sx={chip(engines.includes(e.key))}
              >
                {e.label}
              </Box>
            ))}
          </Box>

          {label('Default SVG model')}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {MODELS.map(m => (
              <Box
                key={m}
                onClick={() => {
                  setSaved(false);
                  setModel(m);
                }}
                sx={chip(model === m)}
              >
                {m}
              </Box>
            ))}
          </Box>

          {label('OpenAI API key (AI-image engine)')}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <InputBase
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={keySet ? 'Key saved — type to replace' : 'sk-…'}
              type="password"
              sx={{
                flex: 1,
                ...sunkenField(c),
                ...c.type.body,
                fontFamily: c.font.mono,
                color: c.text.primary,
                px: 1,
                py: '5px',
              }}
            />
            {keySet && (
              <Box
                sx={{
                  ...c.type.caption,
                  color: c.status.success,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <CheckRoundedIcon sx={{ fontSize: 14 }} />
                saved
              </Box>
            )}
          </Box>

          <Box
            sx={{
              mt: 1,
              pt: 1.5,
              borderTop: `1px solid ${c.border.subtle}`,
              ...c.type.headline,
              color: c.text.primary,
            }}
          >
            Prompt templates
          </Box>
          <Box sx={{ ...c.type.caption, color: c.text.tertiary, lineHeight: 1.5 }}>
            These raw strings ARE the prompt. At generation the {'{placeholders}'}{' '}
            below are filled by <code>.format()</code> and sent verbatim — nothing
            is reconstructed or hidden.
          </Box>

          {tpl && (
            <>
              {label('SVG engine · system')}
              {mono(tpl.svg.system)}
              {label('SVG engine · user')}
              {mono(tpl.svg.user)}
              {label('Image engine · prompt')}
              {mono(tpl.image.prompt)}
              {label('Style line (folded in only when a style is set)')}
              {mono(tpl.style_line)}

              {label('Variables')}
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
                {Object.entries(tpl.variables).map(([k, v]) => (
                  <Box key={k} sx={{ display: 'flex', gap: 0.75 }}>
                    <Box
                      sx={{
                        ...c.type.caption,
                        fontFamily: c.font.mono,
                        color: c.accent.primary,
                        flexShrink: 0,
                        minWidth: 92,
                      }}
                    >
                      {`{${k}}`}
                    </Box>
                    <Box sx={{ ...c.type.caption, color: c.text.secondary }}>
                      {v}
                    </Box>
                  </Box>
                ))}
              </Box>

              {label('Style clauses (what each {style} expands to)')}
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
                {Object.entries(tpl.styles).map(([k, v]) => (
                  <Box key={k} sx={{ display: 'flex', gap: 0.75 }}>
                    <Box
                      sx={{
                        ...c.type.caption,
                        fontFamily: c.font.mono,
                        color: c.accent.primary,
                        flexShrink: 0,
                        minWidth: 92,
                      }}
                    >
                      {k}
                    </Box>
                    <Box sx={{ ...c.type.caption, color: c.text.secondary }}>
                      {v}
                    </Box>
                  </Box>
                ))}
              </Box>
            </>
          )}

          <Box
            sx={{
              mt: 1,
              pt: 1.5,
              borderTop: `1px solid ${c.border.subtle}`,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Box sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
              Resolved preview
            </Box>
            <ButtonBase
              onClick={() => setPreviewOpen(v => !v)}
              sx={{ ...c.type.caption, color: c.accent.primary, px: '4px' }}
            >
              {previewOpen ? 'Hide' : 'Show'}
            </ButtonBase>
          </Box>
          <Box sx={{ ...c.type.caption, color: c.text.tertiary, lineHeight: 1.5 }}>
            The exact prompt every style×engine combo in your defaults would send,
            with the {'{placeholders}'} already filled from a sample subject.
          </Box>

          {previewOpen && (
            <>
              {label('Sample subject')}
              <InputBase
                value={sample}
                onChange={e => setSample(e.target.value)}
                placeholder="e.g. a habit tracker"
                sx={{
                  ...sunkenField(c),
                  ...c.type.body,
                  color: c.text.primary,
                  px: 1,
                  py: '5px',
                }}
              />

              {previews.length === 0 ? (
                <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                  {engines.length === 0
                    ? 'Select at least one default engine to preview.'
                    : 'No combinations resolved.'}
                </Box>
              ) : (
                <>
                  {label(
                    `${previews.length} combination${previews.length === 1 ? '' : 's'} (${(styles.length || 1)} style × ${engines.length} engine)`,
                  )}
                  {previews.map((p, i) => (
                    <Box
                      key={`${p.engine}-${p.style}-${i}`}
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
                      <Box
                        sx={{
                          ...c.type.caption,
                          color: c.text.secondary,
                          fontWeight: 600,
                        }}
                      >
                        {p.engine.toUpperCase()}
                        {p.style ? ` · ${p.style}` : ' · no style'} → {p.target}
                      </Box>
                      {p.system && (
                        <>
                          <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                            system
                          </Box>
                          {mono(p.system)}
                        </>
                      )}
                      <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                        {p.system ? 'user' : 'prompt'}
                      </Box>
                      {mono(p.user ?? p.prompt ?? '')}
                    </Box>
                  ))}
                </>
              )}
            </>
          )}

          {error && (
            <Box sx={{ ...c.type.caption, color: c.status.error }}>{error}</Box>
          )}
        </Box>
      )}

      <Box
        sx={{
          flexShrink: 0,
          px: 2,
          py: 1.5,
          borderTop: `1px solid ${c.border.subtle}`,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <ButtonBase
          disabled={saving}
          onClick={() => void save()}
          sx={{ ...primaryButton(c) }}
        >
          {saving ? (
            <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
          ) : (
            'Save defaults'
          )}
        </ButtonBase>
        {saved && (
          <Box
            sx={{
              ...c.type.caption,
              color: c.status.success,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <CheckRoundedIcon sx={{ fontSize: 14 }} />
            Saved
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        <ButtonBase onClick={onClose} sx={{ ...pushButton(c) }}>
          Close
        </ButtonBase>
      </Box>
    </Drawer>
  );
};

export default IconSettingsSheet;
