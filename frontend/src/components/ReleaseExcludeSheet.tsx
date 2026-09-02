import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { primaryButton, pushButton, slimScroll, sunkenField } from '@/shared/styles/ui';
import { gitgraphReleaseFilesUrl } from '@/shared/state/API_ENDPOINTS';

interface FileEntry {
  path: string;
  size: number;
  locked: boolean;
  type: 'file' | 'dir';
}

interface Props {
  open: boolean;
  workspaceId: string;
  appName: string;
  /** Paths currently excluded (the source of truth lives in the parent). */
  excluded: string[];
  onClose: () => void;
  onChange: (excluded: string[]) => void;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let size = bytes / 1024;
  for (const unit of ['KB', 'MB', 'GB']) {
    if (size < 1024) return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${unit}`;
    size /= 1024;
  }
  return `${Math.round(size)} TB`;
}

/**
 * The release exclude-picker. Lists the whole workspace as a checkbox tree:
 * a checked row ships in the .swarm, an unchecked one is left out. Files the
 * export always strips (node_modules, .git, .venv, .env, oversized, ...) come
 * back `locked` — rendered unchecked and disabled, so they read as "never
 * included" and can't be toggled back on. The parent owns the excluded list
 * and sends it with the release; this sheet only edits it.
 */
const ReleaseExcludeSheet: React.FC<Props> = ({
  open,
  workspaceId,
  appName,
  excluded,
  onClose,
  onChange,
}) => {
  const c = useClaudeTokens();
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setFiles(null);
    setError(null);
    try {
      const res = await fetch(gitgraphReleaseFilesUrl(workspaceId));
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setFiles(Array.isArray(data.files) ? (data.files as FileEntry[]) : []);
    } catch {
      setError('Could not read the workspace files.');
      setFiles([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (open) {
      void load();
      setFilter('');
    }
  }, [open, load]);

  const excludedSet = useMemo(() => new Set(excluded), [excluded]);

  // A path is dropped if it's directly excluded or sits under an excluded dir.
  const isExcluded = useCallback(
    (path: string) =>
      excludedSet.has(path) ||
      [...excludedSet].some(p => path.startsWith(`${p}/`)),
    [excludedSet],
  );

  const toggle = useCallback(
    (entry: FileEntry) => {
      if (entry.locked) return;
      const next = new Set(excludedSet);
      if (isExcluded(entry.path)) {
        next.delete(entry.path);
        // Also un-exclude any parent dir so this file can come back.
        for (const p of [...next]) {
          if (entry.path.startsWith(`${p}/`)) next.delete(p);
        }
      } else {
        next.add(entry.path);
      }
      onChange([...next].sort());
    },
    [excludedSet, isExcluded, onChange],
  );

  const visible = useMemo(() => {
    if (!files) return [];
    const q = filter.trim().toLowerCase();
    return q ? files.filter(f => f.path.toLowerCase().includes(q)) : files;
  }, [files, filter]);

  const excludableCount = useMemo(
    () => (files ? files.filter(f => !f.locked).length : 0),
    [files],
  );
  const excludedCount = useMemo(
    () => (files ? files.filter(f => !f.locked && isExcluded(f.path)).length : 0),
    [files, isExcluded],
  );

  const setAll = useCallback(
    (exclude: boolean) => {
      if (!files) return;
      if (!exclude) {
        onChange([]);
        return;
      }
      onChange(files.filter(f => !f.locked).map(f => f.path).sort());
    },
    [files, onChange],
  );

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: 460,
            maxWidth: '100vw',
            bgcolor: c.bg.page,
            backgroundImage: 'none',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: `1px solid ${c.border.subtle}`,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Box sx={{ flex: 1 }}>
          <Box sx={{ ...c.type.headline, color: c.text.primary }}>
            Include in release
          </Box>
          <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
            {appName} — uncheck anything you don't want in the .swarm
          </Box>
        </Box>
        <ButtonBase onClick={onClose} sx={{ ...pushButton(c), px: 0.75, minWidth: 32 }}>
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </ButtonBase>
      </Box>

      <Box
        sx={{
          px: 2,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: `1px solid ${c.border.subtle}`,
        }}
      >
        <InputBase
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter files…"
          sx={{
            ...sunkenField(c),
            ...c.type.body,
            flex: 1,
            color: c.text.primary,
            px: 1,
            py: '4px',
          }}
        />
        <ButtonBase
          onClick={() => setAll(false)}
          disabled={excludedCount === 0}
          sx={{ ...pushButton(c), whiteSpace: 'nowrap' }}
        >
          <CheckRoundedIcon sx={{ fontSize: 14 }} />
          All
        </ButtonBase>
        <ButtonBase
          onClick={() => setAll(true)}
          disabled={excludableCount === 0 || excludedCount === excludableCount}
          sx={{ ...pushButton(c), whiteSpace: 'nowrap' }}
        >
          None
        </ButtonBase>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', ...slimScroll(c), px: 1, py: 0.5 }}>
        {files === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={18} sx={{ color: c.accent.primary }} />
          </Box>
        ) : error ? (
          <Box sx={{ ...c.type.body, color: c.status.error, px: 1, py: 2 }}>{error}</Box>
        ) : visible.length === 0 ? (
          <Box sx={{ ...c.type.body, color: c.text.tertiary, px: 1, py: 2 }}>
            No files match.
          </Box>
        ) : (
          visible.map(entry => {
            const dropped = entry.locked || isExcluded(entry.path);
            const checked = !dropped;
            return (
              <ButtonBase
                key={entry.path}
                onClick={() => toggle(entry)}
                disabled={entry.locked}
                sx={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  gap: 1,
                  px: 1,
                  py: '5px',
                  borderRadius: `${c.radius.sm}px`,
                  cursor: entry.locked ? 'default' : 'pointer',
                  opacity: entry.locked ? 0.5 : 1,
                  '&:hover': entry.locked ? {} : { bgcolor: c.bg.secondary },
                }}
              >
                <Box
                  sx={{
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    borderRadius: '4px',
                    border: `1.5px solid ${
                      checked ? c.accent.primary : c.border.strong
                    }`,
                    bgcolor: checked ? c.accent.primary : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {checked && (
                    <CheckRoundedIcon sx={{ fontSize: 13, color: '#FFFFFF' }} />
                  )}
                  {entry.locked && (
                    <LockRoundedIcon sx={{ fontSize: 11, color: c.text.muted }} />
                  )}
                </Box>
                {entry.type === 'dir' ? (
                  <FolderRoundedIcon sx={{ fontSize: 15, color: c.text.tertiary, flexShrink: 0 }} />
                ) : (
                  <InsertDriveFileOutlinedIcon
                    sx={{ fontSize: 15, color: c.text.tertiary, flexShrink: 0 }}
                  />
                )}
                <Box
                  sx={{
                    ...c.type.body,
                    fontFamily: c.font.mono,
                    color: dropped ? c.text.tertiary : c.text.primary,
                    textDecoration: dropped && !entry.locked ? 'line-through' : 'none',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.path}
                  {entry.type === 'dir' ? '/' : ''}
                </Box>
                <Box sx={{ ...c.type.caption, color: c.text.muted, flexShrink: 0 }}>
                  {entry.locked
                    ? entry.type === 'dir'
                      ? 'never shipped'
                      : 'auto'
                    : humanSize(entry.size)}
                </Box>
              </ButtonBase>
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
        }}
      >
        <Box sx={{ ...c.type.caption, color: c.text.tertiary, flex: 1 }}>
          {excludedCount === 0
            ? 'Shipping every included file.'
            : `Leaving out ${excludedCount} file${excludedCount === 1 ? '' : 's'}.`}
        </Box>
        <ButtonBase onClick={onClose} sx={{ ...primaryButton(c), px: 2 }}>
          Done
        </ButtonBase>
      </Box>
    </Drawer>
  );
};

export default ReleaseExcludeSheet;
