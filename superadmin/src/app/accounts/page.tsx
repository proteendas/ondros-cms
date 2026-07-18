'use client';

/** Accounts list + drill-down (spec 013): search, plan/seat/status columns,
 * expandable detail row, suspend/reactivate. */
import { useCallback, useEffect, useState } from 'react';

import Shell from '@/components/Shell';
import { api, fmtBytes, fmtNum } from '@/lib/api';

interface AccountRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  plan: string;
  subscription_status: string | null;
  seats: number;
  spaces: number;
  entries: number;
}

interface AccountDetail {
  plan: string;
  limits: Record<string, number>;
  usage: Record<string, number>;
  subscription: { status: string; current_period_end: string | null } | null;
  spaces: { id: string; name: string; slug: string; entries: number }[];
  members: { user_id: string; email: string; full_name: string; is_owner: boolean; is_active: boolean }[];
}

export default function AccountsPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ total: number; items: AccountRow[] }>(`/platform/accounts?q=${encodeURIComponent(q)}`)
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

  async function toggle(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    setDetail(null);
    setDetail(await api<AccountDetail>(`/platform/accounts/${id}`));
  }

  async function setStatus(id: string, action: 'suspend' | 'reactivate') {
    await api(`/platform/accounts/${id}/${action}`, { method: 'POST' });
    load();
    if (open === id) setDetail(await api<AccountDetail>(`/platform/accounts/${id}`));
  }

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p>{fmtNum(total)} accounts on the platform.</p>
        </div>
        <span className="spacer" />
        <input className="input search" placeholder="Search name or slug…" value={q}
               onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Account</th><th>Plan</th><th>Status</th><th>Seats</th>
              <th>Spaces</th><th>Entries</th><th>Created</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <AccountRows key={r.id} row={r} open={open === r.id} detail={detail}
                           onToggle={() => toggle(r.id)} onStatus={setStatus} />
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="muted">No accounts match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

function AccountRows({
  row, open, detail, onToggle, onStatus,
}: {
  row: AccountRow;
  open: boolean;
  detail: AccountDetail | null;
  onToggle: () => void;
  onStatus: (id: string, action: 'suspend' | 'reactivate') => void;
}) {
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>
          <strong>{row.name}</strong>
          <div className="muted small mono">{row.slug}</div>
        </td>
        <td><span className="badge muted">{row.plan}</span></td>
        <td>
          <span className={`badge ${row.status === 'active' ? 'ok' : 'danger'}`}>{row.status}</span>
        </td>
        <td>{row.seats}</td>
        <td>{row.spaces}</td>
        <td>{fmtNum(row.entries)}</td>
        <td className="muted small">{row.created_at.slice(0, 10)}</td>
        <td onClick={(e) => e.stopPropagation()}>
          {row.status === 'active' ? (
            <button className="btn danger small" onClick={() => onStatus(row.id, 'suspend')}>Suspend</button>
          ) : (
            <button className="btn small" onClick={() => onStatus(row.id, 'reactivate')}>Reactivate</button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="drawer-row">
          <td colSpan={8}>
            {!detail ? (
              <span className="muted small">Loading…</span>
            ) : (
              <div>
                <div className="kv">
                  {(['entries', 'storage_bytes', 'seats', 'api_calls_month'] as const).map((metric) => (
                    <div className="item" key={metric}>
                      <div className="k">{metric.replace(/_/g, ' ')}</div>
                      <div>
                        {metric === 'storage_bytes'
                          ? fmtBytes(detail.usage[metric] ?? 0)
                          : fmtNum(detail.usage[metric] ?? 0)}
                        {detail.limits[metric] ? (
                          <span className="muted small">
                            {' '}/ {metric === 'storage_bytes' ? fmtBytes(detail.limits[metric]) : fmtNum(detail.limits[metric])}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  <div className="item">
                    <div className="k">subscription</div>
                    <div>{detail.subscription ? detail.subscription.status : 'none (free)'}</div>
                  </div>
                </div>
                <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
                  <div>
                    <h2 style={{ fontSize: 13 }}>Spaces</h2>
                    {detail.spaces.length === 0 && <p className="muted small">No spaces.</p>}
                    {detail.spaces.map((s) => (
                      <p key={s.id} className="small" style={{ margin: '4px 0' }}>
                        {s.name} <span className="muted mono">({s.slug})</span> — {fmtNum(s.entries)} entries
                      </p>
                    ))}
                  </div>
                  <div>
                    <h2 style={{ fontSize: 13 }}>Members</h2>
                    {detail.members.map((m) => (
                      <p key={m.user_id} className="small" style={{ margin: '4px 0' }}>
                        {m.email}
                        {m.is_owner && <span className="badge muted" style={{ marginLeft: 6 }}>owner</span>}
                        {!m.is_active && <span className="badge danger" style={{ marginLeft: 6 }}>suspended</span>}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
