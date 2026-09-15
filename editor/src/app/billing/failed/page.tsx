import type { Metadata } from 'next';

import StatusPage from '@/components/ui/StatusPage';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Payment failed — ${BRAND.name}` };

export default function PaymentFailedPage() {
  return (
    <StatusPage
      icon="warning"
      tone="danger"
      title="Payment didn't go through"
      message={
        <>
          <p>
            Your card wasn&apos;t charged and your plan is unchanged — you can keep
            working on your current plan.
          </p>
          <p>Common causes:</p>
        </>
      }
      actions={[
        { label: 'Try again', href: '/settings/billing', primary: true },
        { label: 'Contact support', href: '/support' },
      ]}
    >
      <ul className="prose" style={{ margin: 0 }}>
        <li>The card was declined, expired, or has insufficient funds.</li>
        <li>Your bank asked for verification that wasn&apos;t completed in time.</li>
        <li>The billing address didn&apos;t match your card.</li>
      </ul>
    </StatusPage>
  );
}
