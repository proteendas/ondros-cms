/** 404 — Next.js renders this for unmatched routes and explicit notFound(). */
import type { Metadata } from 'next';

import StatusPage from '@/components/ui/StatusPage';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Page not found — ${BRAND.name}` };

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      icon="search"
      title="We couldn't find that page"
      message={
        <p>
          The link may be out of date, or the content may have been moved,
          unpublished or deleted.
        </p>
      }
      actions={[
        { label: 'Go to dashboard', href: '/', primary: true },
        { label: 'Browse content', href: '/entries' },
        { label: 'Get help', href: '/support' },
      ]}
    />
  );
}
