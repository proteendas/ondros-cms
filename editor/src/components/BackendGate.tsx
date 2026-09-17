'use client';

/**
 * Holds the app behind a shimmer until the API answers /health.
 *
 * Render's free tier spins a service down after ~15 minutes idle, and the next
 * request pays a cold start of roughly 30–60s. Without this gate that shows up
 * as a fully-rendered but lifeless UI: empty space pickers, "Loading…" that
 * never resolves, and a login form that appears to hang when submitted. A
 * skeleton shaped like the page that's coming is the honest version — and it
 * tells the user *why* they're waiting.
 *
 * Deliberately outside WorkspaceProvider in the layout: /auth/me and /spaces
 * shouldn't be fired into a socket that isn't listening yet, and they aren't,
 * because the provider doesn't mount until this component lets it through.
 */
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import Icon from '@/components/ui/Icon';
import { API_URL } from '@/lib/api';

/**
 * Routes that render without the API. Gating these would mean shimmering for a
 * minute in front of a static legal page that never needed the backend at all.
 */
const NO_GATE = [
  '/legal', '/support', '/help', '/offline', '/maintenance', '/session-expired', '/403',
];

/**
 * How long the probe gets before we show anything at all. A warm API answers
 * /health in tens of milliseconds, well inside this, so the skeleton is never
 * rendered and the app boots straight into its normal flow. Only a backend
 * that is actually asleep misses this window and gets the shimmer.
 */
const GRACE_MS = 600;

/** Per-attempt ceiling. A sleeping service accepts the socket and then just
 *  sits there, so without this the first fetch can hang past the cold start. */
const ATTEMPT_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1500;
/** Below this, say nothing — a warm backend answers in well under a second and
 *  a flashed "waking up" message would be noise. */
const EXPLAIN_AFTER_MS = 2500;

/**
 * A request that is *blocked* — CORS, an extension, an unresolvable host,
 * mixed content — rejects within a few milliseconds. A sleeping service
 * instead holds the connection open until our own abort fires. So a rejection
 * this fast is evidence of a misconfiguration, not a cold start, and retrying
 * it forever only hides the real problem.
 */
const FAST_FAILURE_MS = 1500;
const FAST_FAILURE_LIMIT = 3;

/** Statuses that really mean "still coming up" — Render's router serves these
 *  while it boots the container. Any other status is a readable answer from
 *  *something*, just not from this API, and retrying will not change it. */
const BOOTING_STATUSES = [502, 503, 504];

/** Hard ceiling. Past this even a free-tier cold start has failed, so say so
 *  instead of shimmering indefinitely. */
const GIVE_UP_AFTER_MS = 90000;

/**
 * probing — waiting on the first answer, showing nothing yet
 * waking  — the probe missed the grace window, so the API really is cold
 * failed  — we reached a verdict: this will not come good on its own
 * ready   — /health answered; children own the screen from here
 */
type Phase = 'probing' | 'waking' | 'failed' | 'ready';

export default function BackendGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const skip = NO_GATE.some((p) => pathname.startsWith(p));

  const [phase, setPhase] = useState<Phase>('probing');
  const [elapsed, setElapsed] = useState(0);
  const [diagnosis, setDiagnosis] = useState('');
  // Bumped by the Try again button to re-run the probe from scratch.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (skip) {
      setPhase('ready');
      return;
    }
    let cancelled = false;
    let fastFailures = 0;
    const started = Date.now();
    const origin = window.location.origin;

    // Promote to the skeleton only if the probe is still outstanding. Losing
    // this race is the whole point: a live API resolves first and nobody ever
    // sees a placeholder.
    const grace = setTimeout(() => {
      if (!cancelled) setPhase((p) => (p === 'probing' ? 'waking' : p));
    }, GRACE_MS);

    const ticker = setInterval(() => {
      if (!cancelled) setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 500);

    function giveUp(message: string) {
      if (cancelled) return;
      setDiagnosis(message);
      setPhase('failed');
    }

    async function poll() {
      while (!cancelled) {
        const attemptStarted = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
        try {
          const res = await fetch(`${API_URL}/health`, {
            signal: controller.signal,
            cache: 'no-store',
          });
          if (res.ok) {
            if (!cancelled) setPhase('ready');
            return;
          }
          if (!BOOTING_STATUSES.includes(res.status)) {
            giveUp(
              `${API_URL}/health answered ${res.status}. That is a reply from ` +
                `something other than this API — check NEXT_PUBLIC_API_URL. An ` +
                `invisible character in it makes the browser treat the value as a ` +
                `relative path and request ${origin} instead.`,
            );
            return;
          }
          fastFailures = 0; // a 503 is a genuine "booting" signal
        } catch {
          if (Date.now() - attemptStarted < FAST_FAILURE_MS) fastFailures += 1;
          else fastFailures = 0; // timed out, which is consistent with a cold start
          if (fastFailures >= FAST_FAILURE_LIMIT) {
            giveUp(
              `The browser refused to send the request to ${API_URL}. It failed ` +
                `instantly rather than timing out, so the API being asleep is not ` +
                `the cause. Open DevTools › Network › health for the reason — the ` +
                `usual ones are an ad-blocking or privacy extension ` +
                `(ERR_BLOCKED_BY_CLIENT), ${origin} missing from the API's ` +
                `CORS_ORIGINS, or a wrong NEXT_PUBLIC_API_URL.`,
            );
            return;
          }
        } finally {
          clearTimeout(timeout);
        }
        if (cancelled) return;
        if (Date.now() - started > GIVE_UP_AFTER_MS) {
          giveUp(
            `No answer from ${API_URL} after ${Math.round(
              (Date.now() - started) / 1000,
            )}s. That is well past a free-tier cold start, so check the service is ` +
              `deployed and look at DevTools › Network › health for the failure.`,
          );
          return;
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(grace);
      clearInterval(ticker);
    };
  }, [skip, attempt]);

  function retry() {
    setDiagnosis('');
    setElapsed(0);
    setPhase('probing');
    setAttempt((n) => n + 1);
  }

  if (phase === 'ready') return <>{children}</>;
  // Nothing during the probe. Under GRACE_MS this is imperceptible, and it
  // beats a skeleton that appears for one frame and vanishes.
  if (phase === 'probing') return null;

  if (phase === 'failed') {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1 style={{ fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="warning" size={16} /> Can&apos;t reach the API
          </h1>
          <p className="muted small" style={{ marginBottom: 16 }}>{diagnosis}</p>
          <button
            className="btn secondary small"
            onClick={retry}
            style={{ justifyContent: 'center' }}
          >
            <Icon name="reload" size={13} /> Try again
          </button>
        </div>
      </div>
    );
  }

  const explain = elapsed * 1000 >= EXPLAIN_AFTER_MS;
  const onLoginRoute = ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password']
    .some((p) => pathname.startsWith(p));

  return (
    <div aria-busy="true">
      {onLoginRoute ? <AuthSkeleton /> : <ShellSkeleton />}
      {/* One polite announcement, and only once it's worth explaining. */}
      <p role="status" aria-live="polite" className="gate-note">
        {explain ? (          <>Waking up the server — free-tier instances sleep when idle. {elapsed}s</>) : ''}
      </p>
    </div>
  );
}

function Bar({ w, h = 12, r }: { w: string | number; h?: number; r?: number }) {
  return (
    <div
      className="skeleton"
      style={{ width: w, height: h, ...(r === undefined ? {} : { borderRadius: r }) }}
    />
  );
}

/** Shaped like .login-card so the real form doesn't jump when it arrives. */
function AuthSkeleton() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="row" style={{ marginBottom: 18, gap: 10 }}>
          <Bar w={34} h={34} r={9} />
          <div style={{ flex: 1 }}>
            <Bar w="45%" h={14} />
            <div style={{ height: 6 }} />
            <Bar w="65%" h={10} />
          </div>
        </div>
        <Bar w="28%" h={10} />
        <div style={{ height: 8 }} />
        <Bar w="100%" h={38} />
        <div style={{ height: 14 }} />
        <Bar w="28%" h={10} />
        <div style={{ height: 8 }} />
        <Bar w="100%" h={38} />
        <div style={{ height: 18 }} />
        <Bar w="100%" h={40} />
      </div>
    </div>
  );
}

/** Topbar + sidebar + content, matching .shell's grid. */
function ShellSkeleton() {
  return (
    <div className="shell">
      <header className="topbar">
        <Bar w={26} h={26} r={7} />
        <Bar w={110} h={13} />
        <span className="spacer" />
        <Bar w={92} h={26} r={7} />
        <Bar w={26} h={26} r={7} />
      </header>
      <div className="body-wrap">
        <nav className="sidebar" aria-hidden>
          {[...Array(4)].map((_, group) => (
            <div key={group} style={{ marginBottom: 18 }}>
              <div style={{ padding: '0 14px 8px' }}>
                <Bar w="42%" h={9} />
              </div>
              {[...Array(3)].map((__, item) => (
                <div key={item} style={{ padding: '7px 14px' }}>
                  <Bar w={`${58 + ((group * 3 + item) % 4) * 9}%`} h={11} />
                </div>
              ))}
            </div>
          ))}
        </nav>
        <main className="content">
          <Bar w="34%" h={22} />
          <div style={{ height: 18 }} />
          <div className="gate-grid">
            {[...Array(6)].map((_, i) => (
              <Bar key={i} w="100%" h={112} r={10} />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
