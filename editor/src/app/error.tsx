'use client';

/**
 * 500 — the App Router error boundary for this segment tree.
 * Must be a client component, and receives `reset()` to retry the render.
 */
import { useEffect } from 'react';

import StatusPage from '@/components/ui/StatusPage';

export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console and any attached error reporter.
    console.error('Unhandled UI error:', error);
  }, [error]);

  return (
    <StatusPage
      code={error.digest ? `500 · ${error.digest}` : '500'}
      icon="warning"
      tone="danger"
      title="Something went wrong"
      message={
        <>
          <p>
            An unexpected error stopped this page from rendering. Your content is
            safe — nothing was saved as a result of this error.
          </p>
          <p className="muted small">
            Quote the reference above when reporting it.
          </p>
        </>
      }
      actions={[
        { label: 'Try again', onClick: reset, primary: true },
        { label: 'Go to dashboard', href: '/' },
        { label: 'Report this', href: '/support' },
      ]}
    />
  );
}
