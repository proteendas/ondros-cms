/** Docs sidebar tree (spec 011). Each entry maps to an MDX page at
 * src/app/docs/<slug>/page.mdx; order here drives the sidebar. */

export interface DocPage {
  slug: string;
  title: string;
}

export interface DocSection {
  label: string;
  pages: DocPage[];
}

export const DOCS_NAV: DocSection[] = [
  {
    label: 'Start here',
    pages: [
      { slug: '', title: 'Introduction' },
      { slug: 'getting-started', title: 'Getting Started' },
      { slug: 'core-concepts', title: 'Core Concepts' },
    ],
  },
  {
    label: 'Build',
    pages: [
      { slug: 'sdk', title: 'SDK Reference' },
      { slug: 'api', title: 'API Reference' },
      { slug: 'webhooks', title: 'Webhooks' },
    ],
  },
  {
    label: 'Go further',
    pages: [
      { slug: 'ai-features', title: 'AI Features' },
      { slug: 'faq', title: 'FAQ & Troubleshooting' },
    ],
  },
];

export const FLAT_PAGES: DocPage[] = DOCS_NAV.flatMap((s) => s.pages);

export function docHref(slug: string): string {
  return slug ? `/docs/${slug}` : '/docs';
}
