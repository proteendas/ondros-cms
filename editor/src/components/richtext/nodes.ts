/**
 * Custom TipTap nodes & marks for embedded/linked Ondros entries and assets
 * (spec 015). These mirror the backend catalogue in app/core/richtext.py:
 *
 *   embeddedEntryBlock   standalone block card referencing an entry
 *   embeddedEntryInline  inline pill referencing an entry
 *   embeddedAssetBlock   media block referencing an asset
 *   linkedEntry / linkedAsset  reference-only link marks (resolve to a URL)
 *
 * Embed nodes are atoms carrying a single `id` attr and render via a React
 * NodeView (EmbedNodeView) so editors see a live preview card/pill. The link
 * marks render as <a data-linked-*-id> so downstream renderers can resolve
 * them.
 */
import { Mark, Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

import EmbedNodeView from './EmbedNodeView';

const idAttr = {
  id: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-id'),
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.id ? { 'data-id': attrs.id as string } : {},
  },
};

export const EmbeddedEntryBlock = Node.create({
  name: 'embeddedEntryBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes: () => ({ ...idAttr }),
  parseHTML: () => [{ tag: 'div[data-embedded-entry-block]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-embedded-entry-block': '' }),
  ],
  addNodeView: () => ReactNodeViewRenderer(EmbedNodeView),
});

export const EmbeddedEntryInline = Node.create({
  name: 'embeddedEntryInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ ...idAttr }),
  parseHTML: () => [{ tag: 'span[data-embedded-entry-inline]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, { 'data-embedded-entry-inline': '' }),
  ],
  addNodeView: () => ReactNodeViewRenderer(EmbedNodeView, { as: 'span' }),
});

export const EmbeddedAssetBlock = Node.create({
  name: 'embeddedAssetBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes: () => ({ ...idAttr }),
  parseHTML: () => [{ tag: 'div[data-embedded-asset-block]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-embedded-asset-block': '' }),
  ],
  addNodeView: () => ReactNodeViewRenderer(EmbedNodeView),
});

/** Reference-only link marks — visually a link, resolve to an entry/asset URL. */
function linkedMark(name: string, dataAttr: string) {
  return Mark.create({
    name,
    inclusive: false,
    addAttributes: () => ({
      id: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute(dataAttr),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.id ? { [dataAttr]: attrs.id as string } : {},
      },
    }),
    parseHTML: () => [{ tag: `a[${dataAttr}]` }],
    renderHTML: ({ HTMLAttributes }) => [
      'a',
      mergeAttributes(HTMLAttributes, { class: `cms-linked cms-${name}`, href: '#' }),
      0,
    ],
  });
}

export const LinkedEntry = linkedMark('linkedEntry', 'data-linked-entry-id');
export const LinkedAsset = linkedMark('linkedAsset', 'data-linked-asset-id');
