import React, { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { pushButton, statusChip, slimScroll } from '@/shared/styles/ui';
import {
  marketplaceAuditFixUrl,
  marketplaceAuditUrl,
} from '@/shared/state/API_ENDPOINTS';

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  rule: string;
  title: string;
  file: string;
  line: number;
  severity: Severity;
  match: string;
  advice: string;
  why?: string;
  snippet: string;
}

export interface AuditResult {
  findings: Finding[];
  counts: Record<Severity, number>;
  files_scanned: number;
  files_tracked: number;
  truncated: boolean;
  clean: boolean;
  /** How many findings are severe enough to hold back Submit. */
  blocking: number;
}

interface FixRound {
  round: number;
  files_changed: string[];
  before: number;
  after: number;
}

interface Props {
  workspaceId: string;
  result: AuditResult | null;
  onResult: (result: AuditResult | null) => void;
  /** Fixes land in the working tree, so the graph behind the popover is stale. */
  onFilesChanged: () => void;
}

const TONE: Record<Severity, 'error' | 'warning' | 'neutral'> = {
  high: 'error',
  medium: 'warning',
  low: 'neutral',
};

const LABEL: Record<Severity, string> = {
  high: 'Will leak',
  medium: 'Worth a look',
  low: 'Minor',
};

/**
 * Scans what publishing would expose, and offers to fix it.
 *
 * Only tracked files are read, because only tracked files get published;
 * flagging a gitignored .env would teach the user to click past findings
 * that turn out not to matter, which is exactly the habit that gets a
 * real key shipped.
 */
const AuditSection: React.FC<Props> = ({
  workspaceId,
  result,
  onResult,
  onFilesChanged,
}) => {
  const c = useClaudeTokens();
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [rounds, setRounds] = useState<FixRound[] | null>(null);

  const run = async () => {
    setScanning(true);
    setError(null);
    setRounds(null);
    try {
      const res = await fetch(marketplaceAuditUrl(workspaceId), { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `scan ${res.status}`);
      onResult(data as AuditResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The scan didn't run.");
    } finally {
      setScanning(false);
    }
  };

  const fix = async () => {
    setFixing(true);
    setError(null);
    try {
      const res = await fetch(marketplaceAuditFixUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_rounds: 3 }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `fix ${res.status}`);
      setRounds(data.rounds as FixRound[]);
      onResult(data.scan as AuditResult);
      // Edits are uncommitted, so the graph needs to redraw to show them.
      if ((data.rounds as FixRound[]).some(r => r.files_changed.length)) {
        onFilesChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The fix didn't run.");
    } finally {
      setFixing(false);
    }
  };

  const busy = scanning || fixing;

  return (
    <Box sx={{ mt: 1.5 }}>
      {!result && !scanning && (
        <>
          <Box sx={{ ...c.type.caption, color: c.text.tertiary, mb: 1 }}>
            Publishing makes every tracked file public. Check it first.
          </Box>
          <ButtonBase
            onClick={() => void run()}
            sx={{ ...pushButton(c), width: '100%' }}
          >
            <ShieldRoundedIcon sx={{ fontSize: 13 }} />
            Scan for leaks
          </ButtonBase>
        </>
      )}

      {scanning && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            py: 1.5,
            ...c.type.caption,
            color: c.text.tertiary,
          }}
        >
          <CircularProgress size={12} sx={{ color: c.text.tertiary }} />
          Reading every file git would publish
        </Box>
      )}

      {result && !scanning && (
        <>
          {result.clean ? (
            <Box sx={{ ...statusChip(c, 'success') }}>
              <CheckCircleRoundedIcon sx={{ fontSize: 12 }} />
              Nothing exposed in {result.files_scanned} files
            </Box>
          ) : (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {(['high', 'medium', 'low'] as Severity[])
                .filter(s => result.counts[s] > 0)
                .map(s => (
                  <Box key={s} sx={{ ...statusChip(c, TONE[s]) }}>
                    {s === 'high' ? (
                      <ErrorOutlineRoundedIcon sx={{ fontSize: 12 }} />
                    ) : (
                      <WarningAmberRoundedIcon sx={{ fontSize: 12 }} />
                    )}
                    {result.counts[s]} {LABEL[s].toLowerCase()}
                  </Box>
                ))}
            </Box>
          )}

          {!result.clean && (
            <Box
              sx={{
                mt: 1.25,
                maxHeight: 190,
                overflowY: 'auto',
                ...slimScroll(c),
              }}
            >
              {result.findings.map(f => {
                const expanded = open === f.id;
                return (
                  <Box
                    key={f.id}
                    sx={{
                      borderTop: `1px solid ${c.border.subtle}`,
                      '&:last-of-type': { borderBottom: `1px solid ${c.border.subtle}` },
                    }}
                  >
                    <ButtonBase
                      onClick={() => setOpen(expanded ? null : f.id)}
                      sx={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 0.75,
                        px: 0.5,
                        py: 0.75,
                        textAlign: 'left',
                        borderRadius: `${c.radius.sm}px`,
                        '&:hover': { background: c.bg.secondary },
                      }}
                    >
                      <Box
                        sx={{
                          width: 6,
                          height: 6,
                          mt: '5px',
                          borderRadius: '50%',
                          flexShrink: 0,
                          background:
                            f.severity === 'high'
                              ? c.status.error
                              : f.severity === 'medium'
                                ? c.status.warning
                                : c.text.tertiary,
                        }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box
                          sx={{
                            ...c.type.footnote,
                            color: c.text.primary,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {f.title}
                        </Box>
                        <Box
                          sx={{
                            ...c.type.caption,
                            color: c.text.tertiary,
                            fontFamily: c.font.mono,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {f.file}:{f.line}
                        </Box>
                      </Box>
                      <ExpandMoreRoundedIcon
                        sx={{
                          fontSize: 14,
                          color: c.text.tertiary,
                          flexShrink: 0,
                          transform: expanded ? 'rotate(180deg)' : 'none',
                          transition: c.transition,
                        }}
                      />
                    </ButtonBase>

                    <Collapse in={expanded} unmountOnExit>
                      <Box sx={{ px: 0.5, pb: 1 }}>
                        <Box
                          sx={{
                            ...c.type.caption,
                            fontFamily: c.font.mono,
                            color: c.text.secondary,
                            background: c.bg.secondary,
                            border: `1px solid ${c.border.subtle}`,
                            borderRadius: `${c.radius.sm}px`,
                            p: 0.75,
                            mb: 0.75,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                          }}
                        >
                          {f.match}
                        </Box>
                        <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>
                          {f.why || f.advice}
                        </Box>
                      </Box>
                    </Collapse>
                  </Box>
                );
              })}
            </Box>
          )}

          {rounds && rounds.length > 0 && (
            <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: 1 }}>
              {rounds.length === 1 ? '1 round' : `${rounds.length} rounds`},{' '}
              {rounds[rounds.length - 1].after === 0
                ? 'all clear. Review the diff before you submit.'
                : `${rounds[rounds.length - 1].after} left. The rest need you.`}
            </Box>
          )}

          <Box sx={{ display: 'flex', gap: 1, mt: 1.25 }}>
            <ButtonBase
              onClick={() => void run()}
              disabled={busy}
              sx={{ ...pushButton(c), flex: 1 }}
            >
              <ShieldRoundedIcon sx={{ fontSize: 13 }} />
              Rescan
            </ButtonBase>
            {!result.clean && (
              <ButtonBase
                onClick={() => void fix()}
                disabled={busy}
                sx={{ ...pushButton(c), flex: 1.4 }}
              >
                {fixing ? (
                  <CircularProgress size={12} sx={{ color: c.text.secondary }} />
                ) : (
                  <AutoFixHighRoundedIcon sx={{ fontSize: 13 }} />
                )}
                {fixing ? 'Fixing' : 'Fix these for me'}
              </ButtonBase>
            )}
          </Box>

          {fixing && (
            <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: 0.75 }}>
              Editing files, then rescanning. Up to three rounds. Nothing is
              committed.
            </Box>
          )}
        </>
      )}

      {error && (
        <Box sx={{ ...c.type.caption, color: c.status.error, mt: 1 }}>{error}</Box>
      )}
    </Box>
  );
};

export default AuditSection;
