import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import ExtensionRoundedIcon from '@mui/icons-material/ExtensionRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  card,
  iconButton,
  popover,
  primaryButton,
  pushButton,
  slimScroll,
  statusChip,
  sunkenField,
} from '@/shared/styles/ui';
import { Placeholder, Scroller, Toolbar } from '@/components/Chrome';
import IconPanel from '@/components/IconPanel';
import type { AppEntry } from '@/components/AppPicker';
import {
  GITGRAPH_BUNDLES_URL,
  GITGRAPH_BUNDLE_URL,
  GITGRAPH_BUNDLE_MEMBERS_URL,
  GITGRAPH_BUNDLE_MEMBER_URL,
  GITGRAPH_BUNDLE_SUGGEST_URL,
  GITGRAPH_BUNDLES_SYNC_URL,
  gitgraphIconRawUrl,
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

interface SyncState {
  last_synced_at: string | null;
  dirty: boolean;
}

/** Renders the last-synced timestamp as a short relative phrase. */
function formatSyncedAt(iso: string | null): string {
  if (!iso) return 'Never synced';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never synced';
  const diff = Date.now() - then;
  if (diff < 45_000) return 'Synced just now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `Synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `Synced ${days}d ago`;
  return `Synced ${new Date(then).toLocaleDateString()}`;
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

const KIND_LABEL: Record<MemberKind, string> = { app: 'App', skill: 'Skill', bundle: 'Bundle' };

/** One tile in the members grid: icon, name, description, kind badge, and a
    remove control that fades in on hover. */
const MemberCard: React.FC<{
  member: Member;
  info: { name: string; description: string; icon?: string } | null;
  onRemove: () => void;
}> = ({ member, info, onRemove }) => {
  const c = useClaudeTokens();
  const missing = !info;
  return (
    <Box
      sx={{
        ...card(c),
        position: 'relative',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        opacity: missing ? 0.55 : 1,
        '&:hover .member-remove': { opacity: 1 },
        '&:hover': { borderColor: c.border.strong, boxShadow: c.shadow.md },
      }}
    >
      <Tooltip title="Remove">
        <ButtonBase
          className="member-remove"
          onClick={onRemove}
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 24,
            height: 24,
            borderRadius: '50%',
            opacity: 0,
            transition: c.transition,
            color: c.text.ghost,
            background: c.bg.surface,
            border: `1px solid ${c.border.subtle}`,
            '&:hover': { color: c.status.error, background: c.status.errorBg, borderColor: c.status.error },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 14 }} />
        </ButtonBase>
      </Tooltip>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: `${c.radius.md}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            background: info?.icon ? 'transparent' : c.bg.secondary,
            border: `1px solid ${c.border.subtle}`,
            color: c.text.tertiary,
          }}
        >
          {info?.icon ? (
            <Box component="img" src={info.icon} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <KindGlyph kind={member.kind} size={18} />
          )}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box
            sx={{
              ...c.type.body,
              fontWeight: 590,
              color: missing ? c.text.muted : c.text.primary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {info ? info.name : 'Missing member'}
          </Box>
          <Box sx={{ ...statusChip(c, 'neutral'), mt: 0.5 }}>
            <KindGlyph kind={member.kind} size={11} />
            {KIND_LABEL[member.kind]}
          </Box>
        </Box>
      </Box>
      <Box
        sx={{
          ...c.type.caption,
          color: c.text.muted,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: '2.2em',
        }}
      >
        {info?.description || (missing ? 'This item no longer exists.' : 'No description.')}
      </Box>
    </Box>
  );
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

/** Resolve a member to just what a preview needs: a kind, a name, and a
    ready-to-use icon URL when one exists. Mirrors BundleDetail.resolve but is
    module-level so the outer list can reuse it. */
function memberPreview(
  m: Member,
  bundles: Bundle[],
  entities: AppEntry[],
): { kind: MemberKind; name: string; icon?: string } | null {
  if (m.kind === 'bundle') {
    const b = bundles.find(x => x.id === m.id);
    return b ? { kind: 'bundle', name: b.title, icon: b.icon || undefined } : null;
  }
  const e = entities.find(x => x.kind === m.kind && x.id === m.id);
  if (!e) return null;
  const icon =
    e.has_icon && e.workspace_exists && e.workspace_id
      ? gitgraphIconRawUrl(e.workspace_id)
      : undefined;
  return { kind: m.kind, name: e.name, icon };
}

/** A small round avatar for one member, shown in the list-card preview strip.
    Uses the member's real icon, or its kind glyph as a fallback. */
const MemberAvatar: React.FC<{
  preview: { kind: MemberKind; name: string; icon?: string } | null;
  size?: number;
}> = ({ preview, size = 26 }) => {
  const c = useClaudeTokens();
  return (
    <Tooltip title={preview?.name || 'Missing member'}>
      <Box
        sx={{
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          background: preview?.icon ? c.bg.surface : c.bg.secondary,
          border: `1.5px solid ${c.bg.surface}`,
          boxShadow: c.shadow.sm,
          color: c.text.tertiary,
          opacity: preview ? 1 : 0.5,
        }}
      >
        {preview?.icon ? (
          <Box component="img" src={preview.icon} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <KindGlyph kind={preview?.kind ?? 'app'} size={Math.round(size * 0.5)} />
        )}
      </Box>
    </Tooltip>
  );
};

/** The visual "what's inside" strip for a bundle card: a row of overlapping
    member avatars with a "+N" overflow bubble, plus a per-kind breakdown. */
const BundlePreview: React.FC<{ bundle: Bundle; bundles: Bundle[]; entities: AppEntry[] }> = ({
  bundle,
  bundles,
  entities,
}) => {
  const c = useClaudeTokens();
  const previews = bundle.members.map(m => memberPreview(m, bundles, entities));
  const counts = bundle.members.reduce(
    (acc, m) => {
      acc[m.kind] = (acc[m.kind] || 0) + 1;
      return acc;
    },
    {} as Record<MemberKind, number>,
  );
  const order: MemberKind[] = ['app', 'skill', 'bundle'];
  const breakdown = order
    .filter(k => counts[k])
    .map(k => `${counts[k]} ${counts[k] === 1 ? KIND_LABEL[k].toLowerCase() : KIND_LABEL[k].toLowerCase() + 's'}`);

  if (bundle.members.length === 0) {
    return (
      <Box sx={{ ...c.type.caption, color: c.text.ghost, mt: 1.25, fontStyle: 'italic' }}>
        No members yet
      </Box>
    );
  }

  const MAX = 6;
  const shown = previews.slice(0, MAX);
  const overflow = previews.length - shown.length;

  return (
    <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        {shown.map((p, i) => (
          <Box key={i} sx={{ ml: i === 0 ? 0 : '-8px', zIndex: shown.length - i }}>
            <MemberAvatar preview={p} />
          </Box>
        ))}
        {overflow > 0 && (
          <Box
            sx={{
              ml: '-8px',
              width: 26,
              height: 26,
              borderRadius: '50%',
              border: `1.5px solid ${c.bg.surface}`,
              background: c.bg.secondary,
              color: c.text.secondary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              ...c.type.caption,
              fontWeight: 600,
              boxShadow: c.shadow.sm,
            }}
          >
            +{overflow}
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {breakdown.map((label, i) => {
          const kind = order.filter(k => counts[k])[i];
          return (
            <Box key={label} component="span" sx={{ ...statusChip(c, 'neutral') }}>
              <KindGlyph kind={kind} size={11} />
              {label}
            </Box>
          );
        })}
      </Box>
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
  const [sync, setSync] = useState<SyncState>({ last_synced_at: null, dirty: false });

  const load = useCallback(async () => {
    try {
      const data = await readJson(await fetch(GITGRAPH_BUNDLES_URL));
      setBundles(Array.isArray(data.bundles) ? data.bundles : []);
      if (data.sync) setSync(data.sync);
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
    // Local edit: remote is now behind until the next sync.
    setSync(prev => (prev.dirty ? prev : { ...prev, dirty: true }));
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
      if (data.sync) setSync(data.sync);
      setSyncNote('Saved to GitHub.');
      // Let the confirmation linger, then fall back to the "Last saved" label.
      window.setTimeout(() => setSyncNote(null), 2500);
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, []);

  const open = useMemo(() => bundles.find(b => b.id === openId) ?? null, [bundles, openId]);

  return (
    <>
      <Toolbar>
        <Box sx={{ ...c.type.headline, color: c.text.primary, letterSpacing: '-0.01em' }}>Bundles</Box>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mr: 0.5 }}>
          <Box sx={{ ...c.type.caption, color: c.text.muted }}>
            {syncNote ?? formatSyncedAt(sync.last_synced_at)}
          </Box>
          <Tooltip title="Resync now (pull remote changes too)">
            <ButtonBase
              onClick={syncNow}
              disabled={syncing}
              sx={{ ...iconButton(c, 28), '&.Mui-disabled': { color: c.text.ghost } }}
            >
              <SyncRoundedIcon
                sx={{
                  fontSize: 16,
                  animation: syncing ? 'bundleSyncSpin 0.8s linear infinite' : 'none',
                  '@keyframes bundleSyncSpin': { to: { transform: 'rotate(360deg)' } },
                }}
              />
            </ButtonBase>
          </Tooltip>
        </Box>
        <Tooltip title={sync.dirty ? '' : 'Everything is already saved to GitHub'} disableHoverListener={sync.dirty}>
          <Box component="span">
            <Box
              component="button"
              onClick={syncNow}
              disabled={syncing || !sync.dirty}
              sx={pushButton(c)}
            >
              {syncing ? <CircularProgress size={13} sx={{ color: c.text.secondary }} /> : <CloudUploadRoundedIcon sx={{ fontSize: 15 }} />}
              Save to GitHub
            </Box>
          </Box>
        </Tooltip>
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
                sx={{
                  ...card(c, true),
                  position: 'relative',
                  p: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.25,
                  alignItems: 'stretch',
                  textAlign: 'left',
                  transition: c.transition,
                  '&:hover': { borderColor: c.border.strong, boxShadow: c.shadow.md, transform: 'translateY(-2px)' },
                  '&:hover .bundle-open-arrow': {
                    opacity: 1,
                    color: c.text.secondary,
                    background: c.bg.secondary,
                    borderColor: c.border.subtle,
                  },
                }}
              >
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                  <BundleIcon icon={b.icon} size={44} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ ...c.type.body, fontWeight: 590, color: c.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.title}
                    </Box>
                    <Box sx={{ ...c.type.caption, color: c.text.muted, mt: 0.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '2.2em' }}>
                      {b.description || 'No description yet.'}
                    </Box>
                  </Box>
                </Box>
                <BundlePreview bundle={b} bundles={bundles} entities={entities} />
                <Box
                  className="bundle-open-arrow"
                  sx={{
                    position: 'absolute',
                    bottom: 12,
                    right: 12,
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: '1px solid transparent',
                    color: c.text.ghost,
                    opacity: 0.4,
                    transition: c.transition,
                  }}
                >
                  <ArrowForwardRoundedIcon sx={{ fontSize: 15 }} />
                </Box>
              </ButtonBase>
            ))}
          </Box>
        )}
      </Scroller>

      <Dialog
        open={!!open}
        onClose={() => setOpenId(null)}
        fullWidth
        maxWidth="md"
        PaperProps={{
          sx: {
            ...popover(c),
            m: 2,
            height: 'min(88vh, 900px)',
            maxHeight: 'calc(100% - 32px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        }}
        slotProps={{ backdrop: { sx: { backgroundColor: 'rgba(0,0,0,0.5)' } } }}
      >
        {open && (
          <BundleDetail
            bundle={open}
            allBundles={bundles}
            entities={entities}
            onBack={() => setOpenId(null)}
            onChange={upsert}
            onDeleted={id => {
              setBundles(prev => prev.filter(b => b.id !== id));
              setSync(prev => (prev.dirty ? prev : { ...prev, dirty: true }));
              setOpenId(null);
            }}
          />
        )}
      </Dialog>
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const [titleGenAnchor, setTitleGenAnchor] = useState<HTMLElement | null>(null);
  const [descGenAnchor, setDescGenAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<MemberKind | 'all'>('all');
  const [addSearch, setAddSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<MemberKind>>(new Set());

  // Resolve a member reference into something displayable, or null when the
  // referenced entity no longer exists (rendered as a "missing" card).
  // `icon` is a ready-to-use <img src>: a data URI for bundles, the raw-icon
  // endpoint for apps/skills that carry one.
  const resolve = useCallback(
    (m: Member): { name: string; description: string; icon?: string } | null => {
      if (m.kind === 'bundle') {
        const b = allBundles.find(x => x.id === m.id);
        return b ? { name: b.title, description: b.description, icon: b.icon || undefined } : null;
      }
      const e = entities.find(x => x.kind === m.kind && x.id === m.id);
      if (!e) return null;
      const icon =
        e.has_icon && e.workspace_exists && e.workspace_id
          ? gitgraphIconRawUrl(e.workspace_id)
          : undefined;
      return { name: e.name, description: e.description, icon };
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

  // The prompt seed IconPanel starts from: the bundle's own title/description
  // plus a plain-language list of what it contains, so a generated mark reflects
  // the whole bundle rather than a single item.
  const iconContext = useMemo(() => {
    const members = memberContext();
    const lines = members.map(m =>
      m.description
        ? `- ${m.kind} "${m.name}": ${m.description}`
        : `- ${m.kind} "${m.name}"`,
    );
    return [
      `A bundle named "${(title || bundle.title).trim()}".`,
      (description || bundle.description).trim(),
      members.length ? `It contains:\n${lines.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }, [title, bundle.title, description, bundle.description, memberContext]);

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
        await patch({ [field]: data.text });
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Generation failed.');
      } finally {
        setBusy(false);
      }
    },
    [bundle.id, title, description, memberContext, patch],
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

  // Candidates resolved + filtered by the dropdown's own search/kind controls,
  // then bucketed by kind so the menu can render collapsible groups.
  const candidateGroups = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    const order: MemberKind[] = ['app', 'skill', 'bundle'];
    const buckets = new Map<MemberKind, { member: Member; info: { name: string; description: string; icon?: string } | null }[]>();
    for (const m of candidates) {
      const info = resolve(m);
      if (q) {
        const name = (info?.name ?? m.id).toLowerCase();
        const desc = (info?.description ?? '').toLowerCase();
        if (!name.includes(q) && !desc.includes(q)) continue;
      }
      if (!buckets.has(m.kind)) buckets.set(m.kind, []);
      buckets.get(m.kind)!.push({ member: m, info });
    }
    return order
      .filter(k => buckets.has(k))
      .map(k => ({
        kind: k,
        items: buckets.get(k)!.sort((a, b) => (a.info?.name ?? a.member.id).localeCompare(b.info?.name ?? b.member.id)),
      }));
  }, [candidates, addSearch, resolve]);

  // Members after the search box and kind chip. Each carries its resolved
  // display info so the grid can render without resolving twice.
  const visibleMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bundle.members
      .map(m => ({ member: m, info: resolve(m) }))
      .filter(({ member }) => kindFilter === 'all' || member.kind === kindFilter)
      .filter(({ member, info }) => {
        if (!q) return true;
        const name = (info?.name ?? member.id).toLowerCase();
        const desc = (info?.description ?? '').toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
  }, [bundle.members, search, kindFilter, resolve]);

  // Which kind chips to offer: only kinds actually present, plus "All".
  const kindsPresent = useMemo(() => {
    const set = new Set<MemberKind>();
    bundle.members.forEach(m => set.add(m.kind));
    return (['app', 'skill', 'bundle'] as MemberKind[]).filter(k => set.has(k));
  }, [bundle.members]);

  return (
    <>
      <Toolbar>
        <Tooltip title="Close">
          <ButtonBase onClick={onBack} sx={{ ...pushButton(c), minHeight: 32, px: '10px' }}>
            <CloseRoundedIcon sx={{ fontSize: 16 }} />
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

          {/* Header: icon, inline-editable title + full-width description.
              Each field reveals its own control only while that field is
              hovered; title/description switch to fields when clicked. */}
          <Box className="bundle-header">
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
              {/* Icon with a subtle edit pencil overlaid top-right on hover.
                  Clicking it opens a popover of sub-options (generate / remove). */}
              <Box sx={{ flexShrink: 0, position: 'relative', '&:hover .icon-pencil': { opacity: 1 } }}>
                <BundleIcon icon={bundle.icon} size={56} />
                <ButtonBase
                  className="icon-pencil"
                  onClick={(e: React.MouseEvent<HTMLElement>) => setIconAnchor(e.currentTarget)}
                  title="Edit icon"
                  sx={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: c.bg.elevated,
                    border: `1px solid ${c.border.medium}`,
                    boxShadow: c.shadow.sm,
                    color: c.text.secondary,
                    opacity: iconAnchor ? 1 : 0,
                    transition: c.transition,
                    '&:hover': { color: c.text.primary, background: c.bg.secondary },
                  }}
                >
                  <EditRoundedIcon sx={{ fontSize: 13 }} />
                </ButtonBase>
                <Popover
                  open={Boolean(iconAnchor)}
                  anchorEl={iconAnchor}
                  onClose={() => setIconAnchor(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                  slotProps={{ paper: { sx: { ...popover(c), mt: 0.5, p: 1.5 } } }}
                >
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <IconPanel
                      workspaceId={bundle.id}
                      appName={title || bundle.title}
                      appDescription={iconContext}
                      heading="Bundle icon"
                      pickHint="Pick one to set it as the bundle icon"
                      onApply={dataUri => patch({ icon: dataUri })}
                    />
                    {bundle.icon && (
                      <Box
                        component="button"
                        onClick={() => {
                          void patch({ icon: '' });
                          setIconAnchor(null);
                        }}
                        sx={pushButton(c)}
                      >
                        Remove icon
                      </Box>
                    )}
                  </Box>
                </Popover>
              </Box>

              {/* Title, reveals a pinned sparkle overlay on hover; clicking it
                  opens a quick confirmation to generate from members. */}
              <Box className="title-group" sx={{ position: 'relative', flex: 1, minWidth: 0, pt: 0.25, '&:hover .title-hover': { opacity: 1 } }}>
                {editingTitle ? (
                  <Box
                    component="input"
                    autoFocus
                    value={title}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                    onBlur={() => {
                      saveTitle();
                      setEditingTitle(false);
                    }}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    sx={{ width: '100%', p: 0, ...c.type.title, lineHeight: 1.3, color: c.text.primary, background: 'transparent', border: 'none', outline: 'none', fontFamily: c.font.sans, boxShadow: `inset 0 -1.5px 0 ${c.accent.primary}` }}
                  />
                ) : (
                  <>
                    <Box
                      onClick={() => setEditingTitle(true)}
                      title="Click to edit"
                      sx={{
                        ...c.type.title,
                        lineHeight: 1.3,
                        color: c.text.primary,
                        cursor: 'text',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%',
                        '&:hover': { boxShadow: `inset 0 -1.5px 0 ${c.border.medium}` },
                      }}
                    >
                      {title || 'Untitled bundle'}
                    </Box>
                    <ButtonBase
                      className="title-hover"
                      onClick={(e: React.MouseEvent<HTMLElement>) => setTitleGenAnchor(e.currentTarget)}
                      disabled={genTitle || bundle.members.length === 0}
                      title={bundle.members.length === 0 ? 'Add members first' : 'Generate title from members'}
                      sx={{
                        position: 'absolute',
                        top: 2,
                        right: 0,
                        zIndex: 2,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: c.bg.elevated,
                        border: `1px solid ${c.border.medium}`,
                        boxShadow: c.shadow.sm,
                        color: c.text.secondary,
                        opacity: titleGenAnchor ? 1 : 0,
                        transition: c.transition,
                        '&:hover': { color: c.accent.primary, background: c.bg.secondary },
                        '&.Mui-disabled': { opacity: 0 },
                      }}
                    >
                      {genTitle ? <CircularProgress size={12} sx={{ color: c.text.secondary }} /> : <AutoAwesomeRoundedIcon sx={{ fontSize: 13 }} />}
                    </ButtonBase>
                  </>
                )}
              </Box>
            </Box>

            {/* Description — full width, reveals a pinned sparkle overlay on hover */}
            <Box className="desc-group" sx={{ position: 'relative', mt: 1.5, '&:hover .desc-hover': { opacity: 1 } }}>
              {editingDesc ? (
                <Box
                  component="textarea"
                  autoFocus
                  ref={(el: HTMLTextAreaElement | null) => {
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = `${el.scrollHeight}px`;
                    }
                  }}
                  value={description}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    setDescription(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onBlur={() => {
                    saveDescription();
                    setEditingDesc(false);
                  }}
                  rows={1}
                  sx={{ width: '100%', display: 'block', px: 0, py: 0, ...c.type.body, lineHeight: 1.6, color: c.text.primary, background: 'transparent', border: 'none', outline: 'none', resize: 'none', overflow: 'hidden', fontFamily: c.font.sans, boxShadow: `inset 0 -1.5px 0 ${c.accent.primary}` }}
                />
              ) : (
                <>
                  <Box
                    onClick={() => setEditingDesc(true)}
                    title="Click to edit"
                    sx={{
                      ...c.type.body,
                      lineHeight: 1.6,
                      color: description ? c.text.secondary : c.text.muted,
                      cursor: 'text',
                      whiteSpace: 'pre-wrap',
                      '&:hover': { boxShadow: `inset 0 -1.5px 0 ${c.border.medium}` },
                    }}
                  >
                    {description || 'No description yet. Click to add one.'}
                  </Box>
                  <ButtonBase
                    className="desc-hover"
                    onClick={(e: React.MouseEvent<HTMLElement>) => setDescGenAnchor(e.currentTarget)}
                    disabled={genDesc || bundle.members.length === 0}
                    title={bundle.members.length === 0 ? 'Add members first' : 'Generate description from members'}
                    sx={{
                      position: 'absolute',
                      top: 2,
                      right: 0,
                      zIndex: 2,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: c.bg.elevated,
                      border: `1px solid ${c.border.medium}`,
                      boxShadow: c.shadow.sm,
                      color: c.text.secondary,
                      opacity: descGenAnchor ? 1 : 0,
                      transition: c.transition,
                      '&:hover': { color: c.accent.primary, background: c.bg.secondary },
                      '&.Mui-disabled': { opacity: 0 },
                    }}
                  >
                    {genDesc ? <CircularProgress size={12} sx={{ color: c.text.secondary }} /> : <AutoAwesomeRoundedIcon sx={{ fontSize: 13 }} />}
                  </ButtonBase>
                </>
              )}
            </Box>
          </Box>

          {/* Quick confirmation popovers for the title / description generators */}
          <Popover
            open={Boolean(titleGenAnchor)}
            anchorEl={titleGenAnchor}
            onClose={() => setTitleGenAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ paper: { sx: { ...popover(c), mt: 0.5, p: 1.5, maxWidth: 240 } } }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ ...c.type.caption, color: c.text.secondary }}>
                Generate a new title from this bundle's members?
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Box component="button" onClick={() => setTitleGenAnchor(null)} sx={pushButton(c)}>
                  Cancel
                </Box>
                <Box
                  component="button"
                  onClick={() => {
                    setTitleGenAnchor(null);
                    void suggest('title');
                  }}
                  sx={{ ...primaryButton(c), gap: 0.5 }}
                >
                  <AutoAwesomeRoundedIcon sx={{ fontSize: 13 }} />
                  Generate
                </Box>
              </Box>
            </Box>
          </Popover>
          <Popover
            open={Boolean(descGenAnchor)}
            anchorEl={descGenAnchor}
            onClose={() => setDescGenAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { ...popover(c), mt: 0.5, p: 1.5, maxWidth: 240 } } }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ ...c.type.caption, color: c.text.secondary }}>
                Generate a new description from this bundle's members?
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Box component="button" onClick={() => setDescGenAnchor(null)} sx={pushButton(c)}>
                  Cancel
                </Box>
                <Box
                  component="button"
                  onClick={() => {
                    setDescGenAnchor(null);
                    void suggest('description');
                  }}
                  sx={{ ...primaryButton(c), gap: 0.5 }}
                >
                  <AutoAwesomeRoundedIcon sx={{ fontSize: 13 }} />
                  Generate
                </Box>
              </Box>
            </Box>
          </Popover>

          {/* Search + kind filter */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ ...sunkenField(c), flex: 1, display: 'flex', alignItems: 'center', gap: 1, px: 1.5, height: 40 }}>
              <SearchRoundedIcon sx={{ fontSize: 18, color: c.text.muted }} />
              <Box
                component="input"
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                placeholder="Search members"
                sx={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', ...c.type.body, color: c.text.primary, '&::placeholder': { color: c.text.muted } }}
              />
            </Box>
            {kindsPresent.length > 1 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {(['all', ...kindsPresent] as const).map(k => {
                  const active = kindFilter === k;
                  const label = k === 'all' ? 'All' : k === 'app' ? 'Apps' : k === 'skill' ? 'Skills' : 'Bundles';
                  return (
                    <Box
                      key={k}
                      component="button"
                      onClick={() => setKindFilter(k as MemberKind | 'all')}
                      sx={{
                        ...pushButton(c),
                        height: 40,
                        px: '12px',
                        ...(active && { background: `rgba(${c.accentRgb},0.10)`, borderColor: c.accent.primary, color: c.accent.primary }),
                      }}
                    >
                      {label}
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>

          {/* Member grid */}
          {bundle.members.length === 0 ? (
            <Box sx={{ ...c.type.body, color: c.text.muted, textAlign: 'center', py: 6 }}>
              No members yet. Add apps, skills, or other bundles below.
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1.5 }}>
              {visibleMembers.map(({ member: m, info }) => (
                <Box
                  key={`${m.kind}:${m.id}`}
                  className="member-card"
                  sx={{
                    ...card(c),
                    position: 'relative',
                    p: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    minHeight: 132,
                    opacity: info ? 1 : 0.55,
                    '&:hover .member-remove': { opacity: 1 },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    {info?.icon ? (
                      <Box
                        component="img"
                        src={info.icon}
                        alt=""
                        sx={{ width: 36, height: 36, borderRadius: `${c.radius.md}px`, objectFit: 'cover', border: `1px solid ${c.border.subtle}`, flexShrink: 0 }}
                      />
                    ) : (
                      <Box sx={{ width: 36, height: 36, borderRadius: `${c.radius.md}px`, background: c.bg.secondary, border: `1px solid ${c.border.subtle}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.text.tertiary, flexShrink: 0 }}>
                        <KindGlyph kind={m.kind} size={18} />
                      </Box>
                    )}
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ ...c.type.headline, color: info ? c.text.primary : c.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {info ? info.name : 'Missing member'}
                      </Box>
                      <Box sx={{ ...statusChip(c, m.kind === 'bundle' ? 'accent' : 'neutral'), mt: 0.5, height: 18, px: '7px' }}>
                        <KindGlyph kind={m.kind} size={11} />
                        {m.kind}
                      </Box>
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      ...c.type.caption,
                      color: c.text.muted,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {info?.description || (info ? 'No description.' : 'This member no longer exists.')}
                  </Box>
                  <Tooltip title="Remove">
                    <ButtonBase
                      className="member-remove"
                      onClick={() => removeMember(m)}
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        opacity: 0,
                        transition: c.transition,
                        color: c.text.ghost,
                        background: c.bg.surface,
                        '&:hover': { color: c.status.error, background: c.status.errorBg },
                      }}
                    >
                      <CloseRoundedIcon sx={{ fontSize: 14 }} />
                    </ButtonBase>
                  </Tooltip>
                </Box>
              ))}

              {/* Add-member card */}
              {candidates.length > 0 && (
                <ButtonBase
                  onClick={(e: React.MouseEvent<HTMLElement>) => setAddAnchor(e.currentTarget)}
                  sx={{
                    minHeight: 132,
                    borderRadius: `${c.radius.lg}px`,
                    border: `1px dashed ${c.border.medium}`,
                    color: c.text.muted,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.75,
                    transition: c.transition,
                    '&:hover': { borderColor: c.accent.primary, color: c.accent.primary, background: `rgba(${c.accentRgb},0.04)` },
                  }}
                >
                  <AddRoundedIcon sx={{ fontSize: 22 }} />
                  <Box sx={{ ...c.type.caption }}>Add member</Box>
                </ButtonBase>
              )}
            </Box>
          )}

          {bundle.members.length > 0 && visibleMembers.length === 0 && (
            <Box sx={{ ...c.type.caption, color: c.text.muted, textAlign: 'center', py: 4 }}>
              No members match your search.
            </Box>
          )}
        </Box>
      </Scroller>

      <Popover
        anchorEl={addAnchor}
        open={Boolean(addAnchor)}
        onClose={() => setAddAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { ...popover(c), width: 320, mt: 0.5, overflow: 'hidden' } } }}
      >
        {/* Search (sticky header) */}
        <Box sx={{ p: 1, borderBottom: `1px solid ${c.border.subtle}` }}>
          <Box sx={{ ...sunkenField(c), display: 'flex', alignItems: 'center', gap: 1, px: 1.25, height: 34 }}>
            <SearchRoundedIcon sx={{ fontSize: 16, color: c.text.muted }} />
            <Box
              component="input"
              autoFocus
              value={addSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddSearch(e.target.value)}
              placeholder="Search to add…"
              sx={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', ...c.type.body, color: c.text.primary, fontFamily: c.font.sans, '&::placeholder': { color: c.text.muted } }}
            />
          </Box>
        </Box>

        {/* Grouped, collapsible candidate list */}
        <Box sx={{ maxHeight: 320, overflowY: 'auto', py: 0.5, ...slimScroll(c) }}>
          {candidateGroups.length === 0 ? (
            <Box sx={{ ...c.type.caption, color: c.text.muted, textAlign: 'center', py: 3 }}>
              Nothing to add.
            </Box>
          ) : (
            candidateGroups.map(group => {
              const collapsed = collapsedGroups.has(group.kind);
              return (
                <Box key={group.kind}>
                  <ButtonBase
                    onClick={() =>
                      setCollapsedGroups(prev => {
                        const next = new Set(prev);
                        if (next.has(group.kind)) next.delete(group.kind);
                        else next.add(group.kind);
                        return next;
                      })
                    }
                    sx={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      gap: 0.75,
                      px: 1.25,
                      py: 0.75,
                      color: c.text.muted,
                      '&:hover': { color: c.text.secondary },
                    }}
                  >
                    <KeyboardArrowDownRoundedIcon
                      sx={{ fontSize: 16, transition: c.transition, transform: collapsed ? 'rotate(-90deg)' : 'none' }}
                    />
                    <Box sx={{ ...c.type.caption, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {KIND_LABEL[group.kind]}s
                    </Box>
                    <Box sx={{ ...c.type.caption, color: c.text.ghost }}>{group.items.length}</Box>
                  </ButtonBase>
                  {!collapsed &&
                    group.items.map(({ member: m, info }) => (
                      <ButtonBase
                        key={`${m.kind}:${m.id}`}
                        onClick={() => addMember(m)}
                        sx={{
                          width: '100%',
                          justifyContent: 'flex-start',
                          gap: 1.25,
                          px: 1.25,
                          py: 0.75,
                          pl: 2.5,
                          ...c.type.body,
                          color: c.text.primary,
                          '&:hover': { background: c.bg.secondary },
                        }}
                      >
                        <Box
                          sx={{
                            width: 24,
                            height: 24,
                            flexShrink: 0,
                            borderRadius: `${c.radius.sm}px`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            background: info?.icon ? 'transparent' : c.bg.secondary,
                            border: `1px solid ${c.border.subtle}`,
                            color: c.text.tertiary,
                          }}
                        >
                          {info?.icon ? (
                            <Box component="img" src={info.icon} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <KindGlyph kind={m.kind} size={14} />
                          )}
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                          {info?.name ?? m.id}
                        </Box>
                      </ButtonBase>
                    ))}
                </Box>
              );
            })
          )}
        </Box>
      </Popover>
    </>
  );
};

export default BundlesPage;
