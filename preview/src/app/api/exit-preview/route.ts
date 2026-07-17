/** GET /api/exit-preview — disables draft mode, clears the preview context
 * cookie, and returns to the homepage. */
import { cookies, draftMode } from 'next/headers';
import { redirect } from 'next/navigation';

import { PREVIEW_CTX_COOKIE } from '@/lib/previewContext';

export async function GET() {
  draftMode().disable();
  cookies().delete(PREVIEW_CTX_COOKIE);
  redirect('/');
}
