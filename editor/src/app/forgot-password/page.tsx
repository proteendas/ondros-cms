'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string; dev_reset_token: string | null }>(
        '/auth/forgot-password',
        { method: 'POST', body: JSON.stringify({ email }) },
      );
      setSent(true);
      setDevToken(res.dev_reset_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1 style={{ fontSize: 18, marginTop: 0 }}>Reset your password</h1>
        {sent ? (
          <>
            <p className="muted">If that address exists, a reset link is on its way.</p>
            {devToken && (
              <p className="muted small">
                Dev mode: <Link href={`/reset-password?token=${devToken}`}>reset now →</Link>
              </p>
            )}
          </>
        ) : (
          <>
            <label className="field-label">Email</label>
            <input className="input" type="email" value={email} required autoFocus
                   onChange={(e) => setEmail(e.target.value)} />
            {error && <p className="error-text">{error}</p>}
            <button className="btn" disabled={busy} style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}
        <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
          <Link href="/login">← Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}
