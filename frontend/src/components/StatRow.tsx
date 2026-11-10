import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import PublishRoundedIcon from '@mui/icons-material/PublishRounded';
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
  /** Singular noun for the headline labels ('app', 'skill', or 'item'). */
  noun?: string;
  onFocusDirty: () => void;
  dirtyActive: boolean;
  onFocusUnpushed: () => void;
  unpushedActive: boolean;
  onFocusUnpublished: () => void;
  unpublishedActive: boolean;
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
  noun = 'app',
  onFocusDirty,
  dirtyActive,
  onFocusUnpushed,
  unpushedActive,
  onFocusUnpublished,
  unpublishedActive,
  syncing,
  syncedAt,
  onSyncRemotes,
}) => {
  const c = useClaudeTokens();
  const nounFor = (n: number) => `${noun}${n === 1 ? '' : 's'}`;

  const stats = React.useMemo(() => {
    let tracked = 0;
    let commits = 0;
    let dirtyFiles = 0;
    let dirtyApps = 0;
    let unpushedCommits = 0;
    let unpushedApps = 0;
    let unpublishedApps = 0;
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
      // Tracked with commits but no remote: never published to GitHub. Kept
      // apart from `unpushed`, which needs a remote to be ahead of one.
      if (
        a.has_git &&
        a.workspace_exists &&
        m.is_repo &&
        m.has_remote === false &&
        (m.commit_count ?? 0) > 0
      ) {
        unpublishedApps += 1;
      }
    }
    return {
      tracked,
      commits,
      dirtyFiles,
      dirtyApps,
      unpushedCommits,
      unpushedApps,
      unpublishedApps,
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
    tone?: 'warning' | 'accent';
    onClick?: () => void;
    active?: boolean;
    footnote?: React.ReactNode;
  }[] = [
    {
      key: 'apps',
      icon: <AppsRoundedIcon />,
      value: stats.total.toLocaleString(),
      label: nounFor(stats.total),
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
          : `uncommitted in ${stats.dirtyApps} ${nounFor(stats.dirtyApps)}`,
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
          : `to push in ${stats.unpushedApps} ${nounFor(stats.unpushedApps)}`,
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
    {
      key: 'unpublished',
      icon: <PublishRoundedIcon />,
      value: stats.unpublishedApps.toLocaleString(),
      label:
        stats.unpublishedApps === 0
          ? 'all published'
          : `never published`,
      tone: stats.unpublishedApps > 0 ? 'accent' : undefined,
      onClick: stats.unpublishedApps > 0 ? onFocusUnpublished : undefined,
      active: unpublishedActive,
    },
  ];

  return (
    <Box
      sx={{
        ...card(c),
        display: 'flex',
        alignItems: 'stretch',
        overflowX: 'auto',
        '& > *:not(:last-child)': { borderRight: `1px solid ${c.border.subtle}` },
      }}
    >
      {cells.map(cell => {
        const clickable = Boolean(cell.onClick);
        const dot =
          cell.tone === 'warning'
            ? c.status.warning
            : cell.tone === 'accent'
              ? c.text.primary
              : null;
        return (
          <Box
            key={cell.key}
            component={clickable ? 'button' : 'div'}
            onClick={cell.onClick}
            sx={{
              flex: '1 1 0',
              minWidth: 112,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: '3px',
              px: 1.75,
              py: 1.25,
              textAlign: 'left',
              border: 'none',
              background: cell.active ? c.bg.secondary : 'transparent',
              fontFamily: c.font.sans,
              cursor: clickable ? 'pointer' : 'default',
              transition: c.transition,
              position: 'relative',
              ...(clickable && { '&:hover': { background: c.bg.secondary } }),
              ...(cell.active && {
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  left: 14,
                  right: 14,
                  bottom: 0,
                  height: '2px',
                  borderRadius: 1,
                  background: c.text.primary,
                },
              }),
              '&:focus-visible': {
                outline: 'none',
                boxShadow: `inset 0 0 0 2px rgba(${c.focusRgb},0.5)`,
              },
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '6px',
              }}
            >
              <Box
                sx={{
                  ...c.type.title3,
                  fontWeight: 600,
                  color: c.text.primary,
                  lineHeight: 1.2,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {cell.value}
              </Box>
              {dot && (
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: dot, alignSelf: 'center' }} />
              )}
            </Box>
            <Box
              sx={{
                ...c.type.caption,
                color: c.text.tertiary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {cell.label}
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
      mt: 0,
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
      whiteSpace: 'nowrap',
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
