'use client';

/** Usage & limits (spec 013): per-account consumption vs plan ceilings,
 * sorted by API traffic, with a nearing-limit callout (≥80%). */
import { useEffect, useState } from 'react';

import Shell from '@/components/Shell';
import { api, fmtBytes, fmtNum } from '@/lib/api';

interface UsageRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  usage: { api_calls_month: number; entries: number; storage_bytes: number; seats: number };
  limits: Record<string, number>;
  pct_of_limit: Record<string, number>;
  nearing_limit: boolean;
}

export default function UsagePage() {
  const [data, setData] = useState<{ period: string; items: UsageRow[]; nearing_limit: UsageRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ period: string; items: UsageRow[]; nearing_limit: UsageRow[] }>('/platform/usage')
      .then(setData)
      .catch((e) => setError(String(e.message)));
  }, []);

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Usage &amp; limits</h1>
          <p>Consumption vs plan ceilings{data ? ` — period ${data.period}` : ''}.</p>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {data && data.nearing_limit.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--warn)' }}>
          <h2 style={{ color: 'var(--warn)' }}>Nearing plan limits (≥80%)</h2>
          {data.nearing_limit.map((r) => (
            <p key={r.id} className="small" style={{ margin: '4px 0' }}>
              <strong>{r.name}</strong> ({r.plan}) —{' '}
              {Object.entries(r.pct_of_limit)
                .filter(([, v]) => v >= 0.8)
                .map(([k, v]) => `${k.replace(/_/g, ' ')} at ${(v * 100).toFixed(0)}%`)
                .join(', ')}
            </p>
          ))}
        </div>
      )}
      {data && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Account</th><th>Plan</th><th>API calls</th><th>Entries</th><th>Storage</th><th>Seats</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.status !== 'active' && <span className="badge danger" style={{ marginLeft: 6 }}>{r.status}</span>}
                  </td>
                  <td><span className="badge muted">{r.plan}</span></td>
                  <MeterCell used={r.usage.api_calls_month} limit={r.limits.api_calls_month}
                             pct={r.pct_of_limit.api_calls_month} render={fmtNum} />
                  <MeterCell used={r.usage.entries} limit={r.limits.entries}
                             pct={r.pct_of_limit.entries} render={fmtNum} />
                  <MeterCell used={r.usage.storage_bytes} limit={r.limits.storage_bytes}
                             pct={r.pct_of_limit.storage_bytes} render={fmtBytes} />
                  <MeterCell used={r.usage.seats} limit={r.limits.seats}
                             pct={r.pct_of_limit.seats} render={fmtNum} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function MeterCell({
  used, limit, pct, render,
}: {
  used: number;
  limit?: number;
  pct?: number;
  render: (n: number) => string;
}) {
  const level = pct === undefined ? '' : pct >= 1 ? 'danger' : pct >= 0.8 ? 'warn' : '';
  return (
    <td>
      <div className="small">
        {render(used)}
        {limit ? <span className="muted"> / {render(limit)}</span> : null}
      </div>
      {pct !== undefined && (
        <div className={`meter ${level}`} style={{ marginTop: 4 }}>
          <span style={{ width: `${Math.min(100, pct * 100)}%` }} />
        </div>
      )}
    </td>
  );
}
