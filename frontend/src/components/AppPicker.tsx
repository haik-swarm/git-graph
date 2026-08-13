import React, { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import CheckIcon from '@mui/icons-material/Check';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { menuItem, menuSurface, pushButton } from '@/shared/styles/ui';
import { gitgraphInitUrl } from '@/shared/state/API_ENDPOINTS';

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
  onTracked?: (app: AppEntry) => void;
}

const AppPicker: React.FC<Props> = ({ apps, selected, onSelect, onTracked }) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  const trackApp = async (app: AppEntry) => {
    setTrackingId(app.workspace_id);
    setTrackError(null);
    try {
      const res = await fetch(gitgraphInitUrl(app.workspace_id), { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || `init ${res.status}`);
      }
      onTracked?.(app);
      setAnchor(null);
    } catch (err) {
      setTrackError(err instanceof Error ? err.message : 'Failed to track.');
    } finally {
      setTrackingId(null);
    }
  };

  return (
    <>
      <ButtonBase
        onClick={e => setAnchor(e.currentTarget)}
        sx={{ ...pushButton(c), minWidth: 210, justifyContent: 'space-between' }}
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
          const canTrack = app.workspace_exists && !app.has_git;
          const isTracking = trackingId === app.workspace_id;
          return (
            <Box
              key={app.workspace_id}
              sx={{
                ...menuItem(c),
                height: 'auto',
                py: '5px',
                alignItems: 'flex-start',
                cursor: 'default',
                '&:hover': { background: 'transparent' },
              }}
            >
              <ButtonBase
                onClick={() => {
                  onSelect(app);
                  setAnchor(null);
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1,
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  borderRadius: `${c.radius.sm}px`,
                  p: '2px',
                  '&:hover': { background: c.bg.secondary },
                }}
              >
                <Box sx={{ width: 14, flexShrink: 0, pt: '2px' }}>
                  {isSelected && (
                    <CheckIcon sx={{ fontSize: 12, color: c.accent.primary, display: 'block' }} />
                  )}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ ...c.type.body, color: c.text.primary, lineHeight: 1.35 }}>
                    {app.name}
                  </Typography>
                  {!app.workspace_exists ? (
                    <Typography sx={{ ...c.type.caption, color: c.status.error }}>
                      workspace missing
                    </Typography>
                  ) : !app.has_git ? (
                    <Typography sx={{ ...c.type.caption, color: c.text.tertiary }}>
                      not tracked
                    </Typography>
                  ) : null}
                </Box>
              </ButtonBase>
              {canTrack && (
                <ButtonBase
                  onClick={e => {
                    e.stopPropagation();
                    void trackApp(app);
                  }}
                  disabled={isTracking}
                  sx={{
                    ...pushButton(c),
                    flexShrink: 0,
                    mt: '2px',
                    ...c.type.caption,
                    fontWeight: 500,
                  }}
                >
                  {isTracking ? (
                    <CircularProgress size={10} sx={{ color: c.text.tertiary }} />
                  ) : (
                    'Track'
                  )}
                </ButtonBase>
              )}
            </Box>
          );
        })}

        {trackError && (
          <Typography
            sx={{ ...c.type.caption, color: c.status.error, px: '8px', py: '4px' }}
          >
            {trackError}
          </Typography>
        )}

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
