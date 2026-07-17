import type { Metadata } from 'next';

import AppShell from '@/components/AppShell';
import { ToastProvider } from '@/components/ui';
import { WorkspaceProvider } from '@/lib/workspace';

import './globals.css';

export const metadata: Metadata = {
  title: 'Compose CMS',
  description: 'Headless CMS editor — content modeling, entries, media, AI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WorkspaceProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
