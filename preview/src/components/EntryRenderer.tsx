/**
 * Renders an entry generically from its content type schema, stamping every
 * field element with the attributes the inline-editing system relies on:
 *
 *   data-cms-entry-id    on the wrapping <article>
 *   data-cms-field-id    on each field element
 *   data-cms-field-type  so the bridge knows HTML vs plain-text commits
 *
 * Server component — no client JS. The interactive layer (hover/click/edit)
 * is added in draft mode by InlineEditingBridge via event delegation.
 */
import type { DeliveredEntry, FieldDef } from '@/lib/cms';

export default function EntryRenderer({ entry }: { entry: DeliveredEntry }) {
  return (
    <main className="entry" data-cms-entry-id={entry.id}>
      {entry.contentType.fields.map((field) => (
        <Field key={field.id} field={field} value={entry.fields[field.id]} />
      ))}
    </main>
  );
}

function Field({ field, value }: { field: FieldDef; value: unknown }) {
  const attrs = {
    'data-cms-field-id': field.id,
    'data-cms-field-type': field.type,
  };

  if (value === null || value === undefined || value === '') {
    // Render an editable placeholder in draft mode so empty fields are clickable.
    return (
      <p {...attrs} style={{ opacity: 0.4 }}>
        [{field.name}]
      </p>
    );
  }

  switch (field.type) {
    case 'richtext':
      // Draft HTML comes from TipTap / the AI prompt contract (sanitized tag set).
      // If untrusted authors can write content, sanitize server-side (e.g. bleach/DOMPurify).
      return <div {...attrs} className="richtext" dangerouslySetInnerHTML={{ __html: String(value) }} />;
    case 'media':
      // eslint-disable-next-line @next/next/no-img-element
      return <img {...attrs} src={String(value)} alt={field.name} style={{ maxWidth: '100%' }} />;
    case 'boolean':
      return <p {...attrs}>{value ? 'Yes' : 'No'}</p>;
    case 'date':
    case 'number':
      return <p {...attrs}>{String(value)}</p>;
    case 'text':
    default: {
      // Heuristics for the placeholder site: title-ish fields render as h1,
      // excerpt-ish as a lede. Replace with per-content-type components.
      if (field.id === 'title' || field.id === 'hero_title') {
        return <h1 {...attrs}>{String(value)}</h1>;
      }
      if (field.id === 'excerpt' || field.id === 'hero_subtitle') {
        return (
          <p {...attrs} className="excerpt">
            {String(value)}
          </p>
        );
      }
      if (field.id === 'seo_description') {
        return null; // meta-only field; not rendered in the body
      }
      return <p {...attrs}>{String(value)}</p>;
    }
  }
}
