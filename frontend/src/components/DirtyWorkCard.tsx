import React from 'react';
import Box from '@mui/material/Box';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import Collapse from '@mui/material/Collapse';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import DirtyDetails, { type DirtyFile } from './DirtyDetails';
import DiscardButton from './DiscardButton';
import MagicDraftButton from './MagicDraftButton';

export type { DirtyFile };

interface Props {
  workspaceId: string;
  dirty: DirtyFile[];
  hasRemote: boolean;
  magicBusy: boolean;
  onBusyChange: (b: boolean) => void;
  onCommitted: () => void;
  onDiscarded: () => void;
  onIgnored: () => void;
}

/**
 * A single card above the graph that surfaces uncommitted work directly.
 * The header is a disclosure row: it expands in place to the file list,
 * per-file diffs and the commit box, matching how a commit in the history
 * below opens. Both halves of the page then read the same way, where this
 * half used to hide its files behind a popover.
 */
const DirtyWorkCard: React.FC<Props> = ({
  workspaceId,
  dirty,
  hasRemote,
  magicBusy,
  onBusyChange,
  onCommitted,
  onDiscarded,
  onIgnored,
}) => {
  const c = useClaudeTokens();
  const [open, setOpen] = React.useState(false);
  // A drafted message is pushed down into the commit form rather than owned
  // by it, so the button above can fill the field it doesn't render.
  const [draft, setDraft] = React.useState<string | null>(null);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  // Once a message is drafted the card is mid-commit, so the header drops
  // back to a plain summary: re-drafting over the message you're about to
  // send, or discarding it outright, are not the next step from here.
  // `draft` can't carry this since it's cleared as soon as the field takes it.
  const [drafting, setDrafting] = React.useState(false);

  // Committing or discarding empties the list, so an open panel would be
  // left showing a stale form over nothing.
  React.useEffect(() => {
    if (dirty.length === 0) {
      setOpen(false);
      setDrafting(false);
    }
  }, [dirty.length]);

  const counts = React.useMemo(() => {
    const stat = { add: 0, edit: 0, remove: 0 };
    for (const f of dirty) {
      if (f.code === '??' || f.code.includes('A')) stat.add += 1;
      else if (f.code.includes('D')) stat.remove += 1;
      else stat.edit += 1;
    }
    return stat;
  }, [dirty]);

  const chip = (label: string, tone: 'add' | 'edit' | 'remove', Icon: React.ElementType) => {
    const color = tone === 'add' ? c.status.success : tone === 'remove' ? c.status.error : c.status.warning;
    return (
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          ...c.type.caption,
          color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <Icon sx={{ fontSize: 14 }} />
        {label}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        mx: 3,
        mb: 2,
        borderRadius: `${c.radius.xl}px`,
        border: `1px solid ${c.border.subtle}`,
        background: c.bg.surface,
        boxShadow: c.shadow.sm,
        // Signature detail: a hairline gradient stripe on the left communicates
        // "the working tree is diverging" without shouting.
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: `linear-gradient(180deg, ${c.status.warning}, ${c.accent.primary})`,
          zIndex: 1,
        },
      }}
    >
    <Box
      // The panel unmounts when it collapses, taking the pending message with
      // it, so collapsing has to mean the same thing as Cancel. Otherwise the
      // header comes back with its buttons hidden and no way to reach either.
      onClick={() => {
        if (dirty.length === 0) return;
        setOpen(prev => {
          if (prev) {
            setDrafting(false);
            setDraftError(null);
          }
          return !prev;
        });
      }}
      role="button"
      aria-expanded={open}
      sx={{
        p: 1.75,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        cursor: dirty.length > 0 ? 'pointer' : 'default',
        transition: c.transition,
        '&:hover': { background: dirty.length > 0 ? c.bg.secondary : 'transparent' },
      }}
    >
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: `${c.radius.md}px`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `rgba(255,149,0,${c.isDark ? 0.2 : 0.14})`,
          color: c.status.warning,
        }}
      >
        <RadioButtonCheckedRoundedIcon sx={{ fontSize: 16 }} />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ ...c.type.headline, color: c.text.primary }}>
          {dirty.length} uncommitted file{dirty.length === 1 ? '' : 's'}
        </Box>
        <Box sx={{ display: 'flex', gap: 1.25, mt: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
          {counts.add > 0 && chip(`${counts.add} new`, 'add', AddRoundedIcon)}
          {counts.edit > 0 && chip(`${counts.edit} modified`, 'edit', EditRoundedIcon)}
          {counts.remove > 0 && chip(`${counts.remove} removed`, 'remove', RemoveRoundedIcon)}
        </Box>
      </Box>

      {/* The action buttons open their own menus, so a click on one must not
          also toggle the card underneath it. */}
      <Box
        onClick={e => e.stopPropagation()}
        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}
      >
        {!drafting && (
          <MagicDraftButton
            workspaceId={workspaceId}
            onBusyChange={onBusyChange}
            // Expanding on click, before the message arrives, means the field
            // the text is headed for is already on screen when it lands.
            onStart={() => {
              setDraftError(null);
              setOpen(true);
            }}
            onDrafted={message => {
              setDraft(message);
              setDrafting(true);
            }}
            onError={setDraftError}
          />
        )}
        {!magicBusy && !drafting && (
          <DiscardButton
            workspaceId={workspaceId}
            dirtyCount={dirty.length}
            onDiscarded={onDiscarded}
          />
        )}
      </Box>

      <ExpandMoreRoundedIcon
        sx={{
          fontSize: 18,
          flexShrink: 0,
          color: open ? c.accent.primary : c.text.muted,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 180ms ease, color 120ms ease',
        }}
      />
    </Box>

    <Collapse in={open} timeout={180} unmountOnExit>
      <Box sx={{ borderTop: `1px solid ${c.border.subtle}`, pl: '3px' }}>
        <DirtyDetails
          workspaceId={workspaceId}
          dirty={dirty}
          hasRemote={hasRemote}
          draft={draft}
          draftError={draftError}
          onDraftConsumed={() => setDraft(null)}
          // Only offered while a drafted message is pending, so Cancel always
          // means "drop that message", never "collapse the panel".
          onCancel={
            drafting
              ? () => {
                  setDrafting(false);
                  setDraftError(null);
                  setOpen(false);
                }
              : null
          }
          // A partial commit leaves files behind, so the card survives and has
          // to return to its resting header rather than stay mid-commit.
          onCommitted={() => {
            setDrafting(false);
            onCommitted();
          }}
          onIgnored={onIgnored}
        />
      </Box>
    </Collapse>
    </Box>
  );
};

export default DirtyWorkCard;
