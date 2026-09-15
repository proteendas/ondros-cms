/** Stripe Checkout return URL for a completed payment. */
import type { Metadata } from 'next';

import StatusPage from '@/components/ui/StatusPage';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Payment successful — ${BRAND.name}` };

export default function PaymentSuccessPage() {
  return (
    <StatusPage
      icon="publish"
      tone="success"
      title="Payment successful"
      message={
        <>
          <p>
            Thanks — your subscription is active and your new plan limits apply
            immediately.
          </p>
          <p className="muted small">
            A receipt is on its way by email. If the plan shown on the billing page
            still looks old, give it a minute and refresh: we apply the change when
            the payment processor confirms it.
          </p>
        </>
      }
      actions={[
        { label: 'View billing', href: '/settings/billing', primary: true },
        { label: 'Back to dashboard', href: '/' },
      ]}
    />
  );
}
