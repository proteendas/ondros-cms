'use client';

/** Invitation acceptance: shows who invited you, creates/links your user. */
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import { api, setTokens, TokenPair } from '@/lib/api';

interface InviteInfo {
  account_name: string;
  email: string;
  role_name: string | null;
  existing_user: boolean;
  status: string;
}

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<InviteInfo>(`/invitations/${token}`)
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : 'Invitation not found'));
  }, [token]);

  async function accept(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const pair = await api<TokenPair>(`/invitations/${token}/accept`, {
        method: 'POST',
        body: JSON.stringify(
          info?.existing_user ? {} : { password, full_name: fullName },
        ),
      });
      setTokens(pair.access_token, pair.refresh_token);
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invitation');
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={accept}>
        {!info ? (
          <>
            <h1 style={{ fontSize: 18, marginTop: 0 }}>Invitation</h1>
            {error ? <p className="error-text">{error}</p> : <p className="muted">Loading…</p>}
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 18, marginTop: 0 }}>Join {info.account_name}</h1>
            <p className="muted">
              <strong>{info.email}</strong> was invited
              {info.role_name ? <> as <strong>{info.role_name}</strong></> : null}.
            </p>
            {!info.existing_user && (
              <>
                <label className="field-label">Your name</label>
                <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                <label className="field-label">Choose a password (min 8 characters)</label>
                <input className="input" type="password" value={password} required minLength={8}
                       onChange={(e) => setPassword(e.target.value)} />
              </>
            )}
            {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
            <button className="btn" disabled={busy} style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}>
              {busy ? 'Joining…' : `Join ${info.account_name}`}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
