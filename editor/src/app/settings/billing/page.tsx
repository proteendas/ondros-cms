'use client';

/** Billing & usage (spec 005): current plan, usage meters, upgrade. */
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { formatBytes, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import type { PlanInfo, SubscriptionInfo } from '@/lib/types';

const METERS: { key: string; label: string; fmt?: (n: number) => string }[] = [
  { key: 'seats', label: 'Seats' },
  { key: 'entries', label: 'Entries' },
  { key: 'storage_bytes', label: 'Storage', fmt: formatBytes },
  { key: 'api_calls_month', label: 'API calls (this month)' },
  { key: 'spaces', label: 'Spaces' },
];

export default function BillingPage() {
  const toast = useToast();
  const { can } = useWorkspace();
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const load = useCallback(() => {
    api<SubscriptionInfo>('/billing/subscription').then(setSub).catch(() => {});
    api<PlanInfo[]>('/billing/plans').then(setPlans).catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function upgrade(planKey: string) {
    setBusyPlan(planKey);
    try {
      const res = await api<{ checkout_url: string | null; activated?: string }>(
        '/billing/checkout',
        { method: 'POST', body: JSON.stringify({ plan_key: planKey }) },
      );
      if (res.checkout_url) {
        window.location.href = res.checkout_url; // Stripe Checkout
      } else {
        toast(`Plan activated: ${res.activated}`);
        load();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Plan change failed', 'error');
    } finally {
      setBusyPlan(null);
    }
  }

  if (!sub) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Billing & usage</h1>
          <p className="subtitle">
            Current plan: <strong>{sub.plan.name}</strong>
            {sub.dev_mode && <span className="chip" style={{ marginLeft: 8 }}>dev mode — no Stripe</span>}
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Usage</h2>
        {METERS.map(({ key, label, fmt }) => {
          const used = sub.usage[key] ?? 0;
          const limit = sub.plan.limits[key] ?? 0;
          const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
          const show = fmt ?? ((n: number) => String(n));
          return (
            <div key={key} style={{ margin: '10px 0' }}>
              <div className="row">
                <span style={{ fontWeight: 500 }}>{label}</span>
                <span className="spacer" />
                <span className="muted small">
                  {show(used)} / {limit ? show(limit) : '∞'}
                </span>
              </div>
              <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden', marginTop: 4 }}>
                <div
                  style={{
                    width: `${pct}%`, height: '100%', borderRadius: 999,
                    background: pct >= 90 ? 'var(--danger)' : pct >= 70 ? '#f59e0b' : 'var(--primary)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <h2 style={{ marginTop: 24 }}>Plans</h2>
      <div className="card-grid">
        {plans.map((plan) => {
          const current = plan.key === sub.plan.key;
          return (
            <div key={plan.key} className="card type-card"
                 style={current ? { borderColor: 'var(--primary)' } : undefined}>
              <div className="row">
                <div className="type-title">{plan.name}</div>
                {current && <span className="chip" style={{ color: 'var(--primary)' }}>current</span>}
              </div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>
                ${Number(plan.price_month_usd).toFixed(0)}
                <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/month</span>
              </div>
              <ul className="type-meta" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
                <li>{plan.limits.seats} seats</li>
                <li>{plan.limits.entries?.toLocaleString()} entries</li>
                <li>{formatBytes(plan.limits.storage_bytes ?? 0)} storage</li>
                <li>{plan.limits.api_calls_month?.toLocaleString()} API calls/mo</li>
                <li>{plan.limits.spaces} spaces</li>
              </ul>
              {can('manage_settings') && !current && (
                <button className="btn" disabled={busyPlan !== null} onClick={() => upgrade(plan.key)}>
                  {busyPlan === plan.key ? '…' : sub.dev_mode ? 'Activate (dev)' : 'Upgrade'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted small" style={{ marginTop: 16 }}>
        Hitting a ceiling returns <code>402 plan_limit_reached</code> on create operations and{' '}
        <code>429 api_quota_exceeded</code> once the monthly API-call quota is exhausted.
      </p>
    </div>
  );
}
