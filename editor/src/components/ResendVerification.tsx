'use client';

/**
 * "Didn't get the email?" control with a visible countdown.
 *
 * The backend applies an escalating cooldown per user (60s, 3m, 5m, 10m, 15m,
 * then 30m) and reports the wait in `retry_after`. This component only
 * *displays* that: the server re-checks on every call, so a reload, a second
 * tab or a hand-crafted request can't shorten it.
 *
 * The deadline is stored as a timestamp rather than a decrementing counter, so
 * a throttled background tab shows the right number as soon as it's focused
 * again instead of lagging by however long it was asleep.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import Icon from '@/components/ui/Icon';
import { ApiError, api } from '@/lib/api';

interface ResendResponse {
  message: string;
  retry_after: number;
  dev_verification_token: string | null;
}

interface ThrottleDetail {
  code?: string;
  retry_after?: number;
  message?: string;
}

/** Survives a reload so the button doesn't look ready a second before it is. */
const storageKey = (email: string) => `cms_resend_until:${email.toLowerCase()}`;

function readDeadline(email: string): number {
  try {
    const raw = window.localStorage.getItem(storageKey(email));
    const at = raw ? Number(raw) : 0;
    return Number.isFinite(at) && at > Date.now() ? at : 0;
  } catch {
    return 0; // private mode / blocked storage — the server still enforces it
  }
}

function writeDeadline(email: string, at: number): void {
  try {
    window.localStorage.setItem(storageKey(email), String(at));
  } catch {
    /* non-fatal: the countdown just won't survive a reload */
  }
}

function countdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  return `${mins}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function ResendVerification({
  email,
  /** Seconds already on the clock — e.g. 60 right after signup sent the first. */
  initialCooldown = 0,
}: {
  email: string;
  initialCooldown?: number;
}) {
  const [deadline, setDeadline] = useState(0);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);

  const arm = useCallback(
    (seconds: number) => {
      const at = Date.now() + seconds * 1000;
      setDeadline(at);
      writeDeadline(email, at);
    },
    [email],
  );

  // localStorage is only readable on the client, so the initial deadline is
  // resolved in an effect rather than in useState — otherwise SSR and the
  // first client render disagree and React discards the markup.
  useEffect(() => {
    const stored = readDeadline(email);
    if (stored) setDeadline(stored);
    else if (initialCooldown > 0) arm(initialCooldown);
  }, [email, initialCooldown, arm]);

  useEffect(() => {
    if (!deadline) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    // Twice a second: the displayed value is never more than ~500ms stale.
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadline]);

  async function send() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await api<ResendResponse>('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setNote(res.message);
      setDevToken(res.dev_verification_token);
      arm(res.retry_after);
    } catch (err) {
      const detail = err instanceof ApiError ? (err.detail as ThrottleDetail) : undefined;
      if (detail?.code === 'resend_throttled' && detail.retry_after) {
        // Our clock was behind the server's — adopt the server's number.
        arm(detail.retry_after);
        setError('A link was sent recently. The timer below is the real wait.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not send the email.');
      }
    } finally {
      setBusy(false);
    }
  }

  const waiting = left > 0;

  return (
    <div className="stack" style={{ gap: 8, marginTop: 14 }}>
      <button
        type="button"
        className="btn secondary small"
        style={{ justifyContent: 'center' }}
        disabled={busy || waiting}
        onClick={() => void send()}
      >
        <Icon name={waiting ? 'history' : 'email'} size={13} />
        {busy ? 'Sending…' : waiting ? `Resend in ${countdown(left)}` : 'Resend verification email'}
      </button>

      {/* aria-live so the outcome reaches a screen reader; the countdown itself
          is deliberately not announced — once a second would be unbearable. */}
      <p role="status" aria-live="polite" className="muted small" style={{ margin: 0 }}>
        {error ? <span className="error-text">{error}</span> : note}
      </p>

      {devToken && (
        <p className="muted small" style={{ margin: 0 }}>
          Dev mode:{' '}
          <Link href={`/verify-email?token=${devToken}`}>
            verify now <Icon name="forward" size={12} />
          </Link>
        </p>
      )}
    </div>
  );
}
