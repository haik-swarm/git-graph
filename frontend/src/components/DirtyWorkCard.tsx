import React from 'react';
import Box from '@mui/material/Box';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import CommitPanel, { type DirtyFile } from './CommitPanel';
import DiscardButton from './DiscardButton';
import MagicUpdateButton from './MagicUpdateButton';

interface Props {
  workspaceId: string;
  dirty: DirtyFile[];
  hasRemote: boolean;
  magicBusy: boolean;
  onBusyChange: (b: boolean) => void;
  onCommitted: () => void;
  onDiscarded: () => void;
  onMagicDone: () => void;
  onViewDiff: (path: string) => void;
  onIgnored: () => void;
}

/**
 * A single card above the graph that surfaces uncommitted work directly:
 * you can see the file mix at a glance and the three primary actions sit
 * in the same place every time. Previous design buried these behind three
 * separate toolbar chips.
 */
const DirtyWorkCard: React.FC<Props> = ({
  workspaceId,
  dirty,
  hasRemote,
  magicBusy,
  onBusyChange,
  onCommitted,
  onDiscarded,
  onMagicDone,
  onViewDiff,
  onIgnored,
}) => {
  const c = useClaudeTokens();

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
        p: 1.75,
        borderRadius: `${c.radius.xl}px`,
        border: `1px solid ${c.border.subtle}`,
        background: c.bg.surface,
        boxShadow: c.shadow.sm,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
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
        },
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

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <MagicUpdateButton
          workspaceId={workspaceId}
          hasRemote={hasRemote}
          onBusyChange={onBusyChange}
          onDone={onMagicDone}
        />
        {!magicBusy && (
          <>
            <CommitPanel
              workspaceId={workspaceId}
              dirty={dirty}
              onCommitted={onCommitted}
              onViewDiff={onViewDiff}
              onIgnored={onIgnored}
            />
            <DiscardButton
              workspaceId={workspaceId}
              dirtyCount={dirty.length}
              onDiscarded={onDiscarded}
            />
          </>
        )}
      </Box>
    </Box>
  );
};

export default DirtyWorkCard;
