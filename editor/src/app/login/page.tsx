'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import Icon from '@/components/ui/Icon';
import LegalFooter from '@/components/ui/LegalFooter';
import PasswordInput from '@/components/ui/PasswordInput';
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
                <Icon name="google" size={16} /> Continue with Google
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
            <a href={`${API_URL}${sso.login_url}`}>
              sign in with SSO <Icon name="forward" size={12} />
            </a>
          </p>
        )}
        <label className="field-label">Password</label>
        <PasswordInput
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
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
      <LegalFooter />
    </div>
  );
}
