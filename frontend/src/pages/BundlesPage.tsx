import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import ExtensionRoundedIcon from '@mui/icons-material/ExtensionRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  card,
  primaryButton,
  pushButton,
  statusChip,
  sunkenField,
} from '@/shared/styles/ui';
import { Placeholder, Scroller, Toolbar } from '@/components/Chrome';
import type { AppEntry } from '@/components/AppPicker';
import {
  GITGRAPH_BUNDLES_URL,
  GITGRAPH_BUNDLE_URL,
  GITGRAPH_BUNDLE_MEMBERS_URL,
  GITGRAPH_BUNDLE_MEMBER_URL,
  GITGRAPH_BUNDLE_SUGGEST_URL,
  GITGRAPH_BUNDLES_SYNC_URL,
  GITGRAPH_ICON_URL,
  gitgraphIconJobUrl,
} from '@/shared/state/API_ENDPOINTS';

type MemberKind = 'app' | 'skill' | 'bundle';

interface Member {
  kind: MemberKind;
  id: string;
}

interface Bundle {
  id: string;
  title: string;
  description: string;
  icon: string;
  members: Member[];
  created_at: string;
  updated_at: string;
}

interface IconResult {
  ok: boolean;
  data_uri: string;
  engine: string;
  style: string;
}

interface IconJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  results: IconResult[];
  error: string;
}

async function readJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || `${res.status}`);
  return data;
}

/** The little glyph that stands in for a member's kind. */
const KindGlyph: React.FC<{ kind: MemberKind; size?: number }> = ({ kind, size = 14 }) => {
  if (kind === 'app') return <WidgetsRoundedIcon sx={{ fontSize: size }} />;
  if (kind === 'skill') return <ExtensionRoundedIcon sx={{ fontSize: size }} />;
  return <Inventory2RoundedIcon sx={{ fontSize: size }} />;
};

/** The square that shows a bundle's inline icon, or a fallback glyph. */
const BundleIcon: React.FC<{ icon: string; size: number }> = ({ icon, size }) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${c.radius.md}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: icon ? 'transparent' : c.bg.secondary,
        border: `1px solid ${c.border.subtle}`,
        color: c.text.tertiary,
      }}
    >
      {icon ? (
        <Box component="img" src={icon} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Inventory2RoundedIcon sx={{ fontSize: Math.round(size * 0.5) }} />
      )}
    </Box>
  );
};

const BundlesPage: React.FC<{ entities: AppEntry[] }> = ({ entities }) => {
  const c = useClaudeTokens();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await readJson(await fetch(GITGRAPH_BUNDLES_URL));
      setBundles(Array.isArray(data.bundles) ? data.bundles : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load bundles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upsert = useCallback((b: Bundle) => {
    setBundles(prev => {
      const next = prev.filter(x => x.id !== b.id);
      next.unshift(b);
      return next;
    });
  }, []);

  const createBundle = useCallback(async () => {
    setCreating(true);
    try {
      const data = await readJson(
        await fetch(GITGRAPH_BUNDLES_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Untitled bundle', description: '' }),
        }),
      );
      upsert(data.bundle);
      setOpenId(data.bundle.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't create that bundle.");
    } finally {
      setCreating(false);
    }
  }, [upsert]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const data = await readJson(await fetch(GITGRAPH_BUNDLES_SYNC_URL, { method: 'POST' }));
      if (Array.isArray(data.bundles)) setBundles(data.bundles);
      setSyncNote('Synced to GitHub.');
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, []);

  const open = useMemo(() => bundles.find(b => b.id === openId) ?? null, [bundles, openId]);

  if (open) {
    return (
      <BundleDetail
        bundle={open}
        allBundles={bundles}
        entities={entities}
        onBack={() => setOpenId(null)}
        onChange={upsert}
        onDeleted={id => {
          setBundles(prev => prev.filter(b => b.id !== id));
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <>
      <Toolbar>
        <Box sx={{ ...c.type.headline, color: c.text.primary, letterSpacing: '-0.01em' }}>Bundles</Box>
        <Box sx={{ flex: 1 }} />
        {syncNote && (
          <Box sx={{ ...c.type.caption, color: c.text.muted }}>{syncNote}</Box>
        )}
        <Box component="button" onClick={syncNow} disabled={syncing} sx={pushButton(c)}>
          {syncing ? <CircularProgress size={13} sx={{ color: c.text.secondary }} /> : <CloudUploadRoundedIcon sx={{ fontSize: 15 }} />}
          Sync to GitHub
        </Box>
        <Box component="button" onClick={createBundle} disabled={creating} sx={primaryButton(c)}>
          <AddRoundedIcon sx={{ fontSize: 16 }} />
          New bundle
        </Box>
      </Toolbar>
      <Scroller>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
            <CircularProgress size={20} sx={{ color: c.accent.primary }} />
          </Box>
        ) : error ? (
          <Placeholder icon={<Inventory2RoundedIcon />} title="Couldn't load bundles" hint={error} danger />
        ) : bundles.length === 0 ? (
          <Placeholder
            icon={<Inventory2RoundedIcon />}
            title="No bundles yet"
            hint="Group apps, skills, and other bundles into a shareable set."
            action={
              <Box component="button" onClick={createBundle} sx={primaryButton(c)}>
                <AddRoundedIcon sx={{ fontSize: 16 }} />
                New bundle
              </Box>
            }
          />
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 2,
              p: 3,
            }}
          >
            {bundles.map(b => (
              <ButtonBase
                key={b.id}
                onClick={() => setOpenId(b.id)}
                sx={{ ...card(c, true), p: 2, display: 'flex', gap: 1.5, alignItems: 'flex-start', textAlign: 'left' }}
              >
                <BundleIcon icon={b.icon} size={44} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ ...c.type.body, fontWeight: 590, color: c.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.title}
                  </Box>
                  {b.description && (
                    <Box sx={{ ...c.type.caption, color: c.text.muted, mt: 0.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {b.description}
                    </Box>
                  )}
                  <Box sx={{ mt: 1 }}>
                    <Box component="span" sx={statusChip(c, 'neutral')}>
                      {b.members.length} {b.members.length === 1 ? 'member' : 'members'}
                    </Box>
                  </Box>
                </Box>
              </ButtonBase>
            ))}
          </Box>
        )}
      </Scroller>
    </>
  );
};

// ---------------------------------------------------------------------------
// Detail / edit view
// ---------------------------------------------------------------------------

const BundleDetail: React.FC<{
  bundle: Bundle;
  allBundles: Bundle[];
  entities: AppEntry[];
  onBack: () => void;
  onChange: (b: Bundle) => void;
  onDeleted: (id: string) => void;
}> = ({ bundle, allBundles, entities, onBack, onChange, onDeleted }) => {
  const c = useClaudeTokens();
  const [title, setTitle] = useState(bundle.title);
  const [description, setDescription] = useState(bundle.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [genTitle, setGenTitle] = useState(false);
  const [genDesc, setGenDesc] = useState(false);

  // Resolve a member reference into something displayable, or null when the
  // referenced entity no longer exists (rendered as a "missing" chip).
  const resolve = useCallback(
    (m: Member): { name: string; icon?: string } | null => {
      if (m.kind === 'bundle') {
        const b = allBundles.find(x => x.id === m.id);
        return b ? { name: b.title, icon: b.icon } : null;
      }
      const e = entities.find(x => x.kind === m.kind && x.id === m.id);
      return e ? { name: e.name } : null;
    },
    [allBundles, entities],
  );

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const data = await readJson(
        await fetch(GITGRAPH_BUNDLE_URL(bundle.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      onChange(data.bundle);
    },
    [bundle.id, onChange],
  );

  const saveTitle = useCallback(() => {
    if (title.trim() && title !== bundle.title) void patch({ title });
  }, [title, bundle.title, patch]);

  const saveDescription = useCallback(() => {
    if (description !== bundle.description) void patch({ description });
  }, [description, bundle.description, patch]);

  // Member summaries (kind + name + description) sent to the LLM as context.
  const memberContext = useCallback(
    () =>
      bundle.members
        .map(m => {
          if (m.kind === 'bundle') {
            const b = allBundles.find(x => x.id === m.id);
            return b
              ? { kind: 'bundle', name: b.title, description: b.description }
              : null;
          }
          const e = entities.find(x => x.kind === m.kind && x.id === m.id);
          return e ? { kind: e.kind, name: e.name, description: e.description } : null;
        })
        .filter((m): m is { kind: string; name: string; description: string } => m !== null),
    [bundle.members, allBundles, entities],
  );

  const suggest = useCallback(
    async (field: 'title' | 'description') => {
      const setBusy = field === 'title' ? setGenTitle : setGenDesc;
      setBusy(true);
      setDetailError(null);
      try {
        const data = await readJson(
          await fetch(GITGRAPH_BUNDLE_SUGGEST_URL(bundle.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field, members: memberContext(), title, description }),
          }),
        );
        if (!data.ok) throw new Error(data.error || 'Generation failed.');
        if (field === 'title') setTitle(data.text);
        else setDescription(data.text);
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Generation failed.');
      } finally {
        setBusy(false);
      }
    },
    [bundle.id, title, description, memberContext],
  );

  const addMember = useCallback(
    async (m: Member) => {
      setAddAnchor(null);
      setDetailError(null);
      try {
        const data = await readJson(
          await fetch(GITGRAPH_BUNDLE_MEMBERS_URL(bundle.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ members: [m] }),
          }),
        );
        onChange(data.bundle);
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : "Couldn't add that member.");
      }
    },
    [bundle.id, onChange],
  );

  const removeMember = useCallback(
    async (m: Member) => {
      try {
        const data = await readJson(
          await fetch(GITGRAPH_BUNDLE_MEMBER_URL(bundle.id, m.kind, m.id), { method: 'DELETE' }),
        );
        onChange(data.bundle);
      } catch {
        /* leave the chip in place if the delete didn't take */
      }
    },
    [bundle.id, onChange],
  );

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await readJson(await fetch(GITGRAPH_BUNDLE_URL(bundle.id), { method: 'DELETE' }));
      onDeleted(bundle.id);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Couldn't delete that bundle.");
      setBusy(false);
    }
  }, [bundle.id, onDeleted]);

  // Candidate members not already in the bundle: every app/skill plus every
  // other bundle. The backend still runs the cycle check on bundle adds.
  const candidates = useMemo(() => {
    const has = new Set(bundle.members.map(m => `${m.kind}:${m.id}`));
    const fromEntities: Member[] = entities
      .filter(e => !has.has(`${e.kind}:${e.id}`))
      .map(e => ({ kind: e.kind, id: e.id }));
    const fromBundles: Member[] = allBundles
      .filter(b => b.id !== bundle.id && !has.has(`bundle:${b.id}`))
      .map(b => ({ kind: 'bundle' as const, id: b.id }));
    return [...fromEntities, ...fromBundles];
  }, [bundle.members, bundle.id, entities, allBundles]);

  return (
    <>
      <Toolbar>
        <Tooltip title="Back to bundles">
          <ButtonBase onClick={onBack} sx={{ ...pushButton(c), minHeight: 32, px: '10px' }}>
            <ArrowBackRoundedIcon sx={{ fontSize: 16 }} />
          </ButtonBase>
        </Tooltip>
        <BundleIcon icon={bundle.icon} size={28} />
        <Box sx={{ ...c.type.headline, color: c.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bundle.title}
        </Box>
        <Box sx={{ flex: 1 }} />
        {confirmDelete ? (
          <>
            <Box sx={{ ...c.type.caption, color: c.text.muted }}>Delete this bundle?</Box>
            <Box component="button" onClick={() => setConfirmDelete(false)} sx={pushButton(c)}>Cancel</Box>
            <Box
              component="button"
              onClick={remove}
              disabled={busy}
              sx={{ ...primaryButton(c), background: c.status.error, '&:hover': { background: c.status.error } }}
            >
              {busy ? <CircularProgress size={13} sx={{ color: '#fff' }} /> : 'Delete'}
            </Box>
          </>
        ) : (
          <Tooltip title="Delete bundle">
            <ButtonBase onClick={() => setConfirmDelete(true)} sx={{ ...pushButton(c), minHeight: 32, px: '10px', color: c.text.muted }}>
              <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
            </ButtonBase>
          </Tooltip>
        )}
      </Toolbar>
      <Scroller>
        <Box sx={{ maxWidth: 760, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {detailError && (
            <Box sx={{ ...c.type.caption, color: c.status.error }}>{detailError}</Box>
          )}

          {/* Title + description */}
          <Box sx={{ ...card(c), p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                <Box sx={{ ...c.type.caption, color: c.text.muted }}>Title</Box>
                <Box
                  component="button"
                  onClick={() => void suggest('title')}
                  disabled={genTitle || bundle.members.length === 0}
                  title={bundle.members.length === 0 ? 'Add members first' : 'Generate title from members'}
                  sx={{ ...pushButton(c), minHeight: 26, px: '8px', gap: 0.5, ...c.type.caption }}
                >
                  {genTitle ? <CircularProgress size={12} sx={{ color: c.text.secondary }} /> : <AutoAwesomeRoundedIcon sx={{ fontSize: 13 }} />}
                  Generate
                </Box>
              </Box>
              <Box
                component="input"
                value={title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                onBlur={saveTitle}
                sx={{ ...sunkenField(c), width: '100%', px: 1.5, py: 1, ...c.type.body, color: c.text.primary, outline: 'none' }}
              />
            </Box>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                <Box sx={{ ...c.type.caption, color: c.text.muted }}>Description</Box>
                <Box
                  component="button"
                  onClick={() => void suggest('description')}
                  disabled={genDesc || bundle.members.length === 0}
                  title={bundle.members.length === 0 ? 'Add members first' : 'Generate description from members'}
                  sx={{ ...pushButton(c), minHeight: 26, px: '8px', gap: 0.5, ...c.type.caption }}
                >
                  {genDesc ? <CircularProgress size={12} sx={{ color: c.text.secondary }} /> : <AutoAwesomeRoundedIcon sx={{ fontSize: 13 }} />}
                  Generate
                </Box>
              </Box>
              <Box
                component="textarea"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                onBlur={saveDescription}
                rows={3}
                sx={{ ...sunkenField(c), width: '100%', px: 1.5, py: 1, ...c.type.body, color: c.text.primary, outline: 'none', resize: 'vertical', fontFamily: c.font.sans }}
              />
            </Box>
          </Box>

          {/* Icon */}
          <IconEditor bundle={bundle} onPick={dataUri => void patch({ icon: dataUri })} />

          {/* Members */}
          <Box sx={{ ...card(c), p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
              <Box sx={{ ...c.type.body, fontWeight: 590, color: c.text.primary }}>Members</Box>
              <Box sx={{ flex: 1 }} />
              <Box
                component="button"
                onClick={(e: React.MouseEvent<HTMLElement>) => setAddAnchor(e.currentTarget)}
                disabled={candidates.length === 0}
                sx={pushButton(c)}
              >
                <AddRoundedIcon sx={{ fontSize: 15 }} />
                Add member
              </Box>
            </Box>
            {bundle.members.length === 0 ? (
              <Box sx={{ ...c.type.caption, color: c.text.muted }}>No members yet. Add apps, skills, or other bundles.</Box>
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {bundle.members.map(m => {
                  const info = resolve(m);
                  return (
                    <Box
                      key={`${m.kind}:${m.id}`}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.75,
                        height: 30,
                        pl: 1,
                        pr: 0.5,
                        borderRadius: `${c.radius.full}px`,
                        border: `1px solid ${c.border.subtle}`,
                        background: info ? c.bg.surface : c.bg.secondary,
                        opacity: info ? 1 : 0.55,
                        color: c.text.secondary,
                      }}
                    >
                      <KindGlyph kind={m.kind} />
                      <Box sx={{ ...c.type.caption, color: info ? c.text.primary : c.text.muted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {info ? info.name : 'missing'}
                      </Box>
                      <Tooltip title="Remove">
                        <ButtonBase onClick={() => removeMember(m)} sx={{ width: 20, height: 20, borderRadius: '50%', color: c.text.ghost, '&:hover': { color: c.status.error, background: c.status.errorBg } }}>
                          <CloseRoundedIcon sx={{ fontSize: 13 }} />
                        </ButtonBase>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        </Box>
      </Scroller>

      <Menu
        anchorEl={addAnchor}
        open={Boolean(addAnchor)}
        onClose={() => setAddAnchor(null)}
        slotProps={{ paper: { sx: { maxHeight: 360, minWidth: 240 } } }}
      >
        {candidates.map(m => {
          const info = resolve(m);
          return (
            <MenuItem key={`${m.kind}:${m.id}`} onClick={() => addMember(m)} sx={{ gap: 1, ...c.type.body }}>
              <KindGlyph kind={m.kind} />
              <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info?.name ?? m.id}</Box>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
};

// ---------------------------------------------------------------------------
// Icon editor: reuses the shared icon-generation job endpoints, then stores the
// chosen candidate inline on the bundle rather than committing it to a repo.
// ---------------------------------------------------------------------------

const IconEditor: React.FC<{ bundle: Bundle; onPick: (dataUri: string) => void }> = ({ bundle, onPick }) => {
  const c = useClaudeTokens();
  const [prompt, setPrompt] = useState('');
  const [job, setJob] = useState<IconJob | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    },
    [],
  );

  const poll = useCallback((jobId: string) => {
    const tick = async () => {
      try {
        const data = await readJson(await fetch(gitgraphIconJobUrl(jobId)));
        const j: IconJob = data.job;
        setJob(j);
        if (j && (j.status === 'done' || j.status === 'failed')) {
          if (j.status === 'failed') setGenError(j.error || 'Generation failed.');
          return;
        }
      } catch {
        setGenError("Lost the icon job.");
        return;
      }
      pollRef.current = setTimeout(tick, 1300);
    };
    void tick();
  }, []);

  const generate = useCallback(async () => {
    setGenError(null);
    setJob({ id: '', status: 'queued', results: [], error: '' });
    try {
      const data = await readJson(
        await fetch(GITGRAPH_ICON_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            title: bundle.title,
            styles: ['flat'],
            entity_id: `bundle:${bundle.id}`,
          }),
        }),
      );
      if (!data.ok) throw new Error(data.error || 'Generation failed.');
      setJob(data.job);
      poll(data.job.id);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed.');
      setJob(null);
    }
  }, [prompt, bundle.title, bundle.id, poll]);

  const candidates = (job?.results ?? []).filter(r => r.ok && r.data_uri);
  const working = job !== null && (job.status === 'queued' || job.status === 'running');

  return (
    <Box sx={{ ...card(c), p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <BundleIcon icon={bundle.icon} size={48} />
        <Box sx={{ flex: 1 }}>
          <Box sx={{ ...c.type.body, fontWeight: 590, color: c.text.primary }}>Icon</Box>
          <Box sx={{ ...c.type.caption, color: c.text.muted, mt: 0.25 }}>
            Describe a mark, generate a few, then pick one.
          </Box>
        </Box>
        {bundle.icon && (
          <Box component="button" onClick={() => onPick('')} sx={pushButton(c)}>Remove</Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Box
          component="input"
          value={prompt}
          placeholder="e.g. a stack of interlocking blocks"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrompt(e.target.value)}
          sx={{ ...sunkenField(c), flex: 1, px: 1.5, py: 1, ...c.type.body, color: c.text.primary, outline: 'none' }}
        />
        <Box component="button" onClick={generate} disabled={working} sx={primaryButton(c)}>
          {working ? <CircularProgress size={13} sx={{ color: '#fff' }} /> : <AutoAwesomeRoundedIcon sx={{ fontSize: 15 }} />}
          Generate
        </Box>
      </Box>
      {genError && <Box sx={{ ...c.type.caption, color: c.status.error }}>{genError}</Box>}
      {candidates.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {candidates.map((r, i) => (
            <Tooltip key={i} title={`${r.engine} · ${r.style || 'default'}`}>
              <ButtonBase
                onClick={() => onPick(r.data_uri)}
                sx={{ width: 56, height: 56, borderRadius: `${c.radius.md}px`, overflow: 'hidden', border: `1px solid ${c.border.subtle}`, '&:hover': { borderColor: c.accent.primary } }}
              >
                <Box component="img" src={r.data_uri} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </ButtonBase>
            </Tooltip>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default BundlesPage;
