'use client';

/** Revenue dashboard (spec 013): MRR/ARR, per-plan breakdown, churn, and the
 * recent billing events already captured in the audit trail. */
import { useEffect, useState } from 'react';

import Shell from '@/components/Shell';
import { api, fmtNum } from '@/lib/api';

interface Revenue {
  mrr: number;
  arr: number;
  active_paid_subscriptions: number;
  free_accounts: number;
  by_plan: { plan: string; name: string; price_month_usd: number; accounts: number; mrr: number }[];
  churn_rate_30d: number;
  canceled_last_30d: number;
  recent_events: { action: string; tenant_id: string; actor: string; created_at: string; diff: Record<string, unknown> }[];
}

export default function RevenuePage() {
  const [data, setData] = useState<Revenue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Revenue>('/platform/revenue').then(setData).catch((e) => setError(String(e.message)));
  }, []);

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Revenue</h1>
          <p>Subscription revenue across all accounts (Stripe-backed or dev-mode).</p>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="cards">
            <div className="card"><div className="k">MRR</div><div className="v">${fmtNum(data.mrr)}</div></div>
            <div className="card"><div className="k">ARR</div><div className="v">${fmtNum(data.arr)}</div></div>
            <div className="card">
              <div className="k">Paid subscriptions</div>
              <div className="v">{fmtNum(data.active_paid_subscriptions)}</div>
              <div className="hint">{fmtNum(data.free_accounts)} accounts on free</div>
            </div>
            <div className="card">
              <div className="k">Churn (30d)</div>
              <div className="v">{(data.churn_rate_30d * 100).toFixed(1)}%</div>
              <div className="hint">{fmtNum(data.canceled_last_30d)} canceled</div>
            </div>
          </div>

          <div className="panel">
            <h2>Revenue by plan</h2>
            <div className="table-wrap" style={{ border: 'none' }}>
              <table className="data">
                <thead>
                  <tr><th>Plan</th><th>Price / month</th><th>Active accounts</th><th>MRR</th></tr>
                </thead>
                <tbody>
                  {data.by_plan.map((p) => (
                    <tr key={p.plan}>
                      <td><span className="badge muted">{p.plan}</span> {p.name}</td>
                      <td>${fmtNum(p.price_month_usd)}</td>
                      <td>{fmtNum(p.accounts)}</td>
                      <td>${fmtNum(p.mrr)}</td>
                    </tr>
                  ))}
                  {data.by_plan.length === 0 && (
                    <tr><td colSpan={4} className="muted">No subscriptions yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2>Recent subscription events</h2>
            {data.recent_events.length === 0 && <p className="muted small">No billing events recorded.</p>}
            {data.recent_events.map((e, i) => (
              <p key={i} className="small" style={{ margin: '6px 0' }}>
                <code>{e.action}</code> — {e.actor || 'system'}
                <span className="muted"> · {e.created_at.replace('T', ' ').slice(0, 16)}</span>
              </p>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}
