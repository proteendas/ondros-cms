import type { Metadata } from 'next';

import DocsSidebar from '@/components/DocsSidebar';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'Guides and reference for building with Ondros CMS.',
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container docs-wrap">
      <DocsSidebar />
      <article className="docs-content">{children}</article>
    </div>
  );
}
