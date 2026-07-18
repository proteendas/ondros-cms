'use client';

/** Cross-platform user search (spec 013): suspend/reactivate + impersonate.
 * Impersonation opens the editor with the issued token pair in the URL
 * fragment — the editor login page already consumes that handoff. */
import { useCallback, useEffect, useState } from 'react';

import Shell from '@/components/Shell';
import { api, fmtNum } from '@/lib/api';

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  email_verified: boolean;
  is_platform_admin: boolean;
  created_at: string;
  accounts: { name: string; slug: string }[];
}

interface ImpersonateResponse {
  access_token: string;
  refresh_token: string;
  editor_url: string;
  user: { email: string };
}

export default function UsersPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ total: number; items: UserRow[] }>(`/platform/users?q=${encodeURIComponent(q)}`)
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
      })
      .catch((e) => setError(String(e.message)));
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function setStatus(id: string, action: 'suspend' | 'reactivate') {
    setError(null);
    try {
      await api(`/platform/users/${id}/${action}`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  }

  async function impersonate(id: string) {
    setError(null);
    try {
      const res = await api<ImpersonateResponse>(`/platform/users/${id}/impersonate`, { method: 'POST' });
      const url = `${res.editor_url}/login#access=${encodeURIComponent(res.access_token)}&refresh=${encodeURIComponent(res.refresh_token)}`;
      window.open(url, '_blank', 'noopener');
      setNotice(`Impersonation session for ${res.user.email} opened in a new tab (audited).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impersonation failed');
    }
  }

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>{fmtNum(total)} users across all accounts.</p>
        </div>
        <span className="spacer" />
        <input className="input search" placeholder="Search email or name…" value={q}
               onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="small" style={{ color: 'var(--ok)' }}>{notice}</p>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>User</th><th>Accounts</th><th>Status</th><th>Joined</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.email}</strong>
                  <div className="muted small">
                    {u.full_name || '—'}
                    {u.is_platform_admin && <span className="badge warn" style={{ marginLeft: 6 }}>platform admin</span>}
                  </div>
                </td>
                <td className="small">
                  {u.accounts.map((a) => a.name).join(', ') || <span className="muted">none</span>}
                </td>
                <td>
                  <span className={`badge ${u.is_active ? 'ok' : 'danger'}`}>
                    {u.is_active ? 'active' : 'suspended'}
                  </span>
                  {!u.email_verified && <span className="badge muted" style={{ marginLeft: 6 }}>unverified</span>}
                </td>
                <td className="muted small">{u.created_at.slice(0, 10)}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn ghost small" disabled={!u.is_active}
                            onClick={() => impersonate(u.id)}>
                      Impersonate
                    </button>
                    {u.is_active ? (
                      <button className="btn danger small" disabled={u.is_platform_admin}
                              onClick={() => setStatus(u.id, 'suspend')}>
                        Suspend
                      </button>
                    ) : (
                      <button className="btn small" onClick={() => setStatus(u.id, 'reactivate')}>
                        Reactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No users match.</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
