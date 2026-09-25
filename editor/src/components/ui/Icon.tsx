'use client';

/**
 * Central icon wrapper (spec 008). ALL app iconography goes through this
 * semantic-name → Bootstrap Icons map, so swapping the icon set (or a single
 * glyph) is a one-file change.
 *
 * Icons are the Bootstrap Icons **webfont**: this renders `<i class="bi bi-…">`
 * and the stylesheet is imported once in `app/layout.tsx`. Because they are
 * font glyphs they inherit `currentColor` and `font-size`, so design-token
 * colors apply automatically.
 *
 * Usage: <Icon name="webhook" />  ·  <Icon name="delete" size={14} />
 *
 * Never write `<i className="bi bi-…">` at a call site and never inline an
 * SVG — add a semantic name here instead (see CLAUDE.md).
 */
import type { CSSProperties } from 'react';

/** Semantic name → Bootstrap Icons class suffix (`bi-<value>`). */
export const ICONS = {
  // Navigation / resources
  'content-model': 'boxes',
  content: 'file-earmark-text',
  media: 'images',
  guidelines: 'book-half',
  locale: 'globe2',
  'api-key': 'key',
  environment: 'diagram-3',
  webhook: 'broadcast',
  users: 'people',
  security: 'shield-lock',
  billing: 'credit-card',
  audit: 'journal-text',
  // Actions
  edit: 'pencil-square',
  'edit-inline': 'pencil',
  delete: 'trash',
  add: 'plus-lg',
  close: 'x',
  check: 'check2',
  publish: 'check-circle',
  history: 'clock-history',
  restore: 'arrow-clockwise',
  reload: 'arrow-clockwise',
  'open-external': 'box-arrow-up-right',
  upload: 'upload',
  search: 'search',
  drag: 'grip-vertical',
  'move-up': 'arrow-up',
  'move-down': 'arrow-down',
  back: 'arrow-left',
  forward: 'arrow-right',
  'generate-slug': 'magic',
  'inspector-on': 'eye',
  'inspector-off': 'eye-slash',
  // AI
  generate: 'stars',
  'suggest-titles': 'lightbulb',
  seo: 'search',
  translate: 'translate',
  compliance: 'check-circle',
  // Field types (FIELD_TYPE_INFO)
  'field-text': 'fonts',
  'field-longtext': 'text-paragraph',
  'field-richtext': 'justify-left',
  'field-number': 'hash',
  'field-boolean': 'toggle-on',
  'field-datetime': 'calendar3',
  'field-select': 'list-ul',
  'field-media': 'image',
  'field-media-many': 'images',
  'field-reference': 'link-45deg',
  link: 'link',
  palette: 'palette',
  highlighter: 'highlighter',
  table: 'table',
  'field-reference-many': 'link',
  'field-group': 'collection',
  'field-json': 'braces',
  'field-slug': 'slash',
  // Media kinds
  'media-image': 'image',
  'media-video': 'camera-video',
  'media-pdf': 'file-earmark-pdf',
  'media-file': 'paperclip',
  // Misc / status
  menu: 'list',
  'sign-out': 'box-arrow-right',
  help: 'question-circle',
  'chevron-down': 'chevron-down',
  star: 'star-fill',
  warning: 'exclamation-triangle',
  lock: 'lock',
  email: 'envelope',
  github: 'github',
  google: 'google',
  microsoft: 'microsoft',
  // Content-type card cycle
  'type-0': 'boxes',
  'type-1': 'file-earmark-text',
  'type-2': 'bricks',
  'type-3': 'card-heading',
  'type-4': 'newspaper',
  'type-5': 'bullseye',
  'type-6': 'folder2-open',
} as const;

export type IconName = keyof typeof ICONS;

export default function Icon({
  name,
  size = 16,
  className,
  style,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <i
      className={`bi bi-${ICONS[name]}${className ? ` ${className}` : ''}`}
      // Font glyphs size by font-size; the flex/line-height pair keeps them
      // optically centred next to text at any size.
      style={{ fontSize: size, lineHeight: 1, flexShrink: 0, ...style }}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
