'use client';

/**
 * Cancel subscription — a downgrade to the free plan.
 *
 * There is no dedicated "cancel" endpoint in the billing API; a cancellation is
 * a plan change to `free`, which is exactly what /settings/billing does for any
 * other plan. This page exists to make the consequences explicit and to ask for
 * confirmation before that happens.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { useToast } from '@/components/ui';
import Icon from '@/components/ui/Icon';
import { api } from '@/lib/api';
import type { PlanInfo, SubscriptionInfo } from '@/lib/types';

const FREE_PLAN_KEY = 'free';

export default function CancelSubscriptionPage() {
  const toast = useToast();
  const router = useRouter();
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [freePlan, setFreePlan] = useState<PlanInfo | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SubscriptionInfo>('/billing/subscription').then(setSub).catch(() => setSub(null));
    api<PlanInfo[]>('/billing/plans')
      .then((plans) => setFreePlan(plans.find((p) => p.key === FREE_PLAN_KEY) ?? null))
      .catch(() => {});
  }, []);

  const onFreeAlready = sub?.plan.key === FREE_PLAN_KEY;

  async function cancel() {
    setBusy(true);
    try {
      await api('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan_key: FREE_PLAN_KEY }),
      });
      toast('Subscription cancelled — your account is on the free plan.');
      router.push('/settings/billing');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not cancel the subscription', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <div>
          <h1>Cancel subscription</h1>
          <p className="subtitle">Move this organization back to the free plan.</p>
        </div>
      </div>

      {sub === null ? (
        <p className="muted">Loading your subscription…</p>
      ) : onFreeAlready ? (
        <section className="card profile-card">
          <p style={{ margin: 0 }}>
            You&apos;re already on the <strong>free</strong> plan — there&apos;s nothing to
            cancel.
          </p>
          <div style={{ marginTop: 14 }}>
            <Link href="/settings/billing" className="btn secondary">Back to billing</Link>
          </div>
        </section>
      ) : (
        <>
          <section className="card profile-card">
            <h2>What you&apos;re cancelling</h2>
            <dl className="profile-meta">
              <dt>Current plan</dt>
              <dd><strong>{sub.plan.name}</strong></dd>
              <dt>Moving to</dt>
              <dd>{freePlan?.name ?? 'Free'}</dd>
            </dl>
          </section>

          <section className="card profile-card">
            <h2>What happens next</h2>
            <ul className="prose" style={{ margin: 0 }}>
              <li><strong>Nothing is deleted.</strong> Your content, models and media stay exactly as they are.</li>
              <li>Paid features remain available until the end of the current billing period.</li>
              <li>
                After that, free-plan limits apply. If you&apos;re over a limit, those
                resources become read-only rather than being removed — so you can
                always export.
              </li>
              <li>You can resubscribe at any time from the billing page.</li>
            </ul>
            <p className="help-text">
              Full details in the <Link href="/legal/cancellation-policy">Cancellation Policy</Link>.
            </p>
          </section>

          <section className="card profile-card">
            <h2>Confirm</h2>
            <label className="field-label" htmlFor="confirm-cancel">
              Type <code>CANCEL</code> to confirm
            </label>
            <input
              id="confirm-cancel"
              className="input"
              value={confirm}
              autoComplete="off"
              onChange={(e) => setConfirm(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <div className="modal-footer">
              <Link href="/settings/billing" className="btn secondary">Keep my plan</Link>
              <button
                className="btn danger"
                disabled={busy || confirm.trim().toUpperCase() !== 'CANCEL'}
                onClick={() => void cancel()}
              >
                <Icon name="warning" size={13} />
                {busy ? ' Cancelling…' : ' Cancel subscription'}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
