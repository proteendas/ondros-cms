import type { Metadata } from 'next';

import StatusPage from '@/components/ui/StatusPage';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Access denied — ${BRAND.name}` };

export default function ForbiddenPage() {
  return (
    <StatusPage
      code="403"
      icon="lock"
      tone="warning"
      title="You don't have access to this"
      message={
        <>
          <p>
            Your role in this organization doesn&apos;t include the permission this
            page needs. Permissions can also be scoped to specific spaces, so you
            may have access elsewhere.
          </p>
          <p>Ask an organization admin to adjust your role if you need it.</p>
        </>
      }
      actions={[
        { label: 'Go to dashboard', href: '/', primary: true },
        { label: 'See my roles', href: '/profile' },
        { label: 'Request access', href: '/support' },
      ]}
    />
  );
}
