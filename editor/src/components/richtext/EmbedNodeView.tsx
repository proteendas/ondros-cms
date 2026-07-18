'use client';

/**
 * NodeView for embedded entries/assets (spec 015). Renders a live preview:
 *  - embeddedEntryBlock  → card with the entry's title + type + actions
 *  - embeddedEntryInline → compact pill
 *  - embeddedAssetBlock  → thumbnail / file chip
 * Actions: Change (reopen the picker), Open (new tab), Remove.
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';

import Icon from '@/components/ui/Icon';
import { api } from '@/lib/api';
import type { Entry, MediaAsset, ContentType } from '@/lib/types';

import { useEmbedBridge } from './EmbedContext';

function entryTitle(entry: Entry, ct: ContentType | undefined, defaultLocale: string): string {
  const displayId = ct?.display_field || ct?.fields.find((f) => ['text', 'slug'].includes(f.type))?.id;
  const fd = ct?.fields.find((f) => f.id === displayId);
  const raw = fd ? entry.fields?.[fd.id] : undefined;
  const v =
    fd?.localized && raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)[defaultLocale]
      : raw;
  return typeof v === 'string' && v.trim() ? v : entry.slug;
}

export default function EmbedNodeView({ node, deleteNode, updateAttributes }: NodeViewProps) {
  const bridge = useEmbedBridge();
  const kind = node.type.name as 'embeddedEntryBlock' | 'embeddedEntryInline' | 'embeddedAssetBlock';
  const isAsset = kind === 'embeddedAssetBlock';
  const isInline = kind === 'embeddedEntryInline';
  const id = node.attrs.id as string | null;

  const [entry, setEntry] = useState<Entry | null>(null);
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!id) return;
    setMissing(false);
    if (isAsset) {
      api<MediaAsset>(`/media/${id}`).then((a) => alive && setAsset(a)).catch(() => alive && setMissing(true));
    } else {
      api<Entry>(`/entries/${id}`).then((e) => alive && setEntry(e)).catch(() => alive && setMissing(true));
    }
    return () => {
      alive = false;
    };
  }, [id, isAsset]);

  const ct = entry && bridge ? bridge.types.find((t) => t.id === entry.content_type_id) : undefined;
  const label = isAsset
    ? asset?.title || asset?.filename || (missing ? 'Missing asset' : id?.slice(0, 8))
    : entry
      ? entryTitle(entry, ct, bridge?.defaultLocale ?? 'en-US')
      : missing
        ? 'Missing entry'
        : id?.slice(0, 8);

  function change() {
    if (!bridge) return;
    const apply = (newId: string) => updateAttributes({ id: newId });
    if (isAsset) bridge.requestAsset(apply);
    else bridge.requestEntry(apply);
  }

  const actions = (
    <span className="embed-actions" contentEditable={false}>
      <button type="button" className="icon-btn" title="Change" onMouseDown={(e) => { e.preventDefault(); change(); }}>
        <Icon name="edit" size={12} />
      </button>
      {id && (
        <a
          className="icon-btn"
          href={isAsset ? undefined : `/entries/${id}`}
          target="_blank"
          rel="noreferrer"
          title="Open in new tab"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Icon name="open-external" size={12} />
        </a>
      )}
      <button type="button" className="icon-btn" title="Remove" onMouseDown={(e) => { e.preventDefault(); deleteNode(); }}>
        <Icon name="close" size={12} />
      </button>
    </span>
  );

  if (isInline) {
    return (
      <NodeViewWrapper as="span" className={`embed-inline${missing ? ' missing' : ''}`}>
        <Icon name="content" size={11} />
        <span className="embed-inline-label">{label}</span>
        {actions}
      </NodeViewWrapper>
    );
  }

  const apiUrl = bridge?.apiUrl ?? '';
  return (
    <NodeViewWrapper className={`embed-block${missing ? ' missing' : ''}`} data-drag-handle>
      <div className="embed-block-icon">
        {isAsset && asset?.mime_type?.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${apiUrl}${asset.url}`} alt={asset.alt_text || asset.filename} />
        ) : (
          <Icon name={isAsset ? 'media' : 'content'} size={22} />
        )}
      </div>
      <div className="embed-block-body">
        <div className="embed-block-title">{label}</div>
        <div className="embed-block-meta muted small">
          {isAsset ? asset?.mime_type ?? 'asset' : ct?.name ?? (entry ? 'entry' : 'reference')}
        </div>
      </div>
      {actions}
    </NodeViewWrapper>
  );
}
