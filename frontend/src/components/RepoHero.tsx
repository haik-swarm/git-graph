import React from 'react';
import Box from '@mui/material/Box';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { BrandGlyph } from '@/components/Chrome';
import Sparkline from '@/components/Sparkline';
import { absoluteTime, commitHistogram, relativeTime } from '@/shared/graphLayout';
import { statusChip } from '@/shared/styles/ui';
import type { AppEntry } from '@/components/AppPicker';

interface Props {
  app: AppEntry;
  currentBranch: string | null;
  branches: string[];
  headSubject: string | null;
  headSha: string | null;
  headDate: string | null;
  commitCount: number;
  dirtyCount: number;
  commitDates: string[];
  onIconChange?: () => void;
}

/**
 * The identity strip at the top of the content well. Establishes which
 * repo you're looking at, on which branch, and how alive it is, so the
 * scrolling commit history below reads as history of THIS thing.
 */
const RepoHero: React.FC<Props> = ({
  app,
  currentBranch,
  branches,
  headSubject,
  headSha,
  headDate,
  commitCount,
  dirtyCount,
  commitDates,
  onIconChange,
}) => {
  const c = useClaudeTokens();
  const histogram = React.useMemo(() => commitHistogram(commitDates), [commitDates]);
  return (
    <Box
      sx={{
        px: 3,
        pt: 3.5,
        pb: 2.5,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.75,
      }}
    >
      <BrandGlyph
        seed={app.workspace_id}
        letter={app.name[0] || '?'}
        size={40}
        iconId={app.workspace_id}
        hasIcon={app.has_icon}
        downloadable
        downloadName={app.name}
        croppable
        onIconChange={onIconChange}
      />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 1.25,
            flexWrap: 'wrap',
          }}
        >
          <Box
            sx={{
              ...c.type.title,
              color: c.text.primary,
              lineHeight: 1.15,
            }}
          >
            {app.name}
          </Box>
          {currentBranch && (
            <Box
              sx={{ ...statusChip(c, 'neutral'), fontFamily: c.font.mono, fontSize: '0.6875rem', alignSelf: 'center' }}
            >
              <CallSplitRoundedIcon />
              {currentBranch}
            </Box>
          )}
        </Box>

        {app.description && (
          <Box
            sx={{
              ...c.type.body,
              color: c.text.tertiary,
              mt: '4px',
              lineHeight: 1.45,
              maxWidth: 680,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {app.description}
          </Box>
        )}

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mt: 1.5,
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', ...c.type.caption, color: c.text.tertiary, fontVariantNumeric: 'tabular-nums' }}>
            <span>{commitCount.toLocaleString()} commit{commitCount === 1 ? '' : 's'}</span>
            {branches.length > 1 && (
              <>
                <Box component="span" sx={{ color: c.text.ghost }}>·</Box>
                <span>{branches.length} branches</span>
              </>
            )}
            {dirtyCount > 0 && (
              <>
                <Box component="span" sx={{ color: c.text.ghost }}>·</Box>
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: c.text.secondary }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: c.status.warning }} />
                  {dirtyCount} uncommitted
                </Box>
              </>
            )}
            {headDate && (
              <>
                <Box component="span" sx={{ color: c.text.ghost }}>·</Box>
                <span title={absoluteTime(headDate)}>updated {relativeTime(headDate)}</span>
              </>
            )}
          </Box>

          <Box sx={{ flex: 1 }} />
          <Sparkline values={histogram} />
        </Box>

        {headSubject && (
          <Box
            sx={{
              mt: 1.5,
              px: 1.25,
              py: '7px',
              borderRadius: `${c.radius.sm}px`,
              background: c.bg.surface,
              border: `1px solid ${c.border.medium}`,
              boxShadow: c.shadow.sm,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              maxWidth: 680,
            }}
          >
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: c.status.success,
                flexShrink: 0,
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
              {headSubject}
            </Box>
            {headSha && (
              <Box
                sx={{
                  ...c.type.caption,
                  fontFamily: c.font.mono,
                  color: c.text.tertiary,
                  flexShrink: 0,
                }}
              >
                {headSha.slice(0, 7)}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default RepoHero;
