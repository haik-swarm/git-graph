import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CheckIcon from '@mui/icons-material/Check';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import RuleFolderRoundedIcon from '@mui/icons-material/RuleFolderRounded';
import GitHubIcon from '@mui/icons-material/GitHub';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { primaryButton, slimScroll, sunkenField } from '@/shared/styles/ui';
import { Scroller, Toolbar, BrandGlyph } from '@/components/Chrome';
import TemplateEditor, { type TemplateVar } from '@/components/TemplateEditor';
import {
  GITGRAPH_GITHUB_CONNECTION_URL,
  GITGRAPH_GLOBAL_IGNORE_URL,
  GITGRAPH_ICON_CONFIG_URL,
  GITGRAPH_ICON_PREVIEW_URL,
  GITGRAPH_ICON_TEMPLATE_URL,
  gitgraphGlobalIgnoreUrl,
  gitgraphGlobalIgnoreToggleUrl,
} from '@/shared/state/API_ENDPOINTS';

/**
 * The dashboard's Settings tab, parallel to Home and Marketplace. Consolidates
 * three things that were previously reachable only from per-app popovers or the
 * Home toolbar: a warning when the GitHub integration isn't connected, the global
 * icon-generation defaults (styles, engines, model, OpenAI key, prompt templates,
 * resolved preview), and the shared .gitignore list. One page so the user
 * configures Git Graph in one place instead of hunting through app popovers.
 */
interface Props {
  /** Scope for the shared .gitignore section: app repos or skill repos. */
  source: 'apps' | 'skills';
  /** Editing the shared list can change what git sees as dirty upstream. */
  onIgnoreSaved?: () => void;
}

const SettingsPage: React.FC<Props> = ({ source, onIgnoreSaved }) => {
  const c = useClaudeTokens();
  return (
    <>
      <Toolbar>
        <Box sx={{ ...c.type.headline, color: c.text.primary, letterSpacing: '-0.01em' }}>
          Settings
        </Box>
        <Box sx={{ ...c.type.callout, color: c.text.tertiary }}>
          Icon defaults, ignore rules & GitHub
        </Box>
      </Toolbar>
      <Scroller>
        <Box
          sx={{
            maxWidth: 720,
            mx: 'auto',
            px: 3,
            py: 3,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <GitHubSection />
          <IconSection />
          <IgnoreSection source={source} onSaved={onIgnoreSaved} />
        </Box>
      </Scroller>
    </>
  );
};

/** A titled block with a divider header, so the three areas read as one page. */
const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, children }) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        borderRadius: `${c.radius.lg}px`,
        border: `1px solid ${c.border.subtle}`,
        background: c.bg.surface,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1.5,
          borderBottom: `1px solid ${c.border.subtle}`,
        }}
      >
        <Box sx={{ color: c.accent.primary, display: 'flex', '& svg': { fontSize: 18 } }}>
          {icon}
        </Box>
        <Box>
          <Box sx={{ ...c.type.headline, color: c.text.primary }}>{title}</Box>
          {subtitle && (
            <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: '1px' }}>
              {subtitle}
            </Box>
          )}
        </Box>
      </Box>
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</Box>
    </Box>
  );
};

// --------------------------------------------------------------- GitHub section

interface Connection {
  connected: boolean;
  account: string | null;
}

const GitHubSection: React.FC = () => {
  const c = useClaudeTokens();
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(GITGRAPH_GITHUB_CONNECTION_URL);
      setConn(await res.json());
    } catch {
      setConn({ connected: false, account: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connected = Boolean(conn?.connected);

  return (
    <Section
      icon={<GitHubIcon />}
      title="GitHub integration"
      subtitle="Powers publishing, pushing, and collaborators across every app."
    >
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
          <CircularProgress size={16} sx={{ color: c.text.tertiary }} />
        </Box>
      ) : connected ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1.25,
            borderRadius: `${c.radius.sm}px`,
            background: c.status.successBg,
            border: `1px solid ${c.status.success}`,
          }}
        >
          <CheckRoundedIcon sx={{ fontSize: 16, color: c.status.success }} />
          <Box sx={{ ...c.type.body, color: c.text.primary, flex: 1 }}>
            Connected{conn?.account ? ` as ${conn.account}` : ''}.
          </Box>
          <ButtonBase
            onClick={() => void load()}
            sx={{ ...c.type.caption, color: c.accent.primary, px: '4px' }}
          >
            Recheck
          </ButtonBase>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            p: 1.5,
            borderRadius: `${c.radius.sm}px`,
            background: c.status.warningBg,
            border: `1px solid ${c.status.warning}`,
          }}
        >
          <WarningAmberRoundedIcon sx={{ fontSize: 18, color: c.status.warning, flexShrink: 0 }} />
          <Box sx={{ flex: 1 }}>
            <Box sx={{ ...c.type.body, color: c.text.primary, fontWeight: 600 }}>
              GitHub isn't connected
            </Box>
            <Box sx={{ ...c.type.caption, color: c.text.secondary, mt: '2px', lineHeight: 1.5 }}>
              Install the GitHub integration from OpenSwarm Settings → the GitHub
              MCP, then recheck here. Until then, publishing, pushing, your cloud,
              and collaborators stay unavailable.
            </Box>
            <ButtonBase
              onClick={() => void load()}
              sx={{ ...c.type.caption, color: c.accent.primary, px: '4px', mt: '6px', ml: '-4px' }}
            >
              Recheck connection
            </ButtonBase>
          </Box>
        </Box>
      )}
    </Section>
  );
};

// ----------------------------------------------------------------- Icon section

interface TemplateDefault {
  template: string;
  variables: string[];
}
interface TemplateRef {
  styles: Record<string, string>;
  variables: Record<string, string>;
  svg: { system: string; user: string };
  image: { prompt: string };
  style_line: string;
  defaults: {
    svg_system: TemplateDefault;
    svg_user: TemplateDefault;
    image_prompt: TemplateDefault;
    style_line: TemplateDefault;
  };
}

interface ConfigState {
  openai_key_set: boolean;
  default_styles: string[];
  default_engines: string[];
  default_model: string;
  template_svg_system: string;
  template_svg_user: string;
  template_image_prompt: string;
  template_style_line: string;
}

interface ResolvedPreview {
  engine: 'svg' | 'image';
  style: string;
  target: string;
  vars?: Record<string, string>;
}

const TOKEN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(TOKEN, (_m, name) => vars[name] ?? '');
}

const STYLES = ['flat', 'gradient', 'line', '3d', 'monochrome', 'playful'];
const ENGINES: { key: string; label: string }[] = [
  { key: 'svg', label: 'SVG (host model)' },
  { key: 'image', label: 'AI image (gpt-image)' },
];
const MODELS = ['haiku', 'sonnet', 'opus'];

const IconSection: React.FC = () => {
  const c = useClaudeTokens();
  const [tpl, setTpl] = useState<TemplateRef | null>(null);
  const [styles, setStyles] = useState<string[]>([]);
  const [engines, setEngines] = useState<string[]>([]);
  const [model, setModel] = useState('haiku');
  const [keySet, setKeySet] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [svgSystem, setSvgSystem] = useState('');
  const [svgUser, setSvgUser] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [styleLine, setStyleLine] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sample, setSample] = useState('a habit tracker');
  const [previews, setPreviews] = useState<ResolvedPreview[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

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
      setSvgSystem(cfg.template_svg_system || '');
      setSvgUser(cfg.template_svg_user || '');
      setImagePrompt(cfg.template_image_prompt || '');
      setStyleLine(cfg.template_style_line || '');
      setTpl(t);
    } catch {
      setError("Couldn't load the icon settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
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
        if (!cancelled) setPreviews(Array.isArray(data?.prompts) ? data.prompts : []);
      } catch {
        if (!cancelled) setPreviews([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [sample, styles, engines, model]);

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
        template_svg_system: svgSystem,
        template_svg_user: svgUser,
        template_image_prompt: imagePrompt,
        template_style_line: styleLine,
      };
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

  const allVars: TemplateVar[] = tpl
    ? Object.entries(tpl.variables).map(([name, desc]) => ({ name, desc }))
    : [];
  const styleLineVars: TemplateVar[] = allVars.filter(v => v.name === 'style_clause');

  const editTemplate = (set: (v: string) => void) => (v: string) => {
    setSaved(false);
    set(v);
  };

  const renderPreview = (p: ResolvedPreview) => {
    const vars = { ...(p.vars ?? {}) };
    vars.style_line = vars.style_clause
      ? renderTemplate(styleLine, { style_clause: vars.style_clause })
      : '';
    if (p.engine === 'image') {
      return { system: '', body: renderTemplate(imagePrompt, vars) };
    }
    return {
      system: renderTemplate(svgSystem, vars),
      body: renderTemplate(svgUser, vars),
    };
  };

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
    <Section
      icon={<TuneRoundedIcon />}
      title="Icon generation"
      subtitle="Global defaults every Icon button uses — one-click generate sends exactly these."
    >
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={18} sx={{ color: c.text.tertiary }} />
        </Box>
      ) : (
        <>
          {label('Default styles')}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {STYLES.map(s => (
              <Box key={s} onClick={() => toggle(styles, setStyles, s)} sx={chip(styles.includes(s))}>
                {s}
              </Box>
            ))}
          </Box>

          {label('Default engines')}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {ENGINES.map(e => (
              <Box key={e.key} onClick={() => toggle(engines, setEngines, e.key)} sx={chip(engines.includes(e.key))}>
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
            These strings ARE the prompt. Edit them freely — variables show as pills;
            type <code>@</code> (or “Insert variable”) to add one. Clear a field to
            fall back to the built-in default.
          </Box>

          {tpl && (
            <>
              {label('SVG engine · system')}
              <TemplateEditor
                value={svgSystem}
                onChange={editTemplate(setSvgSystem)}
                variables={allVars}
                defaultValue={tpl.defaults.svg_system.template}
                requiredVars={tpl.defaults.svg_system.variables}
                onReset={() => editTemplate(setSvgSystem)(tpl.defaults.svg_system.template)}
              />
              {label('SVG engine · user')}
              <TemplateEditor
                value={svgUser}
                onChange={editTemplate(setSvgUser)}
                variables={allVars}
                defaultValue={tpl.defaults.svg_user.template}
                requiredVars={tpl.defaults.svg_user.variables}
                onReset={() => editTemplate(setSvgUser)(tpl.defaults.svg_user.template)}
              />
              {label('Image engine · prompt')}
              <TemplateEditor
                value={imagePrompt}
                onChange={editTemplate(setImagePrompt)}
                variables={allVars}
                defaultValue={tpl.defaults.image_prompt.template}
                requiredVars={tpl.defaults.image_prompt.variables}
                onReset={() => editTemplate(setImagePrompt)(tpl.defaults.image_prompt.template)}
              />
              {label('Style line (folded in only when a style is set)')}
              <TemplateEditor
                value={styleLine}
                onChange={editTemplate(setStyleLine)}
                variables={styleLineVars}
                defaultValue={tpl.defaults.style_line.template}
                requiredVars={tpl.defaults.style_line.variables}
                onReset={() => editTemplate(setStyleLine)(tpl.defaults.style_line.template)}
              />

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
                    <Box sx={{ ...c.type.caption, color: c.text.secondary }}>{v}</Box>
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

          {previewOpen && (
            <>
              {label('Sample subject')}
              <InputBase
                value={sample}
                onChange={e => setSample(e.target.value)}
                placeholder="e.g. a habit tracker"
                sx={{ ...sunkenField(c), ...c.type.body, color: c.text.primary, px: 1, py: '5px' }}
              />
              {previews.length === 0 ? (
                <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                  {engines.length === 0
                    ? 'Select at least one default engine to preview.'
                    : 'No combinations resolved.'}
                </Box>
              ) : (
                previews.map((p, i) => {
                  const rp = renderPreview(p);
                  return (
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
                      <Box sx={{ ...c.type.caption, color: c.text.secondary, fontWeight: 600 }}>
                        {p.engine.toUpperCase()}
                        {p.style ? ` · ${p.style}` : ' · no style'} → {p.target}
                      </Box>
                      {rp.system && (
                        <>
                          <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>system</Box>
                          {mono(rp.system)}
                        </>
                      )}
                      <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                        {rp.system ? 'user' : 'prompt'}
                      </Box>
                      {mono(rp.body)}
                    </Box>
                  );
                })
              )}
            </>
          )}

          {error && <Box sx={{ ...c.type.caption, color: c.status.error }}>{error}</Box>}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <ButtonBase disabled={saving} onClick={() => void save()} sx={{ ...primaryButton(c) }}>
              {saving ? <CircularProgress size={12} sx={{ color: '#FFFFFF' }} /> : 'Save defaults'}
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
          </Box>
        </>
      )}
    </Section>
  );
};

// --------------------------------------------------------------- Ignore section

interface AppRow {
  workspace_id: string;
  name: string;
  included: boolean;
}
interface IgnoreState {
  content: string;
  apps: AppRow[];
}

const IgnoreSection: React.FC<{ source: 'apps' | 'skills'; onSaved?: () => void }> = ({
  source,
  onSaved,
}) => {
  const c = useClaudeTokens();
  const noun = source === 'skills' ? 'skill' : 'app';
  const nounPlural = source === 'skills' ? 'skills' : 'apps';
  const [state, setState] = useState<IgnoreState | null>(null);
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
      const res = await fetch(gitgraphGlobalIgnoreUrl(source));
      if (!res.ok) throw new Error(`load ${res.status}`);
      const data: IgnoreState = await res.json();
      setState(data);
      setDraft(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load that.");
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void load();
  }, [load]);

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
        body: JSON.stringify({ content: draft, scope: source }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `save ${res.status}`);
      }
      setState(prev => (prev ? { ...prev, content: draft } : prev));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that.");
    } finally {
      setSaving(false);
    }
  };

  const toggleApp = async (row: AppRow) => {
    setToggleBusy(prev => new Set(prev).add(row.workspace_id));
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
                a.workspace_id === row.workspace_id ? { ...a, included: !row.included } : a,
              ),
            }
          : prev,
      );
      onSaved?.();
    } catch {
      /* Row stays as it was; next load re-reads truth from disk. */
    } finally {
      setToggleBusy(prev => {
        const next = new Set(prev);
        next.delete(row.workspace_id);
        return next;
      });
    }
  };

  return (
    <Section
      icon={<RuleFolderRoundedIcon />}
      title="Global .gitignore"
      subtitle={`One list, mirrored into every tracked ${noun} as a managed block.`}
    >
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={18} sx={{ color: c.text.tertiary }} />
        </Box>
      ) : error && !state ? (
        <Box sx={{ ...c.type.body, color: c.status.error }}>{error}</Box>
      ) : state ? (
        <>
          <InputBase
            multiline
            value={draft}
            onChange={e => setDraft(e.target.value)}
            spellCheck={false}
            sx={{
              ...sunkenField(c),
              minHeight: 180,
              alignItems: 'flex-start',
              p: 1.25,
              fontFamily: c.font.mono,
              fontSize: '12.5px',
              lineHeight: 1.55,
              color: c.text.primary,
              '& textarea': { ...slimScroll(c) },
            }}
          />

          <Box
            sx={{
              ...c.type.caption,
              color: c.text.muted,
              display: 'flex',
              alignItems: 'baseline',
              gap: 1,
              mt: 0.5,
            }}
          >
            <Box sx={{ ...c.type.headline, color: c.text.primary }}>Applies to</Box>
            <Box sx={{ flex: 1 }} />
            {includedCount} of {state.apps.length} {nounPlural}
          </Box>

          <Box sx={{ maxHeight: 240, overflowY: 'auto', ...slimScroll(c) }}>
            {state.apps.length === 0 ? (
              <Box sx={{ ...c.type.body, color: c.text.tertiary, py: 1 }}>
                No tracked {nounPlural} yet. Track {noun === 'app' ? 'an app' : 'a skill'} from Home
                and it inherits these rules automatically.
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
                      {app.included && <CheckIcon sx={{ fontSize: 14, color: '#FFFFFF' }} />}
                    </Box>
                    <BrandGlyph seed={app.workspace_id} letter={app.name[0] || '?'} size={22} />
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

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <ButtonBase onClick={() => void save()} disabled={!dirty || saving} sx={{ ...primaryButton(c) }}>
              {saving ? <CircularProgress size={12} sx={{ color: '#FFFFFF' }} /> : 'Save & sync'}
            </ButtonBase>
            <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
              {error ? (
                <Box component="span" sx={{ color: c.status.error }}>
                  {error}
                </Box>
              ) : savedFlash ? (
                <Box component="span" sx={{ color: c.status.success }}>
                  Saved and synced to {includedCount} {noun}
                  {includedCount === 1 ? '' : 's'}.
                </Box>
              ) : dirty ? (
                'Unsaved changes'
              ) : (
                `Editing the list also re-syncs every included ${noun}.`
              )}
            </Box>
          </Box>
        </>
      ) : null}
    </Section>
  );
};

export default SettingsPage;
