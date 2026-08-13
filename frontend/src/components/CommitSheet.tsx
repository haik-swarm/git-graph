import React from 'react';
import Box from '@mui/material/Box';
import Fade from '@mui/material/Fade';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { iconButton, slimScroll } from '@/shared/styles/ui';
import { Pill } from '@/components/Chrome';
import { laneColor, relativeTime, type PlacedCommit } from '@/shared/graphLayout';
import RestoreControl from '@/components/RestoreControl';

interface CommitFile {
  path: string;
  added: number | null;
  removed: number | null;
}

interface Props {
  commit: PlacedCommit | null;
  files: CommitFile[] | null;
  workspaceId: string | null;
  headSha: string | null;
  currentBranch: string | null;
  branches: string[];
  onClose: () => void;
  onRestored: () => void;
}

/**
 * Right-hand inspector for one commit. Fixed width, animates in on select,
 * keeps the graph scroll position intact behind it so returning to context
 * is a single click on the backdrop.
 */
const CommitSheet: React.FC<Props> = ({
  commit,
  files,
  workspaceId,
  headSha,
  currentBranch,
  branches,
  onClose,
  onRestored,
}) => {
  const c = useClaudeTokens();
  const open = Boolean(commit);
  const branchSet = React.useMemo(() => new Set(branches), [branches]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const totals = React.useMemo(() => {
    if (!files) return null;
    let added = 0;
    let removed = 0;
    let binary = 0;
    for (const f of files) {
      if (f.added === null) binary += 1;
      else added += f.added;
      if (f.removed !== null) removed += f.removed;
    }
    return { added, removed, binary };
  }, [files]);

  const isHead = commit?.sha === headSha;
  const localTips = commit
    ? commit.refs.filter(r => branchSet.has(r) && r !== currentBranch)
    : [];
  const preferred = localTips.find(r => !r.startsWith('restore/'));
  const switchTo = preferred ?? localTips[0] ?? null;

  return (
    <Fade in={open} timeout={140} unmountOnExit>
      <Box sx={{ position: 'fixed', inset: 0, zIndex: 20, display: 'flex' }}>
        <Box
          onClick={onClose}
          sx={{
            flex: 1,
            background: c.isDark ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.12)',
            backdropFilter: 'blur(1px)',
          }}
        />
        <Box
          role="dialog"
          aria-modal="true"
          aria-label="Commit details"
          sx={{
            width: 380,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            background: c.bg.window,
            borderLeft: `0.5px solid ${c.border}`,
            boxShadow: c.shadow.popover,
            outline: 'none',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              height: 48,
              flexShrink: 0,
              px: 1.5,
              borderBottom: `0.5px solid ${c.separator}`,
            }}
          >
            {commit && (
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: laneColor(commit.lane),
                  boxShadow: `0 0 0 3px ${laneColor(commit.lane)}22`,
                  flexShrink: 0,
                }}
              />
            )}
            <Box sx={{ flex: 1, ...c.type.footnote, color: c.text.tertiary }}>Commit</Box>
            {commit && (
              <Box
                sx={{
                  ...c.type.caption,
                  fontFamily: c.font.mono,
                  color: c.text.tertiary,
                }}
              >
                {commit.short}
              </Box>
            )}
            <Box
              component="button"
              onClick={onClose}
              aria-label="Close"
              sx={{
                ...iconButton(c, 24),
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                '& svg': { fontSize: 15 },
              }}
            >
              <CloseRoundedIcon />
            </Box>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2, ...slimScroll(c) }}>
            {commit && (
              <>
                <Box
                  sx={{
                    ...c.type.title3,
                    color: c.text.primary,
                    lineHeight: 1.3,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {commit.subject}
                </Box>

                <Box sx={{ display: 'flex', gap: 0.75, mt: 1.5, flexWrap: 'wrap' }}>
                  {isHead && <Pill tone="accent">current</Pill>}
                  {commit.refs.map(ref => (
                    <Box
                      key={ref}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        px: '7px',
                        height: 18,
                        borderRadius: `${c.radius.xs}px`,
                        ...c.type.caption,
                        fontFamily: c.font.mono,
                        color: laneColor(commit.lane),
                        border: `0.5px solid ${laneColor(commit.lane)}`,
                      }}
                    >
                      <CallSplitRoundedIcon sx={{ fontSize: 10 }} />
                      {ref}
                    </Box>
                  ))}
                </Box>

                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <MetaRow icon={<PersonRoundedIcon />} label="Author" value={commit.author} />
                  <MetaRow
                    icon={<ScheduleRoundedIcon />}
                    label="Date"
                    value={`${relativeTime(commit.date)} · ${new Date(commit.date).toLocaleString()}`}
                  />
                  {commit.parents.length > 0 && (
                    <MetaRow
                      icon={<CallSplitRoundedIcon />}
                      label={commit.parents.length > 1 ? 'Parents' : 'Parent'}
                      value={commit.parents.map(p => p.slice(0, 7)).join(' · ')}
                      mono
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    mt: 2.5,
                    pt: 1.5,
                    borderTop: `0.5px solid ${c.separator}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                  }}
                >
                  <DescriptionOutlinedIcon sx={{ fontSize: 13, color: c.text.tertiary }} />
                  <Box sx={{ ...c.type.footnote, color: c.text.tertiary, flex: 1 }}>
                    Changes
                  </Box>
                  {totals && (files?.length ?? 0) > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      {totals.added > 0 && (
                        <Box
                          sx={{
                            ...c.type.caption,
                            fontFamily: c.font.mono,
                            color: c.status.success,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          +{totals.added.toLocaleString()}
                        </Box>
                      )}
                      {totals.removed > 0 && (
                        <Box
                          sx={{
                            ...c.type.caption,
                            fontFamily: c.font.mono,
                            color: c.status.danger,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          −{totals.removed.toLocaleString()}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>

                <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column' }}>
                  {files === null ? (
                    <Box sx={{ ...c.type.caption, color: c.text.tertiary, py: 1 }}>
                      Loading changes…
                    </Box>
                  ) : files.length === 0 ? (
                    <Box sx={{ ...c.type.caption, color: c.text.tertiary, py: 1 }}>
                      No file changes.
                    </Box>
                  ) : (
                    files.map(f => (
                      <Box
                        key={f.path}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          py: '6px',
                          borderTop: `0.5px solid ${c.separator}`,
                          '&:first-of-type': { borderTop: 'none' },
                        }}
                      >
                        <Box
                          sx={{
                            ...c.type.caption,
                            fontFamily: c.font.mono,
                            color: c.text.primary,
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            direction: 'rtl',
                            textAlignLast: 'left',
                          }}
                        >
                          {f.path}
                        </Box>
                        {f.added === null ? (
                          <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>bin</Box>
                        ) : (
                          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                            <Box
                              sx={{
                                ...c.type.caption,
                                fontFamily: c.font.mono,
                                color: c.status.success,
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              +{f.added}
                            </Box>
                            {f.removed !== null && f.removed > 0 && (
                              <Box
                                sx={{
                                  ...c.type.caption,
                                  fontFamily: c.font.mono,
                                  color: c.status.danger,
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                −{f.removed}
                              </Box>
                            )}
                          </Box>
                        )}
                      </Box>
                    ))
                  )}
                </Box>
              </>
            )}
          </Box>

          {commit && workspaceId && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2.5,
                py: 1.5,
                flexShrink: 0,
                borderTop: `0.5px solid ${c.separator}`,
              }}
            >
              <Box
                sx={{
                  flex: 1,
                  ...c.type.caption,
                  color: c.text.tertiary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {isHead ? 'This is the current tip.' : 'Move working tree to this commit'}
              </Box>
              <RestoreControl
                workspaceId={workspaceId}
                sha={commit.sha}
                shortSha={commit.short}
                subject={commit.subject}
                isHead={isHead}
                switchTo={switchTo}
                onRestored={onRestored}
              />
            </Box>
          )}
        </Box>
      </Box>
    </Fade>
  );
};

const MetaRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}> = ({ icon, label, value, mono }) => {
  const c = useClaudeTokens();
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      <Box
        sx={{
          width: 18,
          color: c.text.tertiary,
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'flex-start',
          '& svg': { fontSize: 12 },
        }}
      >
        {icon}
      </Box>
      <Box sx={{ ...c.type.caption, color: c.text.tertiary, width: 52, flexShrink: 0 }}>
        {label}
      </Box>
      <Box
        sx={{
          ...c.type.callout,
          color: c.text.secondary,
          fontFamily: mono ? c.font.mono : c.font.sans,
          minWidth: 0,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </Box>
    </Box>
  );
};

export default CommitSheet;
