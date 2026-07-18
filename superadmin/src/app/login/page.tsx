'use client';

/** Platform-operator login (spec 013) — separate from tenant login: the
 * credentials go to the same /auth/login, but access is granted only when
 * /platform/me confirms is_platform_admin. */
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { platformLogin } from '@/lib/api';

export default function SuperadminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await platformLogin(email, password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="row" style={{ marginBottom: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/branding/logo-icon.svg" alt="Ondros logo" width={32} height={32} style={{ borderRadius: 8 }} />
          <div>
            <h1 style={{ fontSize: 16, margin: 0 }}>Platform admin</h1>
            <p className="muted small" style={{ margin: 0 }}>Operators only — tenant logins are rejected</p>
          </div>
        </div>
        <label className="field-label">Email</label>
        <input className="input" type="email" value={email} required autoFocus
               onChange={(e) => setEmail(e.target.value)} />
        <label className="field-label">Password</label>
        <input className="input" type="password" value={password} required
               onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
        <button className="btn" disabled={busy}
                style={{ width: '100%', marginTop: 18, justifyContent: 'center' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
