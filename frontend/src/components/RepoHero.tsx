import React from 'react';
import Box from '@mui/material/Box';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { BrandGlyph, Pill } from '@/components/Chrome';
import { relativeTime } from '@/shared/graphLayout';
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
}) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        px: 3,
        pt: 3,
        pb: 2,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
      }}
    >
      <BrandGlyph seed={app.workspace_id} letter={app.name[0] || '?'} size={44} />

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
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
            }}
          >
            {app.name}
          </Box>
          {currentBranch && (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                px: '7px',
                height: 20,
                borderRadius: `${c.radius.xs}px`,
                background: c.accent.wash,
                color: c.accent.base,
                ...c.type.caption,
                fontWeight: 590,
                fontFamily: c.font.mono,
              }}
            >
              <CallSplitRoundedIcon sx={{ fontSize: 11 }} />
              {currentBranch}
            </Box>
          )}
        </Box>

        {app.description && (
          <Box
            sx={{
              ...c.type.callout,
              color: c.text.secondary,
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
          <Pill>
            <HistoryRoundedIcon />
            {commitCount.toLocaleString()} commit{commitCount === 1 ? '' : 's'}
          </Pill>
          {branches.length > 1 && (
            <Pill>
              <CallSplitRoundedIcon />
              {branches.length} branches
            </Pill>
          )}
          {dirtyCount > 0 && (
            <Pill tone="warning">
              <RadioButtonCheckedRoundedIcon />
              {dirtyCount} uncommitted
            </Pill>
          )}
          {headDate && (
            <Box sx={{ ...c.type.caption, color: c.text.tertiary, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <ScheduleRoundedIcon sx={{ fontSize: 11 }} />
              last change {relativeTime(headDate)}
            </Box>
          )}
        </Box>

        {headSubject && (
          <Box
            sx={{
              mt: 1.5,
              px: 1.5,
              py: 1,
              borderRadius: `${c.radius.md}px`,
              background: c.bg.fill,
              border: `0.5px solid ${c.separator}`,
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
                background: c.accent.base,
                flexShrink: 0,
                boxShadow: `0 0 0 3px ${c.accent.wash}`,
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
