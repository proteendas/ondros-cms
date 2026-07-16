'use client';

/**
 * InlineEditingBridge — the preview-side half of the visual editing system
 * (the counterpart of the editor's InspectorMode / InlineEditorOverlay).
 * Rendered only in draft mode.
 *
 * Responsibilities:
 *  1. Inspector: hover outlines on [data-cms-field-id]; click posts
 *     FIELD_SELECTED {entryId, fieldId} to the parent editor window so it can
 *     focus the matching form field (works cross-origin via postMessage).
 *  2. Inline editing: double-click makes the element contentEditable; on blur
 *     the new value is posted as INLINE_EDIT. The EDITOR persists it via the
 *     REST API — the preview never holds auth credentials.
 *  3. Live refresh: subscribes to the backend WS (/ws/entries/{id}) and calls
 *     router.refresh() when the entry changes, re-fetching draft content.
 *  4. Instant patches: applies FIELD_UPDATED messages from the editor directly
 *     to the DOM, so typing in the form reflects here with zero refetch lag.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { MSG } from '@/lib/protocol';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export default function InlineEditingBridge({ entryId }: { entryId: string }) {
  const router = useRouter();
  const inspectorEnabled = useRef(true);
  // Suppress WS-triggered refreshes while the user is mid-inline-edit.
  const editing = useRef(false);

  // ---- 3. WebSocket refresh ------------------------------------------------
  useEffect(() => {
    const wsUrl = `${API_URL.replace(/^http/, 'ws')}/ws/entries/${entryId}`;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if ((msg.type === 'entry.updated' || msg.type === 'entry.transitioned') && !editing.current) {
            router.refresh();
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [entryId, router]);

  // ---- 1 + 2 + 4: DOM interaction & parent messages -------------------------
  useEffect(() => {
    const isEmbedded = window.parent !== window;

    const fieldOf = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>('[data-cms-field-id]') : null;

    const post = (payload: Record<string, unknown>) => {
      // '*' keeps local dev simple (editor origin varies); pin the editor
      // origin here for production deployments.
      if (isEmbedded) window.parent.postMessage(payload, '*');
    };

    const onMouseOver = (e: Event) => {
      if (!inspectorEnabled.current) return;
      fieldOf(e.target)?.classList.add('cms-hover');
    };
    const onMouseOut = (e: Event) => {
      fieldOf(e.target)?.classList.remove('cms-hover');
    };

    const onClick = (e: Event) => {
      if (!inspectorEnabled.current) return;
      const el = fieldOf(e.target);
      if (!el || el.isContentEditable) return;
      // Keep links from navigating while inspecting.
      e.preventDefault();
      post({ type: MSG.FIELD_SELECTED, entryId, fieldId: el.dataset.cmsFieldId });
    };

    const onDblClick = (e: Event) => {
      const el = fieldOf(e.target);
      if (!el || el.isContentEditable) return;
      e.preventDefault();
      editing.current = true;
      el.contentEditable = 'true';
      el.focus();

      const commit = () => {
        el.contentEditable = 'false';
        el.removeEventListener('blur', commit);
        editing.current = false;
        const isRichText = el.dataset.cmsFieldType === 'richtext';
        post({
          type: MSG.INLINE_EDIT,
          entryId,
          fieldId: el.dataset.cmsFieldId,
          value: isRichText ? el.innerHTML : (el.textContent ?? ''),
        });
      };
      el.addEventListener('blur', commit);

      el.addEventListener(
        'keydown',
        (ke: KeyboardEvent) => {
          if (ke.key === 'Escape') el.blur();
          // Enter commits single-line (non-richtext) fields.
          if (ke.key === 'Enter' && el.dataset.cmsFieldType !== 'richtext') {
            ke.preventDefault();
            el.blur();
          }
        },
        { once: false },
      );
    };

    // Messages from the editor (FIELD_UPDATED / SET_INSPECTOR).
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === MSG.FIELD_UPDATED && data.entryId === entryId) {
        const el = document.querySelector<HTMLElement>(`[data-cms-field-id="${data.fieldId}"]`);
        if (el && !el.isContentEditable) {
          if (el.dataset.cmsFieldType === 'richtext') el.innerHTML = String(data.value ?? '');
          else el.textContent = String(data.value ?? '');
        }
      }
      if (data.type === MSG.SET_INSPECTOR) {
        inspectorEnabled.current = !!data.enabled;
      }
    };

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('click', onClick);
    document.addEventListener('dblclick', onDblClick);
    window.addEventListener('message', onMessage);

    post({ type: MSG.PREVIEW_READY, entryId });

    return () => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('click', onClick);
      document.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('message', onMessage);
    };
  }, [entryId]);

  return null;
}
