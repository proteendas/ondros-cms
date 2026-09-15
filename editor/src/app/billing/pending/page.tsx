import type { Metadata } from 'next';

import StatusPage from '@/components/ui/StatusPage';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Payment pending — ${BRAND.name}` };

export default function PaymentPendingPage() {
  return (
    <StatusPage
      icon="history"
      tone="warning"
      title="Payment is being processed"
      message={
        <>
          <p>
            Your payment has been submitted but not confirmed yet. Some payment
            methods and bank verification steps take a few minutes — occasionally
            longer.
          </p>
          <p>
            You don&apos;t need to pay again. Your plan updates automatically once
            the payment clears, and we&apos;ll email you either way.
          </p>
        </>
      }
      actions={[
        { label: 'Check billing status', href: '/settings/billing', primary: true },
        { label: 'Back to dashboard', href: '/' },
      ]}
    />
  );
}
