import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  iconButton,
  popover,
  primaryButton,
  pushButton,
  statusChip,
  sunkenField,
} from '@/shared/styles/ui';
import {
  marketplacePublishUrl,
  marketplaceTakedownUrl,
} from '@/shared/state/API_ENDPOINTS';
import AuditSection, { AuditResult } from '@/components/AuditSection';

interface IssueRef {
  number: number;
  url: string;
}

interface PublishState {
  connected: boolean;
  eligible: boolean;
  reason?: string;
  slug?: string;
  is_public?: boolean;
  listed?: boolean;
  pending?: IssueRef | null;
  takedown?: IssueRef | null;
  html_url?: string;
}

interface Props {
  workspaceId: string;
  appName: string;
  /** Bumped by the parent after a push, since eligibility depends on the remote. */
  refreshKey: number;
  /** Auto-fixing rewrites files, so the graph behind this popover goes stale. */
  onFilesChanged: () => void;
}

/**
 * Submits this app to the marketplace.
 *
 * Submitting only files a request; a reviewer approves it elsewhere, so
 * the button's job is to be honest about which of the four states the
 * app is in (listed, awaiting review, submittable, or ineligible) rather
 * than to promise the app will appear.
 */
const PublishPanel: React.FC<Props> = ({
  workspaceId,
  appName,
  refreshKey,
  onFilesChanged,
}) => {
  const c = useClaudeTokens();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<PublishState | null>(null);
  const [loading, setLoading] = useState(false);
  const [pitch, setPitch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [overridden, setOverridden] = useState(false);

  // A high-severity finding is a credential that would be public the
  // moment Submit flips the repo, so it holds the button until it's
  // fixed or the user explicitly overrides. Medium and low only warn.
  const blocked = Boolean(audit && audit.blocking > 0 && !overridden);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(marketplacePublishUrl(workspaceId));
      if (!res.ok) throw new Error(`publish ${res.status}`);
      setState(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't check this app.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (anchor) void load();
  }, [anchor, load, refreshKey]);

  useEffect(() => {
    setDone(null);
    setPitch('');
    setAsking(false);
    setReason('');
    // A scan describes one app's files; carrying it to the next app would
    // report the wrong findings, or clear a gate that was never checked.
    setAudit(null);
    setOverridden(false);
  }, [workspaceId]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(marketplacePublishUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_name: appName, pitch }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `submit ${res.status}`);
      setDone({ url: data.html_url });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't submit.");
    } finally {
      setBusy(false);
    }
  };

  const askTakedown = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(marketplaceTakedownUrl(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_name: appName, reason }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `takedown ${res.status}`);
      setAsking(false);
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title="Submit this app to the marketplace">
        <ButtonBase
          onClick={e => setAnchor(e.currentTarget)}
          sx={{ ...iconButton(c), display: 'flex' }}
          aria-label="Publish to marketplace"
        >
          <StorefrontRoundedIcon sx={{ fontSize: 16 }} />
        </ButtonBase>
      </Tooltip>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { ...popover(c), width: 320, p: 2 } } }}
      >
        <Box sx={{ ...c.type.headline, color: c.text.primary, mb: 0.5 }}>
          Publish to marketplace
        </Box>

        {loading && !state && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={16} sx={{ color: c.text.tertiary }} />
          </Box>
        )}

        {state?.listed && (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ ...statusChip(c, 'success') }}>
              <CheckCircleRoundedIcon sx={{ fontSize: 12 }} />
              Already in the marketplace
            </Box>

            {state.takedown ? (
              <>
                <Box sx={{ ...statusChip(c, 'warning'), mt: 1 }}>
                  <ScheduleRoundedIcon sx={{ fontSize: 12 }} />
                  Takedown requested
                </Box>
                <ButtonBase
                  onClick={() => window.open(state.takedown!.url, '_blank', 'noopener')}
                  sx={{ ...pushButton(c), mt: 1.5, width: '100%' }}
                >
                  <OpenInNewIcon sx={{ fontSize: 13 }} />
                  View request #{state.takedown.number}
                </ButtonBase>
              </>
            ) : asking ? (
              <>
                <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: 1.5, mb: 1.5 }}>
                  The listing is a fork the org owns, so you can't pull it yourself.
                  This asks a reviewer to take it down.
                </Box>
                <Box
                  component="textarea"
                  value={reason}
                  placeholder="Why? (optional)"
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setReason(e.target.value)
                  }
                  sx={{
                    width: '100%',
                    minHeight: 56,
                    resize: 'vertical',
                    p: 1,
                    outline: 'none',
                    fontFamily: c.font.sans,
                    ...c.type.callout,
                    color: c.text.primary,
                    ...sunkenField(c),
                    '&::placeholder': { color: c.text.tertiary },
                  }}
                />
                <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                  <ButtonBase
                    onClick={() => setAsking(false)}
                    disabled={busy}
                    sx={{ ...pushButton(c), flex: 1 }}
                  >
                    Cancel
                  </ButtonBase>
                  <ButtonBase
                    onClick={() => void askTakedown()}
                    disabled={busy}
                    sx={{
                      ...pushButton(c),
                      flex: 1,
                      color: c.status.error,
                      '&:hover': { background: c.status.errorBg },
                    }}
                  >
                    {busy ? (
                      <CircularProgress size={12} sx={{ color: c.status.error }} />
                    ) : (
                      <RemoveCircleOutlineRoundedIcon sx={{ fontSize: 13 }} />
                    )}
                    {busy ? 'Sending' : 'Send request'}
                  </ButtonBase>
                </Box>
              </>
            ) : (
              <ButtonBase
                onClick={() => setAsking(true)}
                sx={{
                  ...pushButton(c),
                  mt: 1.5,
                  width: '100%',
                  color: c.status.error,
                  '&:hover': { background: c.status.errorBg },
                }}
              >
                <RemoveCircleOutlineRoundedIcon sx={{ fontSize: 13 }} />
                Request takedown
              </ButtonBase>
            )}
          </Box>
        )}

        {state?.pending && (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ ...statusChip(c, 'warning') }}>
              <ScheduleRoundedIcon sx={{ fontSize: 12 }} />
              Awaiting review
            </Box>
            <ButtonBase
              onClick={() => window.open(state.pending!.url, '_blank', 'noopener')}
              sx={{ ...pushButton(c), mt: 1.5, width: '100%' }}
            >
              <OpenInNewIcon sx={{ fontSize: 13 }} />
              View request #{state.pending.number}
            </ButtonBase>
          </Box>
        )}

        {done && !state?.pending && (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ ...statusChip(c, 'success') }}>Submitted</Box>
            <ButtonBase
              onClick={() => window.open(done.url, '_blank', 'noopener')}
              sx={{ ...pushButton(c), mt: 1.5, width: '100%' }}
            >
              <OpenInNewIcon sx={{ fontSize: 13 }} />
              View your request
            </ButtonBase>
          </Box>
        )}

        {state && !state.eligible && !state.listed && !state.pending && (
          <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: 1 }}>
            {state.reason}
          </Box>
        )}

        {state?.eligible && !done && (
          <>
            <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: 0.5, mb: 1.5 }}>
              This makes <strong>{state.slug}</strong> public and files a request for
              review. Approval is someone else's call.
            </Box>

            <Box
              component="textarea"
              value={pitch}
              placeholder="What does this app do? (optional)"
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setPitch(e.target.value)
              }
              sx={{
                width: '100%',
                minHeight: 64,
                resize: 'vertical',
                p: 1,
                outline: 'none',
                fontFamily: c.font.sans,
                ...c.type.callout,
                color: c.text.primary,
                ...sunkenField(c),
                '&::placeholder': { color: c.text.tertiary },
              }}
            />

            <AuditSection
              workspaceId={workspaceId}
              result={audit}
              onResult={next => {
                setAudit(next);
                // A fresh scan re-arms the gate: an override was granted
                // for findings that no longer describe the current files.
                setOverridden(false);
              }}
              onFilesChanged={onFilesChanged}
            />

            <ButtonBase
              onClick={() => void submit()}
              disabled={busy || blocked}
              sx={{
                ...primaryButton(c),
                mt: 1.5,
                width: '100%',
                '&.Mui-disabled': { opacity: 0.4 },
              }}
            >
              {busy ? (
                <CircularProgress size={12} sx={{ color: '#FFFFFF' }} />
              ) : (
                <StorefrontRoundedIcon sx={{ fontSize: 14 }} />
              )}
              {busy ? 'Submitting' : 'Submit for review'}
            </ButtonBase>

            {blocked && (
              <>
                <Box sx={{ ...c.type.caption, color: c.text.tertiary, mt: 1 }}>
                  {audit!.blocking === 1
                    ? 'One finding would be public the moment this repo flips.'
                    : `${audit!.blocking} findings would be public the moment this repo flips.`}
                </Box>
                <ButtonBase
                  onClick={() => setOverridden(true)}
                  sx={{ ...pushButton(c), mt: 1, width: '100%' }}
                >
                  Submit anyway
                </ButtonBase>
              </>
            )}

            {overridden && audit && audit.blocking > 0 && (
              <Box sx={{ ...c.type.caption, color: c.status.warning, mt: 1 }}>
                Gate overridden. Submitting publishes these as they are.
              </Box>
            )}
          </>
        )}

        {error && (
          <Box sx={{ ...c.type.caption, color: c.status.error, mt: 1.5 }}>{error}</Box>
        )}
      </Popover>
    </>
  );
};

export default PublishPanel;
