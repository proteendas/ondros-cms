'use client';

/** Email verification landing: consumes the token and signs the user in. */
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { api, setTokens, TokenPair } from '@/lib/api';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<'working' | 'error'>('working');
  const [error, setError] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get('token');
    if (!token) {
      setState('error');
      setError('Missing verification token.');
      return;
    }
    api<TokenPair>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
      .then((pair) => {
        setTokens(pair.access_token, pair.refresh_token);
        window.location.href = '/onboarding';
      })
      .catch((e) => {
        setState('error');
        setError(e instanceof Error ? e.message : 'Verification failed');
      });
  }, [params, router]);

  return (
    <div className="login-wrap">
      <div className="login-card">
        {state === 'working' ? (
          <>
            <h1 style={{ fontSize: 18 }}>Verifying…</h1>
            <p className="muted">Confirming your email address.</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 18 }}>Verification failed</h1>
            <p className="error-text">{error}</p>
            <p className="muted small">
              The link may have expired — <a href="/login">sign in</a> to request a new one.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
