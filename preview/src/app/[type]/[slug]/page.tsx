/**
 * Generic entry page: /{content_type_api_id}/{slug}
 *
 * Draft mode OFF -> published content from the public delivery API.
 * Draft mode ON  -> draft content from the secret-gated preview API, plus the
 *                   InlineEditingBridge (inspector, inline editing, WS refresh).
 *
 * For real sites, add specialized routes (e.g. app/blog/[slug]) that render
 * bespoke components per content type — keep the data-cms-* attributes so
 * inline editing keeps working.
 */
import { draftMode } from 'next/headers';
import { notFound } from 'next/navigation';

import EntryRenderer from '@/components/EntryRenderer';
import InlineEditingBridge from '@/components/InlineEditingBridge';
import { getDraftEntry, getPublishedEntry } from '@/lib/cms';

export const dynamic = 'force-dynamic';

interface Props {
  params: { type: string; slug: string };
}

export default async function EntryPage({ params }: Props) {
  const { isEnabled } = draftMode();

  const entry = isEnabled
    ? await getDraftEntry(params.type, params.slug)
    : await getPublishedEntry(params.type, params.slug);

  if (!entry) notFound();

  return (
    <>
      <EntryRenderer entry={entry} />
      {isEnabled && <InlineEditingBridge entryId={entry.id} />}
    </>
  );
}
