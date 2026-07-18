'use client';

/** System health (spec 013): DB latency, webhook delivery success rates,
 * recent failures, active sessions. Auto-refreshes every 30s. */
import { useEffect, useState } from 'react';

import Shell from '@/components/Shell';
import { api, fmtNum } from '@/lib/api';

interface WebhookStats {
  total: number;
  succeeded: number;
  failed: number;
  success_rate: number | null;
}

interface Health {
  db: { ok: boolean; latency_ms: number };
  webhooks_24h: WebhookStats;
  webhooks_7d: WebhookStats;
  recent_webhook_failures: {
    webhook: string;
    tenant_id: string;
    event: string;
    response_status: number | null;
    created_at: string;
    error: string;
  }[];
  active_sessions: number;
}

export default function HealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<Health>('/platform/health').then(setData).catch((e) => setError(String(e.message)));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>System health</h1>
          <p>Live signals — refreshes every 30 seconds.</p>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="cards">
            <div className="card">
              <div className="k">Database</div>
              <div className="v">
                <span className={`badge ${data.db.ok ? 'ok' : 'danger'}`}>{data.db.ok ? 'up' : 'down'}</span>
              </div>
              <div className="hint">{data.db.latency_ms} ms round-trip</div>
            </div>
            <WebhookCard label="Webhooks (24h)" stats={data.webhooks_24h} />
            <WebhookCard label="Webhooks (7d)" stats={data.webhooks_7d} />
            <div className="card">
              <div className="k">Active sessions</div>
              <div className="v">{fmtNum(data.active_sessions)}</div>
              <div className="hint">unexpired refresh tokens</div>
            </div>
          </div>

          <div className="panel">
            <h2>Recent webhook failures</h2>
            {data.recent_webhook_failures.length === 0 ? (
              <p className="muted small">No failed deliveries — all clear.</p>
            ) : (
              <div className="table-wrap" style={{ border: 'none' }}>
                <table className="data">
                  <thead>
                    <tr><th>Webhook</th><th>Event</th><th>Status</th><th>Error</th><th>When</th></tr>
                  </thead>
                  <tbody>
                    {data.recent_webhook_failures.map((f, i) => (
                      <tr key={i}>
                        <td>{f.webhook}</td>
                        <td><code>{f.event}</code></td>
                        <td><span className="badge danger">{f.response_status ?? 'error'}</span></td>
                        <td className="small muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {f.error || '—'}
                        </td>
                        <td className="muted small">{f.created_at.replace('T', ' ').slice(0, 16)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}

function WebhookCard({ label, stats }: { label: string; stats: WebhookStats }) {
  return (
    <div className="card">
      <div className="k">{label}</div>
      <div className="v">
        {stats.success_rate === null ? '—' : `${(stats.success_rate * 100).toFixed(1)}%`}
      </div>
      <div className="hint">
        {fmtNum(stats.succeeded)} ok · {fmtNum(stats.failed)} failed of {fmtNum(stats.total)}
      </div>
    </div>
  );
}
