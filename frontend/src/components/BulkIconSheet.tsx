import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { primaryButton, pushButton, slimScroll, sunkenField } from '@/shared/styles/ui';
import { BrandGlyph, Placeholder } from '@/components/Chrome';
import type { AppEntry } from '@/components/AppPicker';
import {
  GITGRAPH_ICON_CONFIG_URL,
  GITGRAPH_ICON_URL,
  gitgraphIconApplyUrl,
  gitgraphIconJobUrl,
} from '@/shared/state/API_ENDPOINTS';

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

type RunStatus = 'queued' | 'running' | 'done' | 'failed';

interface EntityRun {
  jobId?: string;
  status: RunStatus;
  results: IconResult[];
  error?: string;
  /** Index into the OK-filtered results — the candidate to commit. */
  pick: number;
  /** Whether this entity is included in the Commit-all fan-out. */
  included: boolean;
  committed?: boolean;
  commitError?: string;
  committing?: boolean;
}

type Phase = 'select' | 'generating' | 'review' | 'committing' | 'done';

const MODELS = ['haiku', 'sonnet', 'opus'] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  apps: AppEntry[];
  source: 'apps' | 'skills';
  /** Fired after a commit fan-out so avatars / has_icon refresh upstream. */
  onDone: () => void;
}

const msg = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;

/**
 * Bulk icon generation: fan the existing per-entity icon job out across many
 * selected apps/skills at once. Every generation parameter comes from the saved
 * global defaults (from /icon/config) plus one shared nudge; each entity's
 * prompt seeds from its own name/description. select → generate → review →
 * commit, mirroring BulkActionBar's phase machinery, reusing IconPanel's
 * generate / poll / apply calls unchanged.
 */
const BulkIconSheet: React.FC<Props> = ({ open, onClose, apps, source, onDone }) => {
  const c = useClaudeTokens();

  // Only tracked entities have a repo to commit an icon.* into.
  const tracked = useMemo(
    () => apps.filter(a => a.has_git && a.workspace_exists && a.workspace_id),
    [apps],
  );

  const [phase, setPhase] = useState<Phase>('select');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [nudge, setNudge] = useState('');

  const [styles, setStyles] = useState<string[]>(['flat']);
  const [engines, setEngines] = useState<string[]>(['svg']);
  const [model, setModel] = useState<(typeof MODELS)[number]>('haiku');
  const [openaiKeySet, setOpenaiKeySet] = useState(true);

  const [runs, setRuns] = useState<Record<string, EntityRun>>({});
  const [startError, setStartError] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  // workspaceId -> jobId for jobs still in flight.
  const outstandingRef = useRef<Map<string, string>>(new Map());

  const stopPolling = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  // Reset everything when the sheet opens; preselect every tracked entity.
  useEffect(() => {
    if (!open) {
      stopPolling();
      outstandingRef.current.clear();
      return;
    }
    setPhase('select');
    setChosen(new Set(tracked.map(a => a.workspace_id)));
    setNudge('');
    setRuns({});
    setStartError(null);
    outstandingRef.current.clear();
    void (async () => {
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
        setOpenaiKeySet(Boolean(data?.openai_key_set));
      } catch {
        /* keep built-in fallbacks */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const toggle = (id: string) =>
    setChosen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = () => setChosen(new Set(tracked.map(a => a.workspace_id)));
  const deselectAll = () => setChosen(new Set());
  const selectMissing = () =>
    setChosen(new Set(tracked.filter(a => !a.has_icon).map(a => a.workspace_id)));

  const finishPolling = useCallback(() => {
    stopPolling();
    setPhase('review');
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      const entries = Array.from(outstandingRef.current.entries());
      if (entries.length === 0) {
        finishPolling();
        return;
      }
      void Promise.all(
        entries.map(async ([wid, jobId]) => {
          try {
            const res = await fetch(gitgraphIconJobUrl(jobId));
            const data = await res.json();
            const j: IconJob | null = data?.job ?? null;
            if (!j) return;
            setRuns(prev => ({
              ...prev,
              [wid]: {
                ...prev[wid],
                status: j.status,
                results: j.results ?? [],
                error: j.error || undefined,
              },
            }));
            if (j.status === 'done' || j.status === 'failed') {
              outstandingRef.current.delete(wid);
            }
          } catch {
            /* transient; keep polling */
          }
        }),
      ).then(() => {
        if (outstandingRef.current.size === 0) finishPolling();
      });
    }, 1500);
  }, [stopPolling, finishPolling]);

  const generate = async () => {
    const targets = tracked.filter(a => chosen.has(a.workspace_id));
    if (targets.length === 0) return;
    setStartError(null);
    setPhase('generating');
    outstandingRef.current.clear();

    const init: Record<string, EntityRun> = {};
    targets.forEach(a => {
      init[a.workspace_id] = { status: 'queued', results: [], pick: 0, included: true };
    });
    setRuns(init);

    const sharedNudge = nudge.trim();
    await Promise.all(
      targets.map(async a => {
        const prompt = [(a.description || a.name || '').trim(), sharedNudge]
          .filter(Boolean)
          .join('\n\n');
        try {
          const res = await fetch(GITGRAPH_ICON_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt,
              styles,
              engines,
              title: a.name,
              model,
              entity_id: a.workspace_id,
            }),
          });
          const data = await res.json();
          if (!data?.ok || !data?.job) {
            throw new Error(data?.error || 'Could not start generation.');
          }
          outstandingRef.current.set(a.workspace_id, data.job.id);
          setRuns(prev => ({
            ...prev,
            [a.workspace_id]: {
              ...prev[a.workspace_id],
              jobId: data.job.id,
              status: data.job.status,
              results: data.job.results ?? [],
            },
          }));
        } catch (e) {
          setRuns(prev => ({
            ...prev,
            [a.workspace_id]: {
              ...prev[a.workspace_id],
              status: 'failed',
              error: msg(e, 'Could not start generation.'),
            },
          }));
        }
      }),
    );

    if (outstandingRef.current.size === 0) {
      setPhase('review');
    } else {
      startPolling();
    }
  };

  const commit = async () => {
    const targets = tracked.filter(
      a => chosen.has(a.workspace_id) && runs[a.workspace_id]?.included,
    );
    setPhase('committing');
    await Promise.all(
      targets.map(async a => {
        const run = runs[a.workspace_id];
        const ok = (run?.results ?? []).filter(r => r.ok && r.data_uri);
        const pick = ok[run?.pick ?? 0];
        if (!pick) return;
        setRuns(prev => ({
          ...prev,
          [a.workspace_id]: { ...prev[a.workspace_id], committing: true, commitError: undefined },
        }));
        try {
          const res = await fetch(gitgraphIconApplyUrl(a.workspace_id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data_uri: pick.data_uri,
              message: `Set app icon (${pick.engine}${pick.style ? `/${pick.style}` : ''})`,
            }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(
              typeof data?.detail === 'string' ? data.detail : `Failed (${res.status})`,
            );
          }
          setRuns(prev => ({
            ...prev,
            [a.workspace_id]: { ...prev[a.workspace_id], committing: false, committed: true },
          }));
        } catch (e) {
          setRuns(prev => ({
            ...prev,
            [a.workspace_id]: {
              ...prev[a.workspace_id],
              committing: false,
              commitError: msg(e, 'Could not commit that icon.'),
            },
          }));
        }
      }),
    );
    setPhase('done');
    onDone();
  };

  const busy = phase === 'generating' || phase === 'committing';
  const chosenCount = tracked.filter(a => chosen.has(a.workspace_id)).length;
  const missingCount = tracked.filter(a => !a.has_icon).length;
  const noun = source === 'skills' ? 'skill' : 'app';
  const imageWithoutKey = engines.includes('image') && !openaiKeySet;

  const reviewIncluded = tracked.filter(
    a => chosen.has(a.workspace_id) && runs[a.workspace_id]?.included,
  );
  const committedCount = tracked.filter(a => runs[a.workspace_id]?.committed).length;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={() => !busy && onClose()}
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
        <AutoAwesomeRoundedIcon sx={{ fontSize: 16, color: c.accent.primary }} />
        <Box sx={{ ...c.type.headline, color: c.text.primary, flex: 1 }}>
          Generate icons
        </Box>
        <ButtonBase
          onClick={() => !busy && onClose()}
          disabled={busy}
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
        Generate an icon for many {noun}s at once with your saved defaults
        (styles: {styles.join(', ') || '—'} · engines: {engines.join(', ') || '—'} ·{' '}
        {model}). Each {noun}'s prompt seeds from its own name and description.
      </Box>

      {imageWithoutKey && (
        <Box
          sx={{
            mx: 2,
            mb: 1,
            px: 1.25,
            py: '8px',
            borderRadius: `${c.radius.sm}px`,
            background: c.status.warningBg,
            ...c.type.caption,
            color: c.text.secondary,
            lineHeight: 1.5,
          }}
        >
          The image engine is in your defaults but no OpenAI key is set. Those
          candidates will fail; SVG candidates still work. Add a key in Settings.
        </Box>
      )}

      {tracked.length === 0 ? (
        <Placeholder
          icon={<AutoAwesomeRoundedIcon />}
          title={`No tracked ${noun}s`}
          hint={`Track a ${noun} first — only ${noun}s with a repo can hold a committed icon.`}
        />
      ) : (
        <>
          {/* Shared nudge — only editable before generation. */}
          {phase === 'select' && (
            <Box sx={{ px: 2, pb: 1, flexShrink: 0 }}>
              <Typography sx={{ ...c.type.caption, color: c.text.tertiary, mb: '4px' }}>
                Shared nudge (appended to every prompt, this run only)
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
                  width: '100%',
                  px: 1,
                  py: '6px',
                  '& textarea': { ...slimScroll(c) },
                }}
              />
            </Box>
          )}

          {phase === 'select' && (
            <Box
              sx={{
                px: 2,
                pb: 1,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                flexWrap: 'wrap',
              }}
            >
              <SelectChip onClick={selectAll}>Select all</SelectChip>
              <SelectChip onClick={deselectAll}>Deselect all</SelectChip>
              <SelectChip onClick={selectMissing} disabled={missingCount === 0}>
                Only missing icons ({missingCount})
              </SelectChip>
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                {chosenCount}/{tracked.length} selected
              </Typography>
            </Box>
          )}

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              px: 2,
              pb: 1,
              ...slimScroll(c),
            }}
          >
            {tracked.map(a => {
              const run = runs[a.workspace_id];
              const isChosen = chosen.has(a.workspace_id);
              const ok = (run?.results ?? []).filter(r => r.ok && r.data_uri);
              const failedCount = (run?.results ?? []).filter(r => !r.ok).length;
              return (
                <Box
                  key={a.workspace_id}
                  sx={{
                    py: 1,
                    borderBottom: `1px solid ${c.border.subtle}`,
                    opacity: isChosen ? 1 : 0.5,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {phase === 'select' ? (
                      <ButtonBase
                        onClick={() => toggle(a.workspace_id)}
                        sx={{
                          width: 18,
                          height: 18,
                          flexShrink: 0,
                          borderRadius: `${c.radius.sm}px`,
                          border: `1.5px solid ${
                            isChosen ? c.accent.primary : c.border.medium
                          }`,
                          background: isChosen ? c.accent.primary : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isChosen && (
                          <CheckRoundedIcon sx={{ fontSize: 13, color: '#FFFFFF' }} />
                        )}
                      </ButtonBase>
                    ) : (
                      <BrandGlyph
                        seed={a.workspace_id}
                        letter={a.name.charAt(0)}
                        size={22}
                        iconId={a.workspace_id}
                        hasIcon={a.has_icon}
                      />
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        sx={{
                          ...c.type.body,
                          color: c.text.primary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {a.name}
                      </Typography>
                    </Box>
                    {run && (
                      <RunBadge
                        run={run}
                        okCount={ok.length}
                        onToggleInclude={() =>
                          setRuns(prev => ({
                            ...prev,
                            [a.workspace_id]: {
                              ...prev[a.workspace_id],
                              included: !prev[a.workspace_id].included,
                            },
                          }))
                        }
                        showInclude={phase === 'review' && ok.length > 0}
                      />
                    )}
                  </Box>

                  {/* Candidate grid — review phase, pick one per entity. */}
                  {ok.length > 0 && (phase === 'review' || phase === 'committing' || phase === 'done') && (
                    <Box
                      sx={{
                        mt: 1,
                        ml: '30px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(6, 1fr)',
                        gap: 0.75,
                        opacity: run?.included ? 1 : 0.4,
                      }}
                    >
                      {ok.map((r, idx) => {
                        const picked = (run?.pick ?? 0) === idx;
                        return (
                          <ButtonBase
                            key={`${r.engine}-${r.style}-${idx}`}
                            disabled={phase !== 'review' || !run?.included}
                            onClick={() =>
                              setRuns(prev => ({
                                ...prev,
                                [a.workspace_id]: { ...prev[a.workspace_id], pick: idx },
                              }))
                            }
                            sx={{
                              position: 'relative',
                              aspectRatio: '1 / 1',
                              borderRadius: `${c.radius.sm}px`,
                              border: `2px solid ${
                                picked ? c.accent.primary : c.border.medium
                              }`,
                              overflow: 'hidden',
                              background: '#FFFFFF',
                              '&:hover': { borderColor: c.accent.primary },
                            }}
                            title={`${r.engine}${r.style ? ` · ${r.style}` : ''}`}
                          >
                            <Box
                              component="img"
                              src={r.data_uri}
                              alt={`${r.engine} ${r.style}`}
                              sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                          </ButtonBase>
                        );
                      })}
                    </Box>
                  )}

                  {failedCount > 0 && ok.length === 0 && run?.status === 'done' && (
                    <Typography
                      sx={{ ...c.type.caption, color: c.text.tertiary, ml: '30px', mt: '4px' }}
                    >
                      All candidates failed.
                    </Typography>
                  )}
                  {run?.status === 'failed' && (
                    <Typography
                      sx={{ ...c.type.caption, color: c.status.error, ml: '30px', mt: '4px' }}
                    >
                      {run.error || 'Generation failed.'}
                    </Typography>
                  )}
                  {run?.commitError && (
                    <Typography
                      sx={{ ...c.type.caption, color: c.status.error, ml: '30px', mt: '4px' }}
                    >
                      {run.commitError}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>

          {/* Footer action bar — action depends on phase. */}
          <Box
            sx={{
              px: 2,
              py: 1.5,
              flexShrink: 0,
              borderTop: `1px solid ${c.border.subtle}`,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            {startError && (
              <Typography sx={{ ...c.type.caption, color: c.status.error, flex: 1 }}>
                {startError}
              </Typography>
            )}
            {!startError && <Box sx={{ flex: 1 }} />}

            {phase === 'select' && (
              <ButtonBase
                disabled={chosenCount === 0}
                onClick={() => void generate()}
                sx={{ ...primaryButton(c), gap: '6px', px: 2 }}
              >
                <AutoAwesomeRoundedIcon sx={{ fontSize: 15 }} />
                Generate {chosenCount} {chosenCount === 1 ? noun : `${noun}s`}
              </ButtonBase>
            )}

            {phase === 'generating' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} sx={{ color: c.text.tertiary }} />
                <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                  Generating candidates…
                </Typography>
              </Box>
            )}

            {phase === 'review' && (
              <>
                <ButtonBase
                  onClick={() => setPhase('select')}
                  sx={{ ...pushButton(c), px: 1.5 }}
                >
                  Back
                </ButtonBase>
                <ButtonBase
                  disabled={reviewIncluded.length === 0}
                  onClick={() => void commit()}
                  sx={{ ...primaryButton(c), gap: '6px', px: 2 }}
                >
                  <CheckRoundedIcon sx={{ fontSize: 15 }} />
                  Commit {reviewIncluded.length}{' '}
                  {reviewIncluded.length === 1 ? noun : `${noun}s`}
                </ButtonBase>
              </>
            )}

            {phase === 'committing' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} sx={{ color: c.text.tertiary }} />
                <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                  Committing icons…
                </Typography>
              </Box>
            )}

            {phase === 'done' && (
              <>
                <Typography sx={{ ...c.type.callout, color: c.status.success, flex: 1 }}>
                  Committed {committedCount} icon{committedCount === 1 ? '' : 's'}. Push
                  each repo to send them to GitHub.
                </Typography>
                <ButtonBase onClick={onClose} sx={{ ...primaryButton(c), px: 2 }}>
                  Done
                </ButtonBase>
              </>
            )}
          </Box>
        </>
      )}
    </Drawer>
  );
};

const SelectChip: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, disabled, children }) => {
  const c = useClaudeTokens();
  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      sx={{
        ...c.type.caption,
        px: '10px',
        py: '4px',
        borderRadius: `${c.radius.sm}px`,
        border: `1px solid ${c.border.medium}`,
        color: c.text.secondary,
        opacity: disabled ? 0.4 : 1,
        '&:hover': { background: c.bg.secondary, borderColor: c.accent.primary },
      }}
    >
      {children}
    </ButtonBase>
  );
};

const RunBadge: React.FC<{
  run: EntityRun;
  okCount: number;
  showInclude: boolean;
  onToggleInclude: () => void;
}> = ({ run, okCount, showInclude, onToggleInclude }) => {
  const c = useClaudeTokens();
  if (run.committing)
    return <CircularProgress size={13} sx={{ color: c.text.tertiary }} />;
  if (run.committed)
    return <CheckRoundedIcon sx={{ fontSize: 16, color: c.status.success }} />;
  if (run.status === 'queued' || run.status === 'running')
    return <CircularProgress size={13} sx={{ color: c.text.tertiary }} />;
  if (run.status === 'failed')
    return <ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: c.status.error }} />;
  if (showInclude)
    return (
      <ButtonBase
        onClick={onToggleInclude}
        sx={{
          ...c.type.caption,
          px: '8px',
          py: '2px',
          borderRadius: `${c.radius.sm}px`,
          border: `1px solid ${run.included ? c.accent.primary : c.border.medium}`,
          color: run.included ? c.accent.primary : c.text.tertiary,
        }}
      >
        {run.included ? `Include (${okCount})` : 'Skipped'}
      </ButtonBase>
    );
  return null;
};

export default BulkIconSheet;
