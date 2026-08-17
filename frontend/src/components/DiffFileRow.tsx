import React from 'react';
import Box from '@mui/material/Box';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import DiffInline from '@/components/DiffInline';

interface Props {
  workspaceId: string | null;
  filePath: string;
  /** Omit for working-tree changes; pass a sha to read it inside a commit. */
  sha?: string;
  expanded: boolean;
  onToggle: () => void;
  /** `null` means git reported no countable lines, i.e. binary. `undefined`
   *  means the stats simply aren't known, which must not read as binary. */
  added: number | null | undefined;
  removed: number | null | undefined;
  /** Rendered before the chevron, outside the toggle (checkboxes, etc). */
  leading?: React.ReactNode;
  /** Rendered after the counts, outside the toggle (ignore menus, etc). */
  trailing?: React.ReactNode;
}

/**
 * One changed file: a header that IS the row, which opens to its own patch.
 *
 * The header deliberately mirrors the diff viewer's own rather than sitting
 * above it. Rendering both meant the path appeared twice the moment a row
 * was opened, once as the row you clicked and again inside the panel it
 * revealed, so the viewer's header is suppressed and this one stands in for
 * it whether the row is open or shut.
 */
const DiffFileRow: React.FC<Props> = ({
  workspaceId,
  filePath,
  sha,
  expanded,
  onToggle,
  added,
  removed,
  leading,
  trailing,
}) => {
  const c = useClaudeTokens();
  const slash = filePath.lastIndexOf('/');
  // The separator belongs to the filename, not the directory. The directory
  // renders in an RTL span so it clips from the left, and a trailing "/" is
  // bidi-neutral: with no strong left-to-right character after it, it takes
  // the span's direction and gets reordered to the far end, which dropped the
  // slash from between the two halves and pinned it to the start of the path.
  const dir = slash === -1 ? '' : filePath.slice(0, slash);
  const baseName = slash === -1 ? filePath : filePath.slice(slash + 1);
  const binary = added === null || removed === null;
  const unknown = added === undefined && removed === undefined;

  return (
    <Box
      sx={{
        borderRadius: `${c.radius.sm}px`,
        // The open row and its patch read as one object, so the border wraps
        // both rather than boxing the diff separately below the header.
        border: `1px solid ${expanded ? c.border.subtle : 'transparent'}`,
        background: expanded ? c.bg.surface : 'transparent',
        overflow: 'hidden',
        transition: c.transition,
        mb: expanded ? '4px' : 0,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          // Matches the diff viewer's own header (px-4 py-2) rather than the
          // tighter list padding it replaced: this row IS that header now, and
          // at list density it read as a cramped imitation of one.
          px: 2,
          py: 1,
          background: expanded ? c.bg.surface : 'transparent',
          borderBottom: `1px solid ${expanded ? c.border.subtle : 'transparent'}`,
          '&:hover': { background: expanded ? c.bg.surface : c.bg.secondary },
          '&:hover .row-trailing': { opacity: 1 },
        }}
      >
        {leading}

        <Box
          component="button"
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? 'Hide changes' : `View changes to ${filePath}`}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flex: 1,
            minWidth: 0,
            border: 'none',
            background: 'transparent',
            p: 0,
            cursor: 'pointer',
            textAlign: 'left',
            color: 'inherit',
            font: 'inherit',
            '&:hover .file-name': { color: c.accent.primary },
          }}
        >
          <ChevronRightRoundedIcon
            sx={{
              fontSize: 15,
              flexShrink: 0,
              color: expanded ? c.accent.primary : c.text.tertiary,
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: c.transition,
            }}
          />

          {/* The filename never truncates: it's the identifier you scan for.
              The directory is context, so it gives up its width first and
              clips from the left, keeping the part nearest the file.

              Sans at body size, not mono at caption size: this is the diff
              viewer's title, and setting a whole list of them in monospace
              made the panel read as output rather than as a header. */}
          <Box
            sx={{
              ...c.type.body,
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'baseline',
              overflow: 'hidden',
            }}
          >
            {dir && (
              <Box
                component="span"
                sx={{
                  color: c.text.muted,
                  minWidth: 0,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  direction: 'rtl',
                  textAlign: 'left',
                }}
              >
                {dir}
              </Box>
            )}
            <Box
              component="span"
              className="file-name"
              sx={{
                color: expanded ? c.accent.primary : c.text.primary,
                fontWeight: 500,
                flexShrink: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100%',
                transition: c.transition,
              }}
            >
              {/* The separator sits in this span for bidi reasons but reads as
                  part of the path, so it keeps the directory's colour. */}
              {dir && (
                <Box component="span" sx={{ color: c.text.muted, fontWeight: 400 }}>
                  /
                </Box>
              )}
              {baseName}
            </Box>
          </Box>
        </Box>

        {unknown ? null : binary ? (
          <Box sx={{ ...c.type.caption, color: c.text.tertiary, flexShrink: 0 }}>binary</Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexShrink: 0 }}>
            {(added ?? 0) > 0 && (
              <Box sx={{ ...tally(c), color: c.status.success }}>+{added}</Box>
            )}
            {(removed ?? 0) > 0 && (
              <Box sx={{ ...tally(c), color: c.status.error }}>−{removed}</Box>
            )}
          </Box>
        )}

        {trailing}
      </Box>

      {workspaceId && (
        <DiffInline
          workspaceId={workspaceId}
          filePath={filePath}
          sha={sha}
          open={expanded}
        />
      )}
    </Box>
  );
};

export const tally = (c: ReturnType<typeof useClaudeTokens>) => ({
  ...c.type.caption,
  fontSize: '0.75rem',
  fontFamily: c.font.mono,
  fontVariantNumeric: 'tabular-nums' as const,
});

export default DiffFileRow;
