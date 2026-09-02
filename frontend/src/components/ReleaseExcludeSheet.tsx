import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded';
import UnfoldLessRoundedIcon from '@mui/icons-material/UnfoldLessRounded';
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

/** A node in the folder tree we build from the flat file list. */
interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  /** true for host-skipped dirs (node_modules, .git, …) and stripped files. */
  locked: boolean;
  size: number;
  /** A backend-collapsed locked dir — shown as a leaf, never expandable. */
  collapsedLocked: boolean;
  children: TreeNode[];
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

/** Build a nested folder tree from the flat `{path,type,locked,size}` list. */
function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = {
    name: '', path: '', type: 'dir', locked: false, size: 0,
    collapsedLocked: false, children: [],
  };
  const dirCache = new Map<string, TreeNode>();
  dirCache.set('', root);

  const ensureDir = (relPath: string): TreeNode => {
    if (dirCache.has(relPath)) return dirCache.get(relPath)!;
    const parts = relPath.split('/');
    const name = parts[parts.length - 1];
    const parent = ensureDir(parts.slice(0, -1).join('/'));
    const node: TreeNode = {
      name, path: relPath, type: 'dir', locked: false, size: 0,
      collapsedLocked: false, children: [],
    };
    parent.children.push(node);
    dirCache.set(relPath, node);
    return node;
  };

  for (const entry of files) {
    const parts = entry.path.split('/');
    const parent = ensureDir(parts.slice(0, -1).join('/'));
    if (entry.type === 'dir' && entry.locked) {
      // A collapsed host-skipped directory: a single locked leaf row.
      parent.children.push({
        name: parts[parts.length - 1], path: entry.path, type: 'dir',
        locked: true, size: 0, collapsedLocked: true, children: [],
      });
    } else {
      parent.children.push({
        name: parts[parts.length - 1], path: entry.path, type: 'file',
        locked: entry.locked, size: entry.size, collapsedLocked: false, children: [],
      });
    }
  }

  const sortRec = (node: TreeNode) => {
    node.children.sort((a, b) => {
      const aDir = a.type === 'dir' ? 0 : 1;
      const bDir = b.type === 'dir' ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    node.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

/** Every non-locked file path at or under a node. */
function descendantFiles(node: TreeNode, out: string[] = []): string[] {
  if (node.type === 'file') {
    if (!node.locked) out.push(node.path);
    return out;
  }
  for (const child of node.children) descendantFiles(child, out);
  return out;
}

/**
 * The release exclude-picker, rendered as a collapsible folder tree.
 *
 * A checked row ships in the .swarm; unchecked is left out. Folders carry a
 * tri-state checkbox (all / some / none of their files included) and toggling a
 * folder flips every file beneath it. Files the export always strips
 * (node_modules, .git, .env, oversized, …) come back `locked` — disabled rows
 * that read as "never included". The parent owns the excluded list (file paths
 * only) and sends it with the release; this sheet only edits it.
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
      setExpanded(new Set());
    }
  }, [open, load]);

  const excludedSet = useMemo(() => new Set(excluded), [excluded]);

  // A path is dropped if excluded outright or sitting under an excluded dir
  // (the dir form only survives from older saved selections; see normalize).
  const isExcluded = useCallback(
    (path: string) =>
      excludedSet.has(path) ||
      [...excludedSet].some(p => path.startsWith(`${p}/`)),
    [excludedSet],
  );

  const tree = useMemo(() => (files ? buildTree(files) : null), [files]);

  // Normalise any legacy dir-level exclusions down to plain file paths once the
  // list loads, so every mutation below can assume excluded holds files only.
  useEffect(() => {
    if (!tree) return;
    const norm = descendantFiles(tree).filter(isExcluded).sort();
    const changed =
      norm.length !== excluded.length || norm.some((p, i) => p !== excluded[i]);
    if (changed) onChange(norm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const toggleFile = useCallback(
    (path: string) => {
      const next = new Set(excludedSet);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      onChange([...next].sort());
    },
    [excludedSet, onChange],
  );

  const toggleFolder = useCallback(
    (node: TreeNode) => {
      const kids = descendantFiles(node);
      if (kids.length === 0) return;
      const next = new Set(excludedSet);
      const anyIncluded = kids.some(p => !next.has(p));
      // Any included → exclude the whole folder; otherwise re-include it all.
      for (const p of kids) {
        if (anyIncluded) next.add(p);
        else next.delete(p);
      }
      onChange([...next].sort());
    },
    [excludedSet, onChange],
  );

  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const allDirPaths = useMemo(() => {
    if (!tree) return [] as string[];
    const out: string[] = [];
    const walk = (n: TreeNode) => {
      for (const child of n.children) {
        if (child.type === 'dir' && !child.collapsedLocked) {
          out.push(child.path);
          walk(child);
        }
      }
    };
    walk(tree);
    return out;
  }, [tree]);

  const q = filter.trim().toLowerCase();

  // Which dir paths must be visible/open because a descendant file matches.
  const matchOpenDirs = useMemo(() => {
    if (!q || !tree) return null;
    const open = new Set<string>();
    const walk = (n: TreeNode): boolean => {
      if (n.type === 'file') return n.path.toLowerCase().includes(q);
      let hit = false;
      for (const child of n.children) {
        if (walk(child)) hit = true;
      }
      if (n.type === 'dir' && n.path && (hit || n.name.toLowerCase().includes(q))) {
        open.add(n.path);
      }
      return hit || (n.type === 'dir' && n.name.toLowerCase().includes(q));
    };
    walk(tree);
    return open;
  }, [q, tree]);

  // Flatten the tree into the visible, ordered rows honouring expand + filter.
  const rows = useMemo(() => {
    if (!tree) return [] as { node: TreeNode; depth: number; open: boolean }[];
    const out: { node: TreeNode; depth: number; open: boolean }[] = [];
    const visit = (node: TreeNode, depth: number) => {
      for (const child of node.children) {
        if (child.type === 'file') {
          if (q && !child.path.toLowerCase().includes(q)) continue;
          out.push({ node: child, depth, open: false });
        } else if (child.collapsedLocked) {
          if (q && !child.path.toLowerCase().includes(q)) continue;
          out.push({ node: child, depth, open: false });
        } else {
          // A real folder. In filter mode, only show it if it or a child hits.
          if (q && matchOpenDirs && !matchOpenDirs.has(child.path)) continue;
          const isOpen = q ? true : expanded.has(child.path);
          out.push({ node: child, depth, open: isOpen });
          if (isOpen) visit(child, depth + 1);
        }
      }
    };
    visit(tree, 0);
    return out;
  }, [tree, expanded, q, matchOpenDirs]);

  // Per-folder tri-state, memoised over its descendant files.
  const folderState = useCallback(
    (node: TreeNode): 'checked' | 'mixed' | 'empty' | 'none' => {
      const kids = descendantFiles(node);
      if (kids.length === 0) return 'empty';
      const excl = kids.filter(p => excludedSet.has(p)).length;
      if (excl === 0) return 'checked';
      if (excl === kids.length) return 'none';
      return 'mixed';
    },
    [excludedSet],
  );

  const excludableCount = useMemo(
    () => (files ? files.filter(f => f.type === 'file' && !f.locked).length : 0),
    [files],
  );
  const excludedCount = useMemo(
    () =>
      files
        ? files.filter(f => f.type === 'file' && !f.locked && excludedSet.has(f.path)).length
        : 0,
    [files, excludedSet],
  );

  const setAll = useCallback(
    (exclude: boolean) => {
      if (!files) return;
      if (!exclude) {
        onChange([]);
        return;
      }
      onChange(files.filter(f => f.type === 'file' && !f.locked).map(f => f.path).sort());
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
          onClick={() => setExpanded(new Set(allDirPaths))}
          disabled={!!q || allDirPaths.length === 0}
          title="Expand all folders"
          sx={{ ...pushButton(c), px: 0.75, minWidth: 32 }}
        >
          <UnfoldMoreRoundedIcon sx={{ fontSize: 15 }} />
        </ButtonBase>
        <ButtonBase
          onClick={() => setExpanded(new Set())}
          disabled={!!q || expanded.size === 0}
          title="Collapse all folders"
          sx={{ ...pushButton(c), px: 0.75, minWidth: 32 }}
        >
          <UnfoldLessRoundedIcon sx={{ fontSize: 15 }} />
        </ButtonBase>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', ...slimScroll(c), px: 1, py: 0.5 }}>
        {files === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={18} sx={{ color: c.accent.primary }} />
          </Box>
        ) : error ? (
          <Box sx={{ ...c.type.body, color: c.status.error, px: 1, py: 2 }}>{error}</Box>
        ) : rows.length === 0 ? (
          <Box sx={{ ...c.type.body, color: c.text.tertiary, px: 1, py: 2 }}>
            {q ? 'No files match.' : 'No files.'}
          </Box>
        ) : (
          rows.map(({ node, depth, open }) => {
            const isFolder = node.type === 'dir' && !node.collapsedLocked;
            const state = isFolder ? folderState(node) : null;
            const checked = node.locked
              ? false
              : isFolder
                ? state === 'checked' || state === 'empty'
                : !excludedSet.has(node.path);
            const mixed = state === 'mixed';
            const dropped = node.locked || (!isFolder && !checked);
            const indent = 8 + depth * 15;

            return (
              <ButtonBase
                key={node.path}
                onClick={() => {
                  if (node.locked) return;
                  if (isFolder) toggleFolder(node);
                  else toggleFile(node.path);
                }}
                disabled={node.locked}
                sx={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  gap: 0.75,
                  pr: 1,
                  py: '5px',
                  pl: `${indent}px`,
                  borderRadius: `${c.radius.sm}px`,
                  cursor: node.locked ? 'default' : 'pointer',
                  opacity: node.locked ? 0.5 : 1,
                  '&:hover': node.locked ? {} : { bgcolor: c.bg.secondary },
                }}
              >
                {/* Expand / collapse chevron (folders only). */}
                <Box
                  onClick={
                    isFolder
                      ? e => {
                          e.stopPropagation();
                          if (!q) toggleExpand(node.path);
                        }
                      : undefined
                  }
                  sx={{
                    width: 16,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: c.text.tertiary,
                  }}
                >
                  {isFolder &&
                    (open ? (
                      <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />
                    ) : (
                      <KeyboardArrowRightRoundedIcon sx={{ fontSize: 16 }} />
                    ))}
                </Box>

                {/* Checkbox / lock. */}
                <Box
                  sx={{
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    borderRadius: '4px',
                    border: `1.5px solid ${
                      node.locked
                        ? c.border.strong
                        : checked || mixed
                          ? c.accent.primary
                          : c.border.strong
                    }`,
                    bgcolor: !node.locked && (checked || mixed) ? c.accent.primary : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {!node.locked && mixed && (
                    <RemoveRoundedIcon sx={{ fontSize: 13, color: '#FFFFFF' }} />
                  )}
                  {!node.locked && !mixed && checked && (
                    <CheckRoundedIcon sx={{ fontSize: 13, color: '#FFFFFF' }} />
                  )}
                  {node.locked && (
                    <LockRoundedIcon sx={{ fontSize: 11, color: c.text.muted }} />
                  )}
                </Box>

                {/* Type icon. */}
                {node.type === 'dir' ? (
                  open && isFolder ? (
                    <FolderOpenRoundedIcon sx={{ fontSize: 15, color: c.text.tertiary, flexShrink: 0 }} />
                  ) : (
                    <FolderRoundedIcon sx={{ fontSize: 15, color: c.text.tertiary, flexShrink: 0 }} />
                  )
                ) : (
                  <InsertDriveFileOutlinedIcon
                    sx={{ fontSize: 15, color: c.text.tertiary, flexShrink: 0 }}
                  />
                )}

                {/* Name (just the segment, not the whole path). */}
                <Box
                  sx={{
                    ...c.type.body,
                    fontFamily: c.font.mono,
                    fontWeight: isFolder ? 600 : 400,
                    color: dropped ? c.text.tertiary : c.text.primary,
                    textDecoration: dropped && !node.locked && !isFolder ? 'line-through' : 'none',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.name}
                  {node.type === 'dir' ? '/' : ''}
                </Box>

                {/* Trailing badge. */}
                <Box sx={{ ...c.type.caption, color: c.text.muted, flexShrink: 0 }}>
                  {node.locked
                    ? node.type === 'dir'
                      ? 'never shipped'
                      : 'auto'
                    : node.type === 'file'
                      ? humanSize(node.size)
                      : ''}
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
            : `Leaving out ${excludedCount} of ${excludableCount} file${
                excludableCount === 1 ? '' : 's'
              }.`}
        </Box>
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
        <ButtonBase onClick={onClose} sx={{ ...primaryButton(c), px: 2 }}>
          Done
        </ButtonBase>
      </Box>
    </Drawer>
  );
};

export default ReleaseExcludeSheet;
