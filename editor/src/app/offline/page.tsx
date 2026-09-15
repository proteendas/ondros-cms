'use client';

import { useEffect, useState } from 'react';

import StatusPage from '@/components/ui/StatusPage';

export default function OfflinePage() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return (
    <StatusPage
      icon={online ? 'check' : 'warning'}
      tone={online ? 'success' : 'warning'}
      title={online ? "You're back online" : "You're offline"}
      message={
        online ? (
          <p>Your connection has returned. Continue where you left off.</p>
        ) : (
          <>
            <p>
              This app needs a connection to load and save content. Any unsaved
              changes are still in this tab — don&apos;t reload until you&apos;re back
              online.
            </p>
            <p className="muted small">This page updates itself when the connection returns.</p>
          </>
        )
      }
      actions={online ? [{ label: 'Go to dashboard', href: '/', primary: true }] : []}
    />
  );
}
