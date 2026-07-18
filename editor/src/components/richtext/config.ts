/**
 * Rich text config, schema-version wrapping, and value<->doc conversion
 * (spec 015). Mirrors backend app/core/richtext.py.
 */
import type { JSONContent } from '@tiptap/core';

export const RICH_TEXT_SCHEMA_VERSION = 1;

export interface RichTextConfig {
  allowed_marks?: string[] | null;
  allowed_nodes?: string[] | null;
  allowed_embed_types?: string[];
  allow_color?: boolean;
  allow_highlight?: boolean;
  allow_tables?: boolean;
  allow_links?: boolean;
}

export const DEFAULT_RICH_TEXT_CONFIG: Required<RichTextConfig> = {
  allowed_marks: null,
  allowed_nodes: null,
  allowed_embed_types: [],
  allow_color: true,
  allow_highlight: true,
  allow_tables: true,
  allow_links: true,
};

/** Toggleable marks/nodes an admin can restrict (structural ones are implicit). */
export const CONFIGURABLE_MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const;
export const CONFIGURABLE_NODES = [
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
] as const;

/** Curated brand-safe swatches for the color/highlight popovers. */
export const TEXT_SWATCHES = [
  '#101828', '#475467', '#4f46e5', '#7c3aed',
  '#0e7490', '#067647', '#b54708', '#c01048',
  '#dc6803', '#e31b54',
];
export const HIGHLIGHT_SWATCHES = [
  '#fef3c7', '#fee4e2', '#e0f2fe', '#dcfce7',
  '#f3e8ff', '#fce7f3', '#e0e7ff', '#fef9c3',
];

export function withConfigDefaults(config?: RichTextConfig | null): Required<RichTextConfig> {
  return { ...DEFAULT_RICH_TEXT_CONFIG, ...(config ?? {}) };
}

export function markAllowed(cfg: Required<RichTextConfig>, name: string): boolean {
  if (name === 'textStyle') return cfg.allow_color;
  if (name === 'highlight') return cfg.allow_highlight;
  if (name === 'link' || name === 'linkedEntry' || name === 'linkedAsset') return cfg.allow_links;
  if (cfg.allowed_marks == null) return true;
  return cfg.allowed_marks.includes(name);
}

export function nodeAllowed(cfg: Required<RichTextConfig>, name: string): boolean {
  if (['table', 'tableRow', 'tableCell', 'tableHeader'].includes(name)) return cfg.allow_tables;
  if (cfg.allowed_nodes == null) return true;
  return cfg.allowed_nodes.includes(name);
}

/** A stored value is either legacy HTML (string) or a versioned JSON doc. */
export type RichTextValue = string | (JSONContent & { richTextSchemaVersion?: number }) | null | undefined;

/** Editor content input: pass the HTML string through, or the bare doc. */
export function valueToContent(value: RichTextValue): string | JSONContent {
  if (value == null || value === '') return { type: 'doc', content: [{ type: 'paragraph' }] };
  if (typeof value === 'string') return value; // legacy HTML — TipTap parses it
  if (typeof value === 'object' && value.type === 'doc') {
    const { richTextSchemaVersion: _v, ...doc } = value;
    return doc as JSONContent;
  }
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** Wrap the editor's JSON with the schema version for storage. */
export function docToValue(doc: JSONContent): RichTextValue {
  return { richTextSchemaVersion: RICH_TEXT_SCHEMA_VERSION, ...doc };
}

/** True when a value carries no text and no embeds (used to skip no-op saves). */
export function isEmptyDoc(value: RichTextValue): boolean {
  if (value == null || value === '') return true;
  if (typeof value === 'string') return value.replace(/<[^>]*>/g, '').trim() === '';
  const content = (value as JSONContent).content ?? [];
  const walk = (n: JSONContent): boolean => {
    if (n.type === 'text' && (n.text ?? '').trim()) return true;
    if (['embeddedEntryBlock', 'embeddedEntryInline', 'embeddedAssetBlock'].includes(n.type ?? '')) return true;
    return (n.content ?? []).some(walk);
  };
  return !content.some(walk);
}
