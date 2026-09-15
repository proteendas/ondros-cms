import type { Metadata } from 'next';

import StatusPage from '@/components/ui/StatusPage';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Scheduled maintenance — ${BRAND.name}` };

export default function MaintenancePage() {
  return (
    <StatusPage
      icon="reload"
      tone="info"
      title="Down for scheduled maintenance"
      message={
        <>
          <p>
            We&apos;re making planned changes and will be back shortly. Published
            content served through the Delivery API is unaffected.
          </p>
          <p className="muted small">
            This page is served deliberately — routing traffic here is how an
            operator signals maintenance.
          </p>
        </>
      }
      actions={[{ label: 'Check again', href: '/', primary: true }]}
    />
  );
}
