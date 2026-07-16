/**
 * Draft-mode entry point, mirroring Contentful Live Preview / Next.js docs:
 *   GET /api/preview?secret=...&type=article&slug=welcome
 *
 * Validates the shared secret, enables Next.js draft mode (sets the bypass
 * cookie), and redirects to the page route. While draft mode is on, pages
 * fetch DRAFT content from the CMS preview API instead of published content.
 */
import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const type = searchParams.get('type');
  const slug = searchParams.get('slug');

  if (secret !== (process.env.PREVIEW_SECRET ?? 'dev-preview-secret')) {
    return new Response('Invalid preview secret', { status: 401 });
  }
  if (!type || !slug) {
    return new Response('Missing "type" or "slug" query params', { status: 400 });
  }

  draftMode().enable();

  // NOTE (cross-site iframes): localhost:3000 -> localhost:3001 counts as
  // same-site, so the draft cookie works in the editor's iframe during local
  // dev. Across real domains, serve editor+preview under one site or set the
  // bypass cookie SameSite=None; Secure.
  redirect(`/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`);
}
