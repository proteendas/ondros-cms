'use client';

import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';

import { api, setTokens, TokenPair } from '@/lib/api';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}

function ResetInner() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const pair = await api<TokenPair>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: params.get('token'), password }),
      });
      setTokens(pair.access_token, pair.refresh_token);
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1 style={{ fontSize: 18, marginTop: 0 }}>Choose a new password</h1>
        <label className="field-label">New password (min 8 characters)</label>
        <input className="input" type="password" value={password} required minLength={8} autoFocus
               onChange={(e) => setPassword(e.target.value)} />
        <label className="field-label">Confirm password</label>
        <input className="input" type="password" value={confirm} required
               onChange={(e) => setConfirm(e.target.value)} />
        {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
        <button className="btn" disabled={busy} style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}>
          {busy ? 'Saving…' : 'Set password & sign in'}
        </button>
      </form>
    </div>
  );
}
