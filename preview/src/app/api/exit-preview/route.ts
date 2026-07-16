/** GET /api/exit-preview — disables draft mode and returns to the homepage. */
import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';

export async function GET() {
  draftMode().disable();
  redirect('/');
}
