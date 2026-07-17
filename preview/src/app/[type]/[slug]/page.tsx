/**
 * Generic entry page: /{content_type_api_id}/{slug}
 *
 * Draft mode OFF -> published content via the delivery API (delivery token).
 * Draft mode ON  -> draft content via the preview API (preview token), plus
 *                   the InlineEditingBridge (inspector, inline editing, WS
 *                   refresh) and the environment/locale from the preview cookie.
 *
 * References are fetched with include=2, so assemblies (landing page -> hero +
 * cards) render nested blocks. For real sites, add specialized routes
 * (e.g. app/blog/[slug]) with bespoke components per content type — keep the
 * data-cms-* attributes so inline editing keeps working.
 */
import { draftMode } from 'next/headers';
import { notFound } from 'next/navigation';

import EntryRenderer from '@/components/EntryRenderer';
import InlineEditingBridge from '@/components/InlineEditingBridge';
import { getEntry } from '@/lib/cms';
import { readPreviewContext } from '@/lib/previewContext';

export const dynamic = 'force-dynamic';

interface Props {
  params: { type: string; slug: string };
}

export default async function EntryPage({ params }: Props) {
  const { isEnabled } = draftMode();
  const ctx = isEnabled ? readPreviewContext() : { environment: null, locale: null };

  const result = await getEntry(params.type, params.slug, {
    draft: isEnabled,
    environment: ctx.environment,
    locale: ctx.locale,
  });

  if (!result) notFound();

  return (
    <>
      <EntryRenderer entry={result.entry} includes={result.includes} />
      {isEnabled && (
        <InlineEditingBridge entryId={result.entry.id} locale={ctx.locale ?? undefined} />
      )}
    </>
  );
}
