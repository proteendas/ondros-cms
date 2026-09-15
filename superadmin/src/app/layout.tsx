import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

// Bootstrap Icons webfont — every <Icon> renders `<i class="bi bi-…">`.
import 'bootstrap-icons/font/bootstrap-icons.css';

import './globals.css';

// Brand typography — matches the marketing site (ondros-cms-site): Plus Jakarta
// Sans for UI, JetBrains Mono for code/ids. The woff2 files are vendored in
// ./fonts (see its README) and loaded with next/font/local, so the build is
// hermetic — no fonts.googleapis.com fetch that Docker/offline CI can't make.
const sans = localFont({
  src: './fonts/PlusJakartaSans-Variable.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-sans',
});

const mono = localFont({
  src: './fonts/JetBrainsMono-Variable.woff2',
  weight: '100 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: {
    default: 'Ondros Platform Admin',
    template: '%s — Ondros Platform Admin',
  },
  description: 'Operator dashboard for the Ondros CMS platform.',
  icons: {
    icon: [
      { url: '/branding/favicon.ico', sizes: '32x32' },
      { url: '/branding/logo-icon.svg', type: 'image/svg+xml' },
    ],
  },
};

// Without this, mobile browsers render at a 980px virtual width and scale
// down — every layout below looks correct but is unusably small.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
