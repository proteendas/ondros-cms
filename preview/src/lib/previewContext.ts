/** Preview context (environment + locale) carried in a cookie while draft
 * mode is active. Set by /api/preview, cleared by /api/exit-preview. */
import { cookies } from 'next/headers';

export const PREVIEW_CTX_COOKIE = 'cms_preview_ctx';

export interface PreviewContext {
  environment: string | null;
  locale: string | null;
}

export function readPreviewContext(): PreviewContext {
  try {
    const raw = cookies().get(PREVIEW_CTX_COOKIE)?.value;
    if (!raw) return { environment: null, locale: null };
    const parsed = JSON.parse(raw) as { environment?: string; locale?: string };
    return { environment: parsed.environment || null, locale: parsed.locale || null };
  } catch {
    return { environment: null, locale: null };
  }
}
