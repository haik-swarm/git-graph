import React from 'react';
import Box from '@mui/material/Box';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { BrandGlyph, Pill } from '@/components/Chrome';
import Sparkline from '@/components/Sparkline';
import { absoluteTime, commitHistogram, relativeTime } from '@/shared/graphLayout';
import { pushButton } from '@/shared/styles/ui';
import type { AppEntry } from '@/components/AppPicker';

interface Meta {
  is_repo: boolean;
  commit_count: number;
  dirty_count: number;
  current_branch: string | null;
  head_subject: string | null;
  head_date: string | null;
  head_sha?: string | null;
}

interface Props {
  apps: AppEntry[];
  meta: Record<string, Meta>;
  onOpen: (app: AppEntry) => void;
}

/**
 * Home's answer to RepoHero: what changed most recently across the whole
 * account, rather than only how much exists. The counts below stay the
 * summary; this is the "what just happened" the app page gets for free.
 */
const HomeHero: React.FC<Props> = ({ apps, meta, onOpen }) => {
  const c = useClaudeTokens();

  const latest = React.useMemo(() => {
    let best: { app: AppEntry; m: Meta; t: number } | null = null;
    for (const app of apps) {
      const m = meta[app.workspace_id];
      if (!m?.is_repo || !m.head_date || !m.head_subject) continue;
      const t = new Date(m.head_date).getTime();
      if (Number.isNaN(t)) continue;
      if (!best || t > best.t) best = { app, m, t };
    }
    return best;
  }, [apps, meta]);

  // One bucket per app's HEAD, so the shape reads as "when was each app last
  // touched" across the account. A per-commit histogram would need every
  // app's full log, which Home deliberately never fetches.
  const histogram = React.useMemo(
    () =>
      commitHistogram(
        apps
          .map(a => meta[a.workspace_id]?.head_date)
          .filter((d): d is string => Boolean(d)),
      ),
    [apps, meta],
  );

  const totals = React.useMemo(() => {
    let commits = 0;
    let dirtyApps = 0;
    let active = 0;
    for (const app of apps) {
      const m = meta[app.workspace_id];
      if (!m?.is_repo) continue;
      active += 1;
      commits += m.commit_count ?? 0;
      if ((m.dirty_count ?? 0) > 0) dirtyApps += 1;
    }
    return { commits, dirtyApps, active };
  }, [apps, meta]);

  if (!latest) return null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
      <BrandGlyph
        seed={latest.app.workspace_id}
        letter={latest.app.name[0] || '?'}
        size={44}
      />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 1.25,
            flexWrap: 'wrap',
          }}
        >
          <Pill>
            <HistoryRoundedIcon />
            {totals.commits.toLocaleString()} commit
            {totals.commits === 1 ? '' : 's'} across {totals.active} app
            {totals.active === 1 ? '' : 's'}
          </Pill>
          {totals.dirtyApps > 0 && (
            <Pill tone="warning">
              <RadioButtonCheckedRoundedIcon />
              {totals.dirtyApps} app{totals.dirtyApps === 1 ? '' : 's'} with
              uncommitted work
            </Pill>
          )}
          <Box sx={{ flex: 1 }} />
          <Sparkline values={histogram} />
        </Box>

        <Box
          onClick={() => onOpen(latest.app)}
          role="button"
          sx={{
            px: 1.5,
            py: 1,
            borderRadius: `${c.radius.md}px`,
            background: c.bg.secondary,
            border: `1px solid ${c.border.subtle}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            cursor: 'pointer',
            transition: c.transition,
            '&:hover': {
              borderColor: c.border.strong,
              background: c.bg.surface,
            },
          }}
        >
          <Box
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: c.accent.primary,
              flexShrink: 0,
              boxShadow: `0 0 0 3px ${`rgba(${c.accentRgb},0.10)`}`,
            }}
          />
          <Box
            sx={{
              ...c.type.callout,
              color: c.text.primary,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <Box component="span" sx={{ fontWeight: 500 }}>
              {latest.app.name}
            </Box>
            <Box component="span" sx={{ color: c.text.muted }}>
              {' · '}
            </Box>
            {latest.m.head_subject}
          </Box>

          {latest.m.current_branch && (
            <Box
              sx={{
                ...c.type.caption,
                fontFamily: c.font.mono,
                color: c.text.tertiary,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                flexShrink: 0,
              }}
            >
              <CallSplitRoundedIcon sx={{ fontSize: 13 }} />
              {latest.m.current_branch}
            </Box>
          )}
          {latest.m.head_date && (
            <Box
              title={absoluteTime(latest.m.head_date)}
              sx={{
                ...c.type.caption,
                color: c.text.tertiary,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                flexShrink: 0,
              }}
            >
              <ScheduleRoundedIcon sx={{ fontSize: 14 }} />
              {relativeTime(latest.m.head_date)}
            </Box>
          )}
          {latest.m.head_sha && (
            <Box
              sx={{
                ...c.type.caption,
                fontFamily: c.font.mono,
                color: c.text.tertiary,
                flexShrink: 0,
              }}
            >
              {latest.m.head_sha.slice(0, 7)}
            </Box>
          )}

          <Box
            component="span"
            sx={{ ...pushButton(c), minHeight: 26, px: 1.25, flexShrink: 0 }}
          >
            Open
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default HomeHero;
