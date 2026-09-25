'use client';

/**
 * InspectorMode: the editor-side half of "click an element in the preview to
 * jump to its field" (AEM Universal Editor-style).
 *
 * The previewed site stamps rendered elements with data-ondros-* attributes
 * (or the legacy data-cms-*) and its bridge script posts messages up to this
 * window when an element is clicked or inline-edited. This hook subscribes to
 * those messages. Cross-origin safe: only postMessage crosses the boundary.
 *
 * `allowedOrigin` MUST be the origin of whatever is actually in the iframe.
 * Since Code Sync that is the customer's own deployed site, which differs per
 * space — so LivePreviewPane resolves it and the entry editor passes it in.
 * Falling back to a build-time constant here would silently drop every
 * message from a connected site, which looks exactly like inline editing
 * being broken.
 */
import { useEffect } from 'react';

import { MSG } from '@/lib/protocol';

export interface InspectorHandlers {
  /** Preview element was clicked: focus the corresponding form field. */
  onFieldSelected?: (entryId: string, fieldId: string) => void;
  /** Inline edit was committed inside the preview: persist the new value. */
  onInlineEdit?: (entryId: string, fieldId: string, value: string, locale?: string) => void;
  /** Preview bridge finished booting (safe to send SET_INSPECTOR etc.). */
  onPreviewReady?: () => void;
  /**
   * Origin of the site in the preview iframe. `null` while it is still being
   * resolved — messages are ignored until then. Omit it entirely and the
   * bundled preview app's origin is assumed, which is only right for spaces
   * that have not connected a repository.
   */
  allowedOrigin?: string | null;
}

const BUNDLED_PREVIEW_ORIGIN = new URL(
  process.env.NEXT_PUBLIC_PREVIEW_URL ?? 'http://localhost:3001',
).origin;

export function useInspectorMessages(handlers: InspectorHandlers): void {
  const { onFieldSelected, onInlineEdit, onPreviewReady } = handlers;
  const allowedOrigin =
    handlers.allowedOrigin === undefined ? BUNDLED_PREVIEW_ORIGIN : handlers.allowedOrigin;

  useEffect(() => {
    if (!allowedOrigin) return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== allowedOrigin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case MSG.FIELD_SELECTED:
          onFieldSelected?.(data.entryId, data.fieldId);
          break;
        case MSG.INLINE_EDIT:
          onInlineEdit?.(data.entryId, data.fieldId, data.value, data.locale);
          break;
        case MSG.PREVIEW_READY:
          onPreviewReady?.();
          break;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // Handlers are expected to be stable (useCallback) or cheap to re-subscribe.
  }, [allowedOrigin, onFieldSelected, onInlineEdit, onPreviewReady]);
}
