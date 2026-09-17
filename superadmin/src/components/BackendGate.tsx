'use client';

/**
 * Shows a shimmer while the API cold-starts — and gets out of the way otherwise.
 *
 * Same backend as the editor, so the same Render free-tier cold start applies:
 * without this, Shell's /platform/me call hangs and its "Checking access…"
 * line sits there for a minute — or the fetch fails and the operator is bounced
 * to /login as if their session had expired.
 *
 * Two rules keep it from becoming a liability:
 *
 *   1. It never shows anything unless the probe misses GRACE_MS. A warm API
 *      wins that race, so the normal flow is completely unaffected.
 *   2. It FAILS OPEN. The probe is a convenience, not an authorization check.
 *      If it can't get a verdict — blocked by a browser extension, a CORS
 *      mismatch, a wrong NEXT_PUBLIC_API_URL — the gate opens anyway and lets
 *      the app's own requests report real errors in context. Blocking the
 *      whole UI behind a probe that itself is broken only turns a warning into
 *      an outage.
 *
 * Every route here needs the API (there are no static pages), so unlike the
 * editor's gate there is nothing to exempt.
 */
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { API_URL } from '@/lib/api';

/**
 * How long the probe gets before we show anything at all. A warm API answers
 * /health in tens of milliseconds, well inside this, so the skeleton is never
 * rendered and the app boots straight into its normal flow. Only a backend
 * that is actually asleep misses this window and gets the shimmer.
 */
const GRACE_MS = 600;

/** Twin of /health (which render.yaml needs and ad blockers match on). */
const PROBE_PATH = '/readyz';

/** Per-attempt ceiling. A sleeping service accepts the socket and then just
 *  sits there, so without this the first fetch can hang past the cold start. */
const ATTEMPT_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1500;

/** Below this, say nothing — a warm backend answers in well under a second and
 *  a flashed "waking up" message would be noise. */
const EXPLAIN_AFTER_MS = 2500;

/**
 * A *blocked* request — an extension, CORS, mixed content, a bad host —
 * rejects within a few milliseconds. A sleeping service instead holds the
 * connection until our own abort fires. So a rejection this fast means the
 * probe itself is broken, not that the API is cold: stop probing and open.
 */
const FAST_FAILURE_MS = 1500;
const FAST_FAILURE_LIMIT = 3;

/** Statuses that really mean "still coming up" — Render's router serves these
 *  while it boots the container. Anything else is a readable answer from
 *  something that isn't this API, and retrying won't change it. */
const BOOTING_STATUSES = [502, 503, 504];

/** Hard ceiling: past this, even a free-tier cold start has failed. */
const GIVE_UP_AFTER_MS = 90000;

/**
 * probing — waiting on the first answer, showing nothing yet
 * waking  — the probe missed the grace window, so the API really is cold
 * ready   — open; children own the screen from here
 */
type Phase = 'probing' | 'waking' | 'ready';

export default function BackendGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [phase, setPhase] = useState<Phase>('probing');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let fastFailures = 0;
    const started = Date.now();

    // Promote to the skeleton only if the probe is still outstanding. Losing
    // this race is the whole point: a live API resolves first and nobody ever
    // sees a placeholder.
    const grace = setTimeout(() => {
      if (!cancelled) setPhase((p) => (p === 'probing' ? 'waking' : p));
    }, GRACE_MS);

    const ticker = setInterval(() => {
      if (!cancelled) setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 500);

    /** Let the app through. `reason` is set when we never got a clean 200. */
    function openGate(reason?: string) {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      if (reason) console.warn(`[BackendGate] ${reason}`);
      setPhase('ready');
    }

    async function poll() {
      while (!cancelled) {
        const attemptStarted = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
        try {
          // /readyz, not /health: ad-blocker filter lists match on the latter
          // and answer with ERR_BLOCKED_BY_CLIENT, which looks exactly like a
          // sleeping service. A bare GET with no custom headers and no `cache`
          // option keeps it a "simple" CORS request — no preflight to satisfy —
          // and the query param busts the HTTP cache in place of 'no-store'.
          const res = await fetch(`${API_URL}${PROBE_PATH}?probe=${Date.now()}`, {
            signal: controller.signal,
          });
          if (res.ok) {
            openGate();
            return;
          }
          if (!BOOTING_STATUSES.includes(res.status)) {
            openGate(
              `${API_URL}${PROBE_PATH} answered ${res.status}, which is not this API. ` +
                `Check NEXT_PUBLIC_API_URL. Continuing without the cold-start gate.`,
            );
            return;
          }
          fastFailures = 0; // a 503 is a genuine "booting" signal
        } catch {
          if (Date.now() - attemptStarted < FAST_FAILURE_MS) fastFailures += 1;
          else fastFailures = 0; // timed out, consistent with a cold start
          if (fastFailures >= FAST_FAILURE_LIMIT) {
            openGate(
              `Could not probe ${API_URL}${PROBE_PATH} from ${window.location.origin} — ` +
                `it failed instantly rather than timing out, so something is ` +
                `blocking it (a browser extension, CORS, or a wrong ` +
                `NEXT_PUBLIC_API_URL) rather than the API being asleep. ` +
                `Continuing without the cold-start gate.`,
            );
            return;
          }
        } finally {
          clearTimeout(timeout);
        }
        if (cancelled) return;
        if (Date.now() - started > GIVE_UP_AFTER_MS) {
          openGate(
            `No answer from ${API_URL}${PROBE_PATH} after ` +
              `${Math.round((Date.now() - started) / 1000)}s. Continuing anyway.`,
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
  }, []);

  if (phase === 'ready') return <>{children}</>;
  // Nothing during the probe. Under GRACE_MS this is imperceptible, and it
  // beats a skeleton that appears for one frame and vanishes.
  if (phase === 'probing') return null;

  const explain = elapsed * 1000 >= EXPLAIN_AFTER_MS;
  return (
    <div aria-busy="true">
      {pathname.startsWith('/login') ? <LoginSkeleton /> : <ShellSkeleton />}
      {/* One polite announcement, and only once it's worth explaining. */}
      <p role="status" aria-live="polite" className="gate-note">
        {explain ? <>Waking up the API — free-tier instances sleep when idle. {elapsed}s</> : ''}
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
function LoginSkeleton() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="row" style={{ marginBottom: 16, gap: 10 }}>
          <Bar w={32} h={32} r={8} />
          <div style={{ flex: 1 }}>
            <Bar w="40%" h={13} />
            <div style={{ height: 6 }} />
            <Bar w="70%" h={10} />
          </div>
        </div>
        <Bar w="24%" h={10} />
        <div style={{ height: 8 }} />
        <Bar w="100%" h={38} />
        <div style={{ height: 14 }} />
        <Bar w="24%" h={10} />
        <div style={{ height: 8 }} />
        <Bar w="100%" h={38} />
        <div style={{ height: 18 }} />
        <Bar w="100%" h={40} />
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="shell">
      <aside className="sidebar" aria-hidden>
        <div className="row" style={{ gap: 10, padding: '0 4px 20px' }}>
          <Bar w={26} h={26} r={7} />
          <Bar w="58%" h={13} />
        </div>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{ padding: '8px 4px' }}>
            <Bar w={`${62 + (i % 4) * 9}%`} h={11} />
          </div>
        ))}
      </aside>
      <main className="main">
        <Bar w="30%" h={22} />
        <div style={{ height: 20 }} />
        <div className="gate-grid">
          {[...Array(6)].map((_, i) => (
            <Bar key={i} w="100%" h={96} r={10} />
          ))}
        </div>
        <div style={{ height: 22 }} />
        <Bar w="100%" h={210} r={10} />
      </main>
    </div>
  );
}
