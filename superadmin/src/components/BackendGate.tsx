'use client';

/**
 * Holds the admin app behind a shimmer until the API answers /health.
 *
 * Same backend as the editor, so the same Render free-tier cold start applies:
 * without this, Shell's /platform/me call hangs and its "Checking access…"
 * line sits there for a minute — or worse, the fetch fails and the operator is
 * bounced to /login as if their session had expired.
 *
 * Every route here needs the API (there are no static pages), so unlike the
 * editor's gate there's nothing to exempt.
 */
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { API_URL } from '@/lib/api';

/** A sleeping service accepts the socket then stalls, so cap each attempt. */
const ATTEMPT_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1500;
/** A warm backend answers well under this; below it, stay quiet. */
const EXPLAIN_AFTER_MS = 2500;
/** Past a plausible cold start, stop blaming the cold start. A wrong
 *  NEXT_PUBLIC_API_URL or a missing CORS origin also lands here — fetch just
 *  rejects — and looks identical to a slow boot unless we say so. */
const SUSPECT_AFTER_MS = 75000;

export default function BackendGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
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
          // Cold start or our own abort — either way, not yet.
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
  }, []);

  if (ready) return <>{children}</>;

  const explain = elapsed * 1000 >= EXPLAIN_AFTER_MS;
  const suspect = elapsed * 1000 >= SUSPECT_AFTER_MS;

  return (
    <div aria-busy="true">
      {pathname.startsWith('/login') ? <LoginSkeleton /> : <ShellSkeleton />}
      {/* One polite announcement, and only once it's worth explaining. */}
      <p role="status" aria-live="polite" className="gate-note">
        {suspect ? (
          <>
            Still no answer from <code>{API_URL}</code> after {elapsed}s — check that the
            API is deployed, and that this origin is in its CORS_ORIGINS.
          </>
        ) : explain ? (
          <>Waking up the API — free-tier instances sleep when idle. {elapsed}s</>
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
