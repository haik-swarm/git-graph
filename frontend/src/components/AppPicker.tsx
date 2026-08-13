import React, { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import CheckIcon from '@mui/icons-material/Check';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { menuItem, menuSurface, pushButton } from '@/shared/styles/ui';

export interface AppEntry {
  id: string;
  name: string;
  description: string;
  workspace_id: string;
  workspace_exists: boolean;
  has_git: boolean;
  updated_at: string;
}

interface Props {
  apps: AppEntry[];
  selected: AppEntry | null;
  onSelect: (app: AppEntry) => void;
}

const AppPicker: React.FC<Props> = ({ apps, selected, onSelect }) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <ButtonBase
        onClick={e => setAnchor(e.currentTarget)}
        sx={{ ...pushButton(c), height: 28, px: '11px', minWidth: 210, justifyContent: 'space-between' }}
      >
        <Typography component="span" sx={{ ...c.type.headline, color: c.text.primary }}>
          {selected ? selected.name : 'Choose an app'}
        </Typography>
        <UnfoldMoreIcon sx={{ fontSize: 13, color: c.text.tertiary, ml: 1 }} />
      </ButtonBase>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: { sx: { ...menuSurface(c), mt: 0.5, minWidth: 280, maxHeight: 420 } },
        }}
      >
        {apps.map(app => {
          const isSelected = selected?.workspace_id === app.workspace_id;
          return (
            <Box
              key={app.workspace_id}
              component="button"
              onClick={() => {
                onSelect(app);
                setAnchor(null);
              }}
              sx={{ ...menuItem(c), height: 'auto', py: '5px', alignItems: 'flex-start' }}
            >
              <Box sx={{ width: 14, flexShrink: 0, pt: '2px' }}>
                {isSelected && (
                  <CheckIcon sx={{ fontSize: 12, color: c.accent.base, display: 'block' }} />
                )}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ ...c.type.body, color: c.text.primary, lineHeight: 1.35 }}>
                  {app.name}
                </Typography>
                {!app.workspace_exists ? (
                  <Typography sx={{ ...c.type.caption, color: c.status.danger }}>
                    workspace missing
                  </Typography>
                ) : !app.has_git ? (
                  <Typography sx={{ ...c.type.caption, color: c.text.quaternary }}>
                    no history yet
                  </Typography>
                ) : null}
              </Box>
            </Box>
          );
        })}

        {apps.length === 0 && (
          <Typography sx={{ ...c.type.callout, color: c.text.tertiary, px: '8px', py: '6px' }}>
            No apps found
          </Typography>
        )}
      </Popover>
    </>
  );
};

export default AppPicker;
