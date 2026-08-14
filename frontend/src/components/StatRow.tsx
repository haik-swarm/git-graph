import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { card } from '@/shared/styles/ui';
import { relativeTime } from '@/shared/graphLayout';
import type { AppEntry } from '@/components/AppPicker';

interface Meta {
  is_repo: boolean;
  commit_count: number;
  dirty_count: number;
  has_remote?: boolean;
  unpushed?: number;
}

interface Props {
  apps: AppEntry[];
  meta: Record<string, Meta>;
  onFocusDirty: () => void;
  dirtyActive: boolean;
  onFocusUnpushed: () => void;
  unpushedActive: boolean;
  syncing: boolean;
  /** ISO time of the last successful remote fetch; null means never. */
  syncedAt: string | null;
  onSyncRemotes: () => void;
}

/**
 * Headline numbers above the grid. The Dashboard archetype opens with the
 * state of the whole account before the per-item list, so "how much is
 * uncommitted right now" is answerable without reading 20 cards.
 */
const StatRow: React.FC<Props> = ({
  apps,
  meta,
  onFocusDirty,
  dirtyActive,
  onFocusUnpushed,
  unpushedActive,
  syncing,
  syncedAt,
  onSyncRemotes,
}) => {
  const c = useClaudeTokens();

  const stats = React.useMemo(() => {
    let tracked = 0;
    let commits = 0;
    let dirtyFiles = 0;
    let dirtyApps = 0;
    let unpushedCommits = 0;
    let unpushedApps = 0;
    for (const a of apps) {
      const m = meta[a.workspace_id];
      if (a.has_git && a.workspace_exists) tracked += 1;
      if (!m) continue;
      commits += m.commit_count ?? 0;
      if (m.dirty_count > 0) {
        dirtyFiles += m.dirty_count;
        dirtyApps += 1;
      }
      const ahead = m.unpushed ?? 0;
      if (ahead > 0) {
        unpushedCommits += ahead;
        unpushedApps += 1;
      }
    }
    return {
      tracked,
      commits,
      dirtyFiles,
      dirtyApps,
      unpushedCommits,
      unpushedApps,
      total: apps.length,
    };
  }, [apps, meta]);

  // Until a fetch lands, `unpushed` is counted against a remote-tracking ref
  // that nothing has moved, so the number is local-only and can be wrong in
  // either direction. Saying so is better than quietly showing a stale 0.
  const stale = !syncedAt;

  const cells: {
    key: string;
    icon: React.ReactNode;
    value: string;
    label: string;
    tone?: 'warning';
    onClick?: () => void;
    active?: boolean;
    footnote?: React.ReactNode;
  }[] = [
    {
      key: 'apps',
      icon: <AppsRoundedIcon />,
      value: stats.total.toLocaleString(),
      label: stats.total === 1 ? 'app' : 'apps',
    },
    {
      key: 'tracked',
      icon: <CallSplitRoundedIcon />,
      value: stats.tracked.toLocaleString(),
      label: 'tracked',
    },
    {
      key: 'commits',
      icon: <HistoryRoundedIcon />,
      value: stats.commits.toLocaleString(),
      label: stats.commits === 1 ? 'commit' : 'commits',
    },
    {
      key: 'dirty',
      icon: <RadioButtonCheckedRoundedIcon />,
      value: stats.dirtyFiles.toLocaleString(),
      label:
        stats.dirtyApps === 0
          ? 'all committed'
          : `uncommitted in ${stats.dirtyApps} app${stats.dirtyApps === 1 ? '' : 's'}`,
      tone: stats.dirtyFiles > 0 ? 'warning' : undefined,
      onClick: stats.dirtyFiles > 0 ? onFocusDirty : undefined,
      active: dirtyActive,
    },
    {
      key: 'unpushed',
      icon: <CloudUploadRoundedIcon />,
      value: stats.unpushedCommits.toLocaleString(),
      label:
        stats.unpushedApps === 0
          ? 'all pushed'
          : `to push in ${stats.unpushedApps} app${stats.unpushedApps === 1 ? '' : 's'}`,
      tone: stats.unpushedCommits > 0 ? 'warning' : undefined,
      onClick: stats.unpushedCommits > 0 ? onFocusUnpushed : undefined,
      active: unpushedActive,
      footnote: syncing ? (
        <SyncNote c={c} spinning>
          syncing with remote…
        </SyncNote>
      ) : stale ? (
        <SyncNote c={c} onClick={onSyncRemotes}>
          local only · sync
        </SyncNote>
      ) : (
        <SyncNote c={c} onClick={onSyncRemotes}>
          synced {relativeTime(syncedAt)}
        </SyncNote>
      ),
    },
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1.75,
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      }}
    >
      {cells.map(cell => {
        const clickable = Boolean(cell.onClick);
        const ink = cell.tone === 'warning' ? c.status.warning : c.text.primary;
        return (
          <Box
            key={cell.key}
            component={clickable ? 'button' : 'div'}
            onClick={cell.onClick}
            sx={{
              ...card(c, clickable),
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              px: 2,
              py: 1.75,
              textAlign: 'left',
              // Repeated under &:hover because card()'s hover rule would
              // otherwise repaint the border and hide that this is the
              // filter you're currently looking at.
              ...(cell.active && {
                borderColor: c.accent.primary,
                boxShadow: `0 0 0 3px rgba(${c.accentRgb},0.12)`,
                '&:hover': {
                  borderColor: c.accent.primary,
                  boxShadow: `0 0 0 3px rgba(${c.accentRgb},0.20)`,
                },
              }),
              '&:focus-visible': {
                outline: 'none',
                boxShadow: `0 0 0 3px rgba(${c.accentRgb},0.35)`,
              },
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: cell.tone === 'warning' ? c.status.warning : c.text.muted,
                '& svg': { fontSize: 14 },
              }}
            >
              {cell.icon}
              <Box sx={{ ...c.type.caption }}>{cell.label}</Box>
            </Box>
            <Box
              sx={{
                ...c.type.title2,
                color: ink,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {cell.value}
            </Box>
            {cell.footnote}
          </Box>
        );
      })}
    </Box>
  );
};

/**
 * The provenance line under the unpushed count. Clickable so a user who
 * doesn't trust the number can force the fetch instead of guessing when
 * the next background pass runs.
 */
const SyncNote: React.FC<{
  c: ReturnType<typeof useClaudeTokens>;
  spinning?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}> = ({ c, spinning, onClick, children }) => (
  <Box
    component={onClick ? 'button' : 'div'}
    onClick={
      onClick
        ? (e: React.MouseEvent) => {
            // The parent cell is itself a filter button.
            e.stopPropagation();
            onClick();
          }
        : undefined
    }
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      mt: '2px',
      p: 0,
      border: 'none',
      background: 'transparent',
      textAlign: 'left',
      cursor: onClick ? 'pointer' : 'default',
      ...c.type.caption,
      color: c.text.muted,
      transition: c.transition,
      ...(onClick && { '&:hover': { color: c.text.secondary } }),
      '& svg': { fontSize: 11 },
    }}
  >
    {spinning ? (
      <CircularProgress size={9} sx={{ color: c.text.muted }} />
    ) : (
      <CloudSyncRoundedIcon />
    )}
    {children}
  </Box>
);

export default StatRow;
