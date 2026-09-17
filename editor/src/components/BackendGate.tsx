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

import { API_URL } from '@/lib/api';

/**
 * Routes that render without the API. Gating these would mean shimmering for a
 * minute in front of a static legal page that never needed the backend at all.
 */
const NO_GATE = [
  '/legal', '/support', '/help', '/offline', '/maintenance', '/session-expired', '/403',
];

/** Per-attempt ceiling. A sleeping service accepts the socket and then just
 *  sits there, so without this the first fetch can hang past the cold start. */
const ATTEMPT_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1500;
/** Below this, say nothing — a warm backend answers in well under a second and
 *  a flashed "waking up" message would be noise. */
const EXPLAIN_AFTER_MS = 2500;
/** Past a plausible cold start, stop blaming the cold start. A wrong
 *  NEXT_PUBLIC_API_URL or a missing CORS origin also lands here — fetch just
 *  rejects — and looks identical to a slow boot unless we say so. */
const SUSPECT_AFTER_MS = 75000;

export default function BackendGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const skip = NO_GATE.some((p) => pathname.startsWith(p));

  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (skip) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const started = Date.now();

    const ticker = setInterval(() => {
      if (!cancelled) setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 500);

    async function poll() {
      while (!cancelled) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
        try {
          const res = await fetch(`${API_URL}/health`, {
            signal: controller.signal,
            cache: 'no-store',
          });
          if (res.ok) {
            if (!cancelled) setReady(true);
            return;
          }
        } catch {
          // Cold start, DNS not warm, or our own abort. All mean "not yet".
        } finally {
          clearTimeout(timeout);
        }
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    void poll();
    return () => {
      cancelled = true;
      clearInterval(ticker);
    };
  }, [skip]);

  if (ready) return <>{children}</>;

  const explain = elapsed * 1000 >= EXPLAIN_AFTER_MS;
  const suspect = elapsed * 1000 >= SUSPECT_AFTER_MS;
  const onLoginRoute = ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password']
    .some((p) => pathname.startsWith(p));

  return (
    <div aria-busy="true">
      {onLoginRoute ? <AuthSkeleton /> : <ShellSkeleton />}
      {/* One polite announcement, and only once it's worth explaining. */}
      <p role="status" aria-live="polite" className="gate-note">
        {suspect ? (
          <>
            Still no answer from <code>{API_URL}</code> after {elapsed}s — check that the
            API is deployed, and that this origin is in its CORS_ORIGINS.
          </>
        ) : explain ? (
          <>Waking up the server — free-tier instances sleep when idle. {elapsed}s</>
        ) : (
          ''
        )}
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
