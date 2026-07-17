/**
 * Draft-mode entry point (Contentful Live Preview-style):
 *   GET /api/preview?token=<preview api key>&type=article&slug=welcome
 *                    [&space=...&environment=master&locale=en-US]
 *
 * Validates the preview API key (must match this app's configured key),
 * enables Next.js draft mode, stores the preview context (environment +
 * locale) in a cookie, and redirects to the page route. While draft mode is
 * on, pages fetch DRAFT content from the CMS preview API.
 */
import { cookies, draftMode } from 'next/headers';
import { redirect } from 'next/navigation';

import { PREVIEW_CTX_COOKIE } from '@/lib/previewContext';

const PREVIEW_TOKEN = process.env.CMS_PREVIEW_TOKEN ?? 'cms_pre_dev-preview-token-0000';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // `secret` accepted for backwards compatibility with older editor builds.
  const token = searchParams.get('token') ?? searchParams.get('secret');
  const type = searchParams.get('type');
  const slug = searchParams.get('slug');
  const environment = searchParams.get('environment') ?? '';
  const locale = searchParams.get('locale') ?? '';

  if (token !== PREVIEW_TOKEN) {
    return new Response('Invalid preview token', { status: 401 });
  }
  if (!type || !slug) {
    return new Response('Missing "type" or "slug" query params', { status: 400 });
  }

  draftMode().enable();
  cookies().set(PREVIEW_CTX_COOKIE, JSON.stringify({ environment, locale }), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

  // NOTE (cross-site iframes): localhost:3000 -> localhost:3001 counts as
  // same-site, so the draft cookie works in the editor's iframe during local
  // dev. Across real domains, serve editor+preview under one site or set the
  // bypass cookie SameSite=None; Secure.
  redirect(`/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`);
}
