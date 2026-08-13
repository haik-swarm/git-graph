import React, { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { pushButton } from '@/shared/styles/ui';
import { HEALTH_CHECK_URL } from '@/shared/state/API_ENDPOINTS';

type HealthStatus = 'idle' | 'loading' | 'ok' | 'error';

const Health: React.FC = () => {
  const c = useClaudeTokens();
  const [status, setStatus] = useState<HealthStatus>('idle');
  const [message, setMessage] = useState('');
  const [latency, setLatency] = useState<number | null>(null);

  const ping = useCallback(async () => {
    setStatus('loading');
    const start = performance.now();
    try {
      const res = await fetch(HEALTH_CHECK_URL);
      const elapsed = Math.round(performance.now() - start);
      const text = await res.text();
      setLatency(elapsed);
      setMessage(res.ok ? text : `${res.status} — ${text}`);
      setStatus(res.ok ? 'ok' : 'error');
    } catch (err) {
      setLatency(Math.round(performance.now() - start));
      setMessage(err instanceof Error ? err.message : 'Network error');
      setStatus('error');
    }
  }, []);

  const tone =
    status === 'ok' ? c.status.success : status === 'error' ? c.status.error : c.text.tertiary;

  return (
    <Box sx={{ p: 4, maxWidth: 420 }}>
      <Typography sx={{ ...c.type.title2, color: c.text.primary, mb: 2 }}>Health</Typography>

      <ButtonBase onClick={ping} disabled={status === 'loading'} sx={pushButton(c)}>
        {status === 'loading' ? (
          <CircularProgress size={12} sx={{ color: c.text.secondary, mr: 0.5 }} />
        ) : null}
        {status === 'loading' ? 'Pinging' : 'Ping backend'}
      </ButtonBase>

      {status !== 'idle' && status !== 'loading' && (
        <Typography
          sx={{ ...c.type.callout, fontFamily: c.font.mono, color: tone, mt: 2 }}
        >
          {status === 'ok' ? 'Healthy' : 'Unreachable'} · {message}
          {latency !== null && ` · ${latency}ms`}
        </Typography>
      )}
    </Box>
  );
};

export default Health;
