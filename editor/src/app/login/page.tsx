'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import Icon from '@/components/ui/Icon';
import { API_URL, api, login, setTokens } from '@/lib/api';
import { BRAND } from '@/lib/brand';

interface SsoLookup {
  sso_available: boolean;
  sso_required: boolean;
  provider_name?: string;
  login_url?: string;
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState<SsoLookup | null>(null);
  const [social, setSocial] = useState<{ google: boolean; microsoft: boolean; github: boolean }>({
    google: false,
    microsoft: false,
    github: false,
  });

  // SSO callbacks land here with tokens in the URL fragment (never logged server-side).
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const access = params.get('access');
    const refresh = params.get('refresh');
    if (access && refresh) {
      setTokens(access, refresh);
      window.location.replace('/');
    }
  }, []);

  useEffect(() => {
    api<{ google: boolean; microsoft: boolean; github: boolean }>('/sso/options')
      .then(setSocial)
      .catch(() => {});
  }, []);

  async function checkDomain(value: string) {
    if (!value.includes('@')) return;
    try {
      const info = await api<SsoLookup>(`/sso/lookup?email=${encodeURIComponent(value)}`);
      setSso(info);
      if (info.sso_required && info.login_url) {
        window.location.href = `${API_URL}${info.login_url}`;
      }
    } catch {
      setSso(null);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      window.location.href = '/'; // full reload so WorkspaceProvider boots fresh
    } catch (err) {
      const detail = (err as { detail?: { code?: string; login_url?: string; message?: string } }).detail;
      if (detail?.code === 'sso_required' && detail.login_url) {
        window.location.href = `${API_URL}${detail.login_url}`;
        return;
      }
      if (detail?.code === 'email_unverified') {
        setError('Verify your email first — check your inbox (or the backend logs in dev mode).');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="row" style={{ marginBottom: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logoIcon} alt={`${BRAND.name} logo`} width={34} height={34} style={{ borderRadius: 9 }} />
          <div>
            <h1 style={{ margin: 0, fontSize: 18 }}>{BRAND.name}</h1>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Sign in to your workspace</p>
          </div>
        </div>

        {(social.google || social.microsoft || social.github) && (
          <div className="stack" style={{ marginBottom: 14 }}>
            {social.google && (
              <a className="btn secondary" style={{ width: '100%', justifyContent: 'center', gap: 9 }}
                 href={`${API_URL}/sso/google/login`}>
                <GoogleGlyph /> Continue with Google
              </a>
            )}
            {social.github && (
              <a className="btn secondary" style={{ width: '100%', justifyContent: 'center', gap: 9 }}
                 href={`${API_URL}/sso/github/login`}>
                <Icon name="github" size={16} /> Continue with GitHub
              </a>
            )}
            {social.microsoft && (
              <a className="btn secondary" style={{ width: '100%', justifyContent: 'center', gap: 9 }}
                 href={`${API_URL}/sso/microsoft/login`}>
                <Icon name="microsoft" size={15} /> Continue with Microsoft
              </a>
            )}
            <div className="row" style={{ gap: 10, margin: '8px 0 0' }} aria-hidden>
              <span style={{ flex: 1, height: 1, background: 'var(--border, #e4e7ec)' }} />
              <span className="muted small">or continue with email</span>
              <span style={{ flex: 1, height: 1, background: 'var(--border, #e4e7ec)' }} />
            </div>
          </div>
        )}

        <label className="field-label">Email</label>
        <input
          className="input" value={email} autoFocus
          onChange={(e) => setEmail(e.target.value)}
          onBlur={(e) => void checkDomain(e.target.value)}
        />
        {sso?.sso_available && !sso.sso_required && sso.login_url && (
          <p className="muted small" style={{ marginTop: 6 }}>
            Your team uses <strong>{sso.provider_name}</strong> —{' '}
            <a href={`${API_URL}${sso.login_url}`}>sign in with SSO →</a>
          </p>
        )}
        <label className="field-label">Password</label>
        <input
          className="input" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
        <button className="btn" disabled={busy} style={{ width: '100%', marginTop: 18, justifyContent: 'center' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="row" style={{ marginTop: 14 }}>
          <Link href="/forgot-password" className="muted small">Forgot password?</Link>
          <span className="spacer" />
          <Link href="/signup" className="small">Create an account</Link>
        </div>
      </form>
    </div>
  );
}

/** Google's multi-color "G" — kept inline because brand marks shouldn't be
 * recolored the way currentColor Bootstrap icons are. */
function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
