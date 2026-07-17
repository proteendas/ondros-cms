'use client';

/**
 * Embeds the preview app in an iframe, pointed at its /api/preview route so
 * Next.js draft mode is enabled and the DRAFT version of the entry renders.
 *
 * The preview app authenticates against the CMS with a *preview API key*
 * (NEXT_PUBLIC_PREVIEW_TOKEN — the seeded dev key by default) scoped to the
 * current space + environment. Locale is forwarded so localized fields render
 * the same locale the editor has active.
 *
 * Live sync works through two channels:
 *  1. WebSocket: the backend broadcasts entry.updated after every save; the
 *     preview's InlineEditingBridge listens and refreshes its data.
 *  2. postMessage (parent -> iframe): after a local save the editor also sends
 *     FIELD_UPDATED so the bridge can patch the DOM instantly (no refetch wait).
 */
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

import { MSG } from '@/lib/protocol';
import type { ContentType, Entry } from '@/lib/types';

import InlineEditorOverlay from './InlineEditorOverlay';

const PREVIEW_URL = process.env.NEXT_PUBLIC_PREVIEW_URL ?? 'http://localhost:3001';
// Dev-only: preview API key baked into the editor bundle (the seed's key by
// default). For production, mint short-lived preview keys per editor session.
const PREVIEW_TOKEN =
  process.env.NEXT_PUBLIC_PREVIEW_TOKEN ?? 'cms_pre_dev-preview-token-0000';

export interface LivePreviewHandle {
  /** Push an optimistic field update into the preview iframe. */
  notifyFieldUpdated: (entryId: string, fieldId: string, value: unknown) => void;
  reload: () => void;
}

interface Props {
  entry: Entry;
  contentType: ContentType;
  spaceId: string;
  environmentKey: string;
  locale: string;
  onFieldSelected: (entryId: string, fieldId: string) => void;
  onInlineCommit: (entryId: string, fieldId: string, value: string, locale?: string) => void;
}

const LivePreviewPane = forwardRef<LivePreviewHandle, Props>(function LivePreviewPane(
  { entry, contentType, spaceId, environmentKey, locale, onFieldSelected, onInlineCommit },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [inspector, setInspector] = useState(true);
  const [nonce, setNonce] = useState(0);

  const params = new URLSearchParams({
    token: PREVIEW_TOKEN,
    space: spaceId,
    environment: environmentKey,
    type: contentType.api_id,
    slug: entry.slug,
    locale,
  });
  const src = `${PREVIEW_URL}/api/preview?${params}`;

  useImperativeHandle(ref, () => ({
    notifyFieldUpdated(entryId, fieldId, value) {
      iframeRef.current?.contentWindow?.postMessage(
        { type: MSG.FIELD_UPDATED, entryId, fieldId, value },
        PREVIEW_URL,
      );
    },
    reload() {
      setNonce((n) => n + 1);
    },
  }));

  function toggleInspector() {
    const next = !inspector;
    setInspector(next);
    iframeRef.current?.contentWindow?.postMessage(
      { type: MSG.SET_INSPECTOR, enabled: next },
      PREVIEW_URL,
    );
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <strong>Live preview</strong>
        <span className="muted small">
          {environmentKey} · {locale} · draft
        </span>
        <span className="spacer" />
        <button className="btn secondary small" onClick={toggleInspector}>
          {inspector ? '◉ Inspector on' : '○ Inspector off'}
        </button>
        <button className="btn secondary small" onClick={() => setNonce((n) => n + 1)}>
          ⟳ Reload
        </button>
        <a className="btn secondary small" href={src} target="_blank" rel="noreferrer">
          Open ↗
        </a>
      </div>
      <iframe
        key={nonce}
        ref={iframeRef}
        className="preview-frame"
        src={src}
        title="Live preview"
      />
      {/* Same-origin fallback wiring; idle when the iframe is cross-origin
          (then preview's InlineEditingBridge + postMessage handle it). */}
      <InlineEditorOverlay
        iframeRef={iframeRef}
        onFieldSelected={onFieldSelected}
        onCommit={onInlineCommit}
      />
    </div>
  );
});

export default LivePreviewPane;
