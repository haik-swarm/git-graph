import React, { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import CircularProgress from '@mui/material/CircularProgress';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { menuItem, menuSurface } from '@/shared/styles/ui';
import { gitgraphIgnoreUrl } from '@/shared/state/API_ENDPOINTS';

export interface IgnoreResult {
  added: string[];
  untracked: string[];
  scope: 'local' | 'global';
  rule: string;
}

interface Props {
  workspaceId: string;
  filePath: string;
  onIgnored: (result: IgnoreResult) => void;
  onError: (message: string) => void;
}

interface Choice {
  rule: string;
  label: string;
  hint: string;
  icon: React.ElementType;
}

/** The three patterns worth one click, widest last. */
export function choicesFor(filePath: string): Choice[] {
  const slash = filePath.lastIndexOf('/');
  const dir = slash === -1 ? '' : filePath.slice(0, slash + 1);
  const name = slash === -1 ? filePath : filePath.slice(slash + 1);
  const dot = name.lastIndexOf('.');

  const out: Choice[] = [
    {
      rule: `/${filePath}`,
      label: 'This file',
      hint: `/${filePath}`,
      icon: InsertDriveFileOutlinedIcon,
    },
  ];

  // A leading dot is the whole name (.env), not an extension, so it gets no
  // wildcard entry: `*.env` would not match `.env` and suggesting it is worse
  // than offering nothing.
  if (dot > 0) {
    const ext = name.slice(dot + 1);
    out.push({
      rule: `*.${ext}`,
      label: `All .${ext} files`,
      hint: `*.${ext}`,
      icon: FilterAltOutlinedIcon,
    });
  }

  if (dir) {
    out.push({
      rule: `/${dir}`,
      label: 'This whole folder',
      hint: `/${dir}`,
      icon: FolderOutlinedIcon,
    });
  }

  return out;
}

/**
 * Stop tracking one file. The button ignores the exact path in a single
 * click; the caret opens the wider patterns and the global option, which
 * writes into the shared list every tracked app mirrors.
 */
const IgnoreMenu: React.FC<Props> = ({
  workspaceId,
  filePath,
  onIgnored,
  onError,
}) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = useMemo(() => choicesFor(filePath), [filePath]);

  const apply = async (rule: string, globally: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(gitgraphIgnoreUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: [rule], globally }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? `Couldn't ignore that (${res.status})`);
      }
      const data = await res.json();
      setAnchor(null);
      onIgnored({
        added: data.added ?? [],
        untracked: data.untracked ?? [],
        scope: data.scope,
        rule,
      });
    } catch (err) {
      setAnchor(null);
      onError(err instanceof Error ? err.message : "We couldn't ignore that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ButtonBase
        disabled={busy}
        title="Stop tracking this file"
        onClick={e => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        sx={{
          height: 20,
          px: '6px',
          gap: '3px',
          flexShrink: 0,
          borderRadius: `${c.radius.xs}px`,
          ...c.type.caption,
          color: c.text.tertiary,
          border: `1px solid ${c.border.subtle}`,
          transition: c.transition,
          '&:hover': { color: c.text.primary, borderColor: c.border.strong },
        }}
      >
        {busy ? (
          <CircularProgress size={10} sx={{ color: c.text.tertiary }} />
        ) : (
          'Ignore'
        )}
      </ButtonBase>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => !busy && setAnchor(null)}
        onClick={e => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { ...menuSurface(c), mt: 0.5, width: 300 } } }}
      >
        <Box sx={{ px: '10px', pt: '6px', pb: '4px' }}>
          <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
            Add to this app's .gitignore
          </Box>
        </Box>

        {choices.map(choice => (
          <ButtonBase
            key={choice.rule}
            disabled={busy}
            onClick={() => void apply(choice.rule, false)}
            sx={{ ...menuItem(c) }}
          >
            <choice.icon sx={{ fontSize: 15, flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <Box sx={{ ...c.type.body, color: 'inherit' }}>{choice.label}</Box>
              <Box
                sx={{
                  ...c.type.caption,
                  fontFamily: c.font.mono,
                  color: c.text.muted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {choice.hint}
              </Box>
            </Box>
          </ButtonBase>
        ))}

        <Box
          sx={{
            mt: '4px',
            pt: '4px',
            borderTop: `1px solid ${c.border.subtle}`,
          }}
        >
          <ButtonBase
            disabled={busy}
            onClick={() => void apply(choices[0].rule, true)}
            sx={{ ...menuItem(c) }}
          >
            <PublicRoundedIcon sx={{ fontSize: 15, flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <Box sx={{ ...c.type.body, color: 'inherit' }}>
                Ignore in every app
              </Box>
              <Box sx={{ ...c.type.caption, color: c.text.muted }}>
                Adds to the shared global list
              </Box>
            </Box>
          </ButtonBase>
        </Box>
      </Popover>
    </>
  );
};

export default IgnoreMenu;
