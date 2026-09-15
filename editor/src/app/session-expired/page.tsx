'use client';

import { useEffect } from 'react';

import StatusPage from '@/components/ui/StatusPage';
import { setTokens } from '@/lib/api';

export default function SessionExpiredPage() {
  // Clear stale credentials so the login page starts from a clean slate.
  useEffect(() => {
    setTokens(null, null);
  }, []);

  return (
    <StatusPage
      icon="lock"
      tone="warning"
      title="Your session expired"
      message={
        <>
          <p>
            You were signed out because your session timed out, your password
            changed, or an administrator ended your sessions.
          </p>
          <p>Signing in again will pick up right where you left off.</p>
        </>
      }
      actions={[
        { label: 'Sign in again', href: '/login', primary: true },
        { label: 'Get help', href: '/support' },
      ]}
    />
  );
}
