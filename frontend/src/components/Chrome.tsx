import React, { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { menuItem, menuSurface, slimScroll, statusChip } from '@/shared/styles/ui';
import { gitgraphIconRawUrl } from '@/shared/state/API_ENDPOINTS';

const ICON_EXT_BY_TYPE: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'app'
  );
}

/**
 * Pull the committed icon and hand it to the browser's save dialog. Deriving
 * the extension from the response's own MIME type keeps the saved file honest
 * whether the repo committed an svg, webp, png, or jpg.
 */
async function downloadIcon(iconId: string, baseName: string): Promise<void> {
  const res = await fetch(gitgraphIconRawUrl(iconId));
  if (!res.ok) throw new Error(`icon ${res.status}`);
  const blob = await res.blob();
  const ext = ICON_EXT_BY_TYPE[blob.type] ?? 'png';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(baseName)}-icon.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Two-column app frame: sidebar rail on the left, scrolling content well on
 * the right. Dashboard archetype — the rail is the orientation surface.
 */
export const Shell: React.FC<{
  rail: React.ReactNode;
  children: React.ReactNode;
}> = ({ rail, children }) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        background: c.bg.page,
        fontFamily: c.font.sans,
        color: c.text.primary,
      }}
    >
      <Box
        sx={{
          width: 260,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: c.bg.surface,
          borderRight: `1px solid ${c.border.subtle}`,
        }}
      >
        {rail}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </Box>
    </Box>
  );
};

/** Sticky view header: hierarchy left, controls right. */
export const Toolbar: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minHeight: 64,
        flexShrink: 0,
        px: 3,
        borderBottom: `1px solid ${c.border.subtle}`,
        background: c.bg.page,
      }}
    >
      {children}
    </Box>
  );
};

export const Scroller: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const c = useClaudeTokens();
  return (
    <Box sx={{ flex: 1, overflowY: 'auto', scrollbarGutter: 'stable', ...slimScroll(c) }}>
      {children}
    </Box>
  );
};

export const RailLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        ...c.type.caption,
        fontWeight: 500,
        color: c.text.muted,
        px: 2,
        pt: 2.5,
        pb: 1,
        userSelect: 'none',
      }}
    >
      {children}
    </Box>
  );
};

/**
 * Deterministic hue per key so every app gets a stable colored glyph
 * without needing an actual icon.
 */
export function seedHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}

export const BrandGlyph: React.FC<{
  seed: string;
  letter: string;
  size?: number;
  active?: boolean;
  /**
   * Workspace/entity id whose committed icon should be shown. When set and
   * `hasIcon` is true, the icon image replaces the letter tile; a load error
   * falls back to the tile so a broken/removed icon never leaves an empty box.
   */
  iconId?: string;
  hasIcon?: boolean;
  /**
   * When true and an icon is actually showing, clicking the glyph opens a
   * small menu offering to save the committed icon to the local device.
   * `downloadName` seeds the saved file's name.
   */
  downloadable?: boolean;
  downloadName?: string;
}> = ({ seed, letter, size = 28, active, iconId, hasIcon, downloadable, downloadName }) => {
  const c = useClaudeTokens();
  const [imgFailed, setImgFailed] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hue = seedHue(seed);
  const bg = `hsl(${hue} ${c.isDark ? '38% 30%' : '70% 93%'})`;
  const fg = `hsl(${hue} ${c.isDark ? '70% 80%' : '50% 32%'})`;
  const showIcon = Boolean(iconId) && hasIcon === true && !imgFailed;
  const canSave = Boolean(downloadable) && showIcon;

  const tile = (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${c.radius.sm}px`,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: showIcon ? c.bg.secondary : bg,
        color: fg,
        fontFamily: c.font.sans,
        fontSize: size * 0.42,
        fontWeight: 600,
        letterSpacing: '-0.02em',
        boxShadow: active ? `0 0 0 2px ${c.accent.primary}` : 'none',
        transition: c.transition,
        userSelect: 'none',
      }}
    >
      {showIcon ? (
        <Box
          component="img"
          src={gitgraphIconRawUrl(iconId!)}
          alt=""
          onError={() => setImgFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        (letter || '?').toUpperCase()
      )}
    </Box>
  );

  if (!canSave) return tile;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await downloadIcon(iconId!, downloadName || letter || 'app');
      setAnchor(null);
    } catch {
      setSaveError("Couldn't save the icon.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ButtonBase
        onClick={e => setAnchor(e.currentTarget)}
        title="Save this icon to your device"
        sx={{ borderRadius: `${c.radius.sm}px`, display: 'block', flexShrink: 0 }}
      >
        {tile}
      </ButtonBase>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { ...menuSurface(c), mt: 0.5, minWidth: 200 } } }}
      >
        <ButtonBase
          onClick={() => void save()}
          disabled={saving}
          sx={{
            ...menuItem(c),
            width: '100%',
            justifyContent: 'flex-start',
            gap: 1,
            ...c.type.body,
            color: c.text.primary,
          }}
        >
          <DownloadRoundedIcon sx={{ fontSize: 16, color: c.text.tertiary }} />
          {saving ? 'Saving…' : 'Save icon to device'}
        </ButtonBase>
        {saveError && (
          <Box sx={{ ...c.type.caption, color: c.status.error, px: '8px', py: '4px' }}>
            {saveError}
          </Box>
        )}
      </Popover>
    </>
  );
};

export const Pill: React.FC<{
  children: React.ReactNode;
  tone?: 'plain' | 'accent' | 'success' | 'warning' | 'danger' | 'ghost';
}> = ({ children, tone = 'plain' }) => {
  const c = useClaudeTokens();
  const mapped = {
    plain: 'neutral',
    accent: 'accent',
    success: 'success',
    warning: 'warning',
    danger: 'error',
    ghost: 'neutral',
  }[tone] as 'neutral' | 'accent' | 'success' | 'warning' | 'error';

  return (
    <Box
      sx={{
        ...statusChip(c, mapped),
        ...(tone === 'ghost' && { background: 'transparent', color: c.text.muted }),
      }}
    >
      {children}
    </Box>
  );
};

/** Centred placeholder for empty, failed and blank states. */
export const Placeholder: React.FC<{
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  danger?: boolean;
}> = ({ icon, title, hint, action, danger }) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        py: 10,
        px: 3,
        textAlign: 'center',
      }}
    >
      {icon && (
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: `${c.radius.xl}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: danger ? c.status.errorBg : c.bg.secondary,
            color: danger ? c.status.error : c.text.tertiary,
            '& svg': { fontSize: 26 },
          }}
        >
          {icon}
        </Box>
      )}
      <Box
        sx={{
          ...c.type.title3,
          color: danger ? c.status.error : c.text.primary,
        }}
      >
        {title}
      </Box>
      {hint && (
        <Box
          sx={{
            ...c.type.body,
            color: c.text.tertiary,
            maxWidth: 400,
            lineHeight: 1.6,
            mt: -0.5,
          }}
        >
          {hint}
        </Box>
      )}
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Box>
  );
};
