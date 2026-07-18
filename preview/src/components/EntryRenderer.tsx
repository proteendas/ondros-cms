/**
 * Renders an entry generically from its content type schema, stamping every
 * field element with the attributes the inline-editing system relies on:
 *
 *   data-cms-entry-id    on each entry wrapper (root AND nested blocks)
 *   data-cms-field-id    on each field element
 *   data-cms-field-type  so the bridge knows HTML vs plain-text commits
 *
 * Reference fields resolve against `includes` (fetched with include=2), so
 * assemblies render their nested blocks — each with its own entry id, making
 * nested blocks inline-editable too.
 *
 * Server component — no client JS. The interactive layer (hover/click/edit)
 * is added in draft mode by InlineEditingBridge via event delegation.
 */
import type { DeliveredAsset, DeliveredEntry, FieldDef, Includes } from '@/lib/cms';
import { buildIncludeMaps } from '@/lib/cms';

const MEDIA_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const MAX_NESTING = 3;

interface Maps {
  entries: Map<string, DeliveredEntry>;
  assets: Map<string, DeliveredAsset>;
}

export default function EntryRenderer({
  entry,
  includes,
}: {
  entry: DeliveredEntry;
  includes: Includes;
}) {
  const maps = buildIncludeMaps(includes);
  return (
    <main className="entry" data-cms-entry-id={entry.id}>
      <EntryBody entry={entry} maps={maps} depth={0} />
    </main>
  );
}

function EntryBody({ entry, maps, depth }: { entry: DeliveredEntry; maps: Maps; depth: number }) {
  const fields = entry.contentType.fields ?? inferFields(entry.fields);
  return (
    <>
      {fields.map((field) => (
        <Field key={field.id} field={field} value={entry.fields[field.id]} maps={maps} depth={depth} />
      ))}
    </>
  );
}

/** Delivery responses omit the schema; infer minimal defs so rendering still works. */
function inferFields(values: Record<string, unknown>): FieldDef[] {
  return Object.keys(values).map((id) => ({ id, name: id, type: 'text' }));
}

function Field({
  field,
  value,
  maps,
  depth,
}: {
  field: FieldDef;
  value: unknown;
  maps: Maps;
  depth: number;
}) {
  const attrs = {
    'data-cms-field-id': field.id,
    'data-cms-field-type': field.type,
  };

  // Meta-only fields are not rendered in the body.
  if (field.id.includes('seo')) return null;

  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
    // Render an editable placeholder in draft mode so empty fields are clickable.
    return (
      <p {...attrs} style={{ opacity: 0.4 }}>
        [{field.name}]
      </p>
    );
  }

  switch (field.type) {
    case 'richtext':
      // Spec 015: value is a ProseMirror JSON doc (new) or a legacy HTML string.
      if (value && typeof value === 'object' && (value as RichTextNode).type === 'doc') {
        return (
          <div {...attrs} className="richtext">
            <RichTextNodes nodes={(value as RichTextNode).content ?? []} maps={maps} keyPrefix="rt" />
          </div>
        );
      }
      // Legacy HTML string. If untrusted authors can write content, sanitize
      // server-side (e.g. bleach/DOMPurify).
      return <div {...attrs} className="richtext" dangerouslySetInnerHTML={{ __html: String(value) }} />;

    case 'media':
      return <Media attrs={attrs} id={String(value)} maps={maps} name={field.name} />;

    case 'media_many':
      return (
        <div {...attrs} className="media-row">
          {(value as string[]).map((id) => (
            <Media key={id} attrs={{}} id={id} maps={maps} name={field.name} />
          ))}
        </div>
      );

    case 'reference': {
      const linked = maps.entries.get(String(value));
      if (!linked || depth >= MAX_NESTING) return <p {...attrs}>→ {String(value)}</p>;
      return (
        <section
          {...attrs}
          className={`block block-${linked.contentType.apiId}`}
          data-cms-entry-id={linked.id}
        >
          <EntryBody entry={linked} maps={maps} depth={depth + 1} />
        </section>
      );
    }

    case 'reference_many': {
      const ids = value as string[];
      return (
        <div {...attrs} className="block-list">
          {ids.map((id) => {
            const linked = maps.entries.get(id);
            if (!linked || depth >= MAX_NESTING) return null;
            return (
              <section
                key={id}
                className={`block block-${linked.contentType.apiId}`}
                data-cms-entry-id={linked.id}
              >
                <EntryBody entry={linked} maps={maps} depth={depth + 1} />
              </section>
            );
          })}
        </div>
      );
    }

    case 'boolean':
      return <p {...attrs}>{value ? 'Yes' : 'No'}</p>;

    case 'json':
      return (
        <pre {...attrs} className="json-block">
          {JSON.stringify(value, null, 2)}
        </pre>
      );

    case 'datetime':
    case 'date':
      return (
        <p {...attrs} className="meta">
          {new Date(String(value)).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      );

    case 'number':
    case 'select':
      return <p {...attrs}>{String(value)}</p>;

    case 'longtext':
      return (
        <p {...attrs} style={{ whiteSpace: 'pre-wrap' }}>
          {String(value)}
        </p>
      );

    case 'slug':
    case 'text':
    default: {
      // Heuristics for the placeholder site: title-ish fields render as
      // headings, excerpt-ish as a lede. Replace with per-content-type components.
      if (['title', 'heading', 'hero_title'].includes(field.id)) {
        return depth === 0 ? <h1 {...attrs}>{String(value)}</h1> : <h2 {...attrs}>{String(value)}</h2>;
      }
      if (['excerpt', 'subheading', 'hero_subtitle'].includes(field.id)) {
        return (
          <p {...attrs} className="excerpt">
            {String(value)}
          </p>
        );
      }
      if (field.id === 'cta_label') {
        return (
          <p>
            <span {...attrs} className="cta">
              {String(value)}
            </span>
          </p>
        );
      }
      return <p {...attrs}>{String(value)}</p>;
    }
  }
}

/* ---- Rich text (ProseMirror JSON) rendering (spec 015) --------------------- */

interface RichTextMark {
  type: string;
  attrs?: Record<string, unknown>;
}
interface RichTextNode {
  type?: string;
  content?: RichTextNode[];
  text?: string;
  marks?: RichTextMark[];
  attrs?: Record<string, unknown>;
}

/** Wrap a text run in its marks (bold/italic/color/highlight/links…). */
function applyMarks(text: React.ReactNode, marks: RichTextMark[] | undefined, maps: Maps, key: string): React.ReactNode {
  if (!marks?.length) return text;
  return marks.reduce<React.ReactNode>((acc, mark, i) => {
    const k = `${key}-m${i}`;
    switch (mark.type) {
      case 'bold': return <strong key={k}>{acc}</strong>;
      case 'italic': return <em key={k}>{acc}</em>;
      case 'underline': return <u key={k}>{acc}</u>;
      case 'strike': return <s key={k}>{acc}</s>;
      case 'code': return <code key={k}>{acc}</code>;
      case 'textStyle': return <span key={k} style={{ color: mark.attrs?.color as string | undefined }}>{acc}</span>;
      case 'highlight': return <mark key={k} style={{ background: (mark.attrs?.color as string) || undefined }}>{acc}</mark>;
      case 'link': return <a key={k} href={String(mark.attrs?.href ?? '#')}>{acc}</a>;
      case 'linkedEntry': {
        const e = maps.entries.get(String(mark.attrs?.id));
        return <a key={k} href={e ? `/${e.contentType.apiId}/${e.slug}` : '#'}>{acc}</a>;
      }
      case 'linkedAsset': {
        const a = maps.assets.get(String(mark.attrs?.id));
        return <a key={k} href={a ? `${MEDIA_URL}${a.url}` : '#'}>{acc}</a>;
      }
      default: return acc;
    }
  }, text);
}

function RichTextNodes({ nodes, maps, keyPrefix }: { nodes: RichTextNode[]; maps: Maps; keyPrefix: string }) {
  return <>{nodes.map((n, i) => <RichTextNodeEl key={`${keyPrefix}-${i}`} node={n} maps={maps} nodeKey={`${keyPrefix}-${i}`} />)}</>;
}

function RichTextNodeEl({ node, maps, nodeKey }: { node: RichTextNode; maps: Maps; nodeKey: string }) {
  const kids = <RichTextNodes nodes={node.content ?? []} maps={maps} keyPrefix={nodeKey} />;
  switch (node.type) {
    case 'text':
      return <>{applyMarks(node.text ?? '', node.marks, maps, nodeKey)}</>;
    case 'hardBreak':
      return <br />;
    case 'paragraph':
      return <p>{kids}</p>;
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6);
      const Tag = (`h${level}`) as keyof JSX.IntrinsicElements;
      return <Tag>{kids}</Tag>;
    }
    case 'blockquote': return <blockquote>{kids}</blockquote>;
    case 'bulletList': return <ul>{kids}</ul>;
    case 'orderedList': return <ol>{kids}</ol>;
    case 'listItem': return <li>{kids}</li>;
    case 'codeBlock': return <pre><code>{kids}</code></pre>;
    case 'horizontalRule': return <hr />;
    case 'table': return <table><tbody>{kids}</tbody></table>;
    case 'tableRow': return <tr>{kids}</tr>;
    case 'tableCell': return <td>{kids}</td>;
    case 'tableHeader': return <th>{kids}</th>;
    case 'embeddedEntryBlock': {
      const e = maps.entries.get(String(node.attrs?.id));
      if (!e) return null;
      return (
        <section className={`block block-${e.contentType.apiId}`} data-cms-entry-id={e.id}>
          <EntryBody entry={e} maps={maps} depth={1} />
        </section>
      );
    }
    case 'embeddedEntryInline': {
      const e = maps.entries.get(String(node.attrs?.id));
      if (!e) return null;
      return <a className="embed-inline" href={`/${e.contentType.apiId}/${e.slug}`}>{e.contentType.name}: {e.slug}</a>;
    }
    case 'embeddedAssetBlock':
      return <Media attrs={{}} id={String(node.attrs?.id ?? '')} maps={maps} name="asset" />;
    default:
      return node.content ? <div>{kids}</div> : null;
  }
}

function Media({
  attrs,
  id,
  maps,
  name,
}: {
  attrs: Record<string, string>;
  id: string;
  maps: Maps;
  name: string;
}) {
  const asset = maps.assets.get(id);
  if (!asset) {
    // Value may be a plain URL (legacy content) rather than an asset id.
    const src = id.startsWith('http') || id.startsWith('/') ? id : null;
    if (!src) return <p {...attrs} style={{ opacity: 0.4 }}>[{name}]</p>;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...attrs} src={src.startsWith('/') ? `${MEDIA_URL}${src}` : src} alt={name} style={{ maxWidth: '100%' }} />;
  }
  if (asset.mimeType.startsWith('image/')) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        {...attrs}
        src={`${MEDIA_URL}${asset.url}`}
        alt={asset.altText || asset.title || name}
        width={asset.width ?? undefined}
        height={asset.height ?? undefined}
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    );
  }
  if (asset.mimeType.startsWith('video/')) {
    return <video {...attrs} src={`${MEDIA_URL}${asset.url}`} controls style={{ maxWidth: '100%' }} />;
  }
  return (
    <p {...attrs}>
      <a href={`${MEDIA_URL}${asset.url}`}>{asset.title || asset.filename}</a>
    </p>
  );
}
