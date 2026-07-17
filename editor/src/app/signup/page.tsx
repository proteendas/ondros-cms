'use client';

/** Self-serve account creation (spec 001): Account + first ORG_ADMIN user. */
import Link from 'next/link';
import { FormEvent, useState } from 'react';

import { api } from '@/lib/api';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

interface SignupResponse {
  account_id: string;
  message: string;
  dev_verification_token: string | null;
}

export default function SignupPage() {
  const [accountName, setAccountName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SignupResponse | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<SignupResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          account_name: accountName,
          account_slug: slug,
          email,
          password,
          full_name: fullName,
        }),
      });
      setDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1 style={{ fontSize: 18 }}>Check your email 📬</h1>
          <p className="muted">{done.message}</p>
          {done.dev_verification_token && (
            <p className="muted small">
              Dev mode:{' '}
              <Link href={`/verify-email?token=${done.dev_verification_token}`}>
                verify now →
              </Link>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1 style={{ fontSize: 18, marginTop: 0 }}>Create your account</h1>
        <p className="muted" style={{ marginTop: 0 }}>Your company workspace on Compose CMS.</p>

        <label className="field-label">Company / account name</label>
        <input
          className="input" value={accountName} required autoFocus
          onChange={(e) => {
            setAccountName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
        <label className="field-label">Account URL slug</label>
        <input
          className="input mono" value={slug} required pattern="^[a-z0-9][a-z0-9\-]*$"
          onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
        />
        <label className="field-label">Your name</label>
        <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <label className="field-label">Work email</label>
        <input className="input" type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
        <label className="field-label">Password (min 8 characters)</label>
        <input className="input" type="password" value={password} required minLength={8}
               onChange={(e) => setPassword(e.target.value)} />

        {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
        <button className="btn" disabled={busy} style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
