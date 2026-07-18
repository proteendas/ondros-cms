import type { Metadata } from 'next';

import AppShell from '@/components/AppShell';
import { ToastProvider } from '@/components/ui';
import { BRAND } from '@/lib/brand';
import { WorkspaceProvider } from '@/lib/workspace';

import './globals.css';

export const metadata: Metadata = {
  title: BRAND.name,
  description: `${BRAND.name} editor — content modeling, entries, media, AI`,
  icons: {
    icon: [
      { url: BRAND.favicon, sizes: '32x32' },
      { url: BRAND.logoIcon, type: 'image/svg+xml' },
    ],
  },
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
