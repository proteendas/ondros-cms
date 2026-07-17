'use client';

/**
 * InlineEditingBridge — the preview-side half of the visual editing system
 * (the counterpart of the editor's InspectorMode / InlineEditorOverlay).
 * Rendered only in draft mode.
 *
 * Responsibilities:
 *  1. Inspector: hover outlines + a floating "field id" tag on
 *     [data-cms-field-id] elements; click posts FIELD_SELECTED
 *     {entryId, fieldId} to the parent editor window (cross-origin safe via
 *     postMessage). The entry id comes from the *closest* [data-cms-entry-id]
 *     ancestor, so nested assembly blocks report their own entry.
 *  2. Inline editing: double-click makes the element contentEditable; on blur
 *     the new value is posted as INLINE_EDIT (with the preview's locale). The
 *     EDITOR persists it via the REST API — the preview never holds auth
 *     credentials.
 *  3. Live refresh: subscribes to the backend WS (/ws/entries/{id}) and calls
 *     router.refresh() when the entry changes, re-fetching draft content.
 *  4. Instant patches: applies FIELD_UPDATED messages from the editor directly
 *     to the DOM (scoped to the right entry block), so typing in the form
 *     reflects here with zero refetch lag.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { MSG } from '@/lib/protocol';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export default function InlineEditingBridge({
  entryId,
  locale,
}: {
  entryId: string;
  locale?: string;
}) {
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

    /** Entry the element belongs to: nearest [data-cms-entry-id] ancestor
     * (nested assembly blocks stamp their own id). */
    const entryOf = (el: HTMLElement): string =>
      el.closest<HTMLElement>('[data-cms-entry-id]')?.dataset.cmsEntryId ?? entryId;

    const post = (payload: Record<string, unknown>) => {
      // '*' keeps local dev simple (editor origin varies); pin the editor
      // origin here for production deployments.
      if (isEmbedded) window.parent.postMessage(payload, '*');
    };

    // Floating tag that shows the hovered field's id (inspector affordance).
    const tag = document.createElement('div');
    tag.className = 'cms-field-tag';
    tag.style.display = 'none';
    document.body.appendChild(tag);

    const onMouseOver = (e: Event) => {
      if (!inspectorEnabled.current) return;
      const el = fieldOf(e.target);
      if (!el) return;
      el.classList.add('cms-hover');
      const rect = el.getBoundingClientRect();
      tag.textContent = `✏️ ${el.dataset.cmsFieldId}`;
      tag.style.display = 'block';
      tag.style.top = `${Math.max(2, rect.top + window.scrollY - 22)}px`;
      tag.style.left = `${rect.left + window.scrollX}px`;
    };
    const onMouseOut = (e: Event) => {
      fieldOf(e.target)?.classList.remove('cms-hover');
      tag.style.display = 'none';
    };

    const onClick = (e: Event) => {
      if (!inspectorEnabled.current) return;
      const el = fieldOf(e.target);
      if (!el || el.isContentEditable) return;
      // Keep links from navigating while inspecting.
      e.preventDefault();
      post({ type: MSG.FIELD_SELECTED, entryId: entryOf(el), fieldId: el.dataset.cmsFieldId });
    };

    const onDblClick = (e: Event) => {
      const el = fieldOf(e.target);
      if (!el || el.isContentEditable) return;
      // Only text-ish fields are inline-editable; structured widgets
      // (references, media, json) are edited in the form.
      const type = el.dataset.cmsFieldType ?? 'text';
      if (!['text', 'longtext', 'richtext', 'slug', 'select', 'number'].includes(type)) return;
      e.preventDefault();
      editing.current = true;
      tag.style.display = 'none';
      el.contentEditable = 'true';
      el.classList.remove('cms-hover');
      el.focus();

      const commit = () => {
        el.contentEditable = 'false';
        el.removeEventListener('blur', commit);
        editing.current = false;
        const isRichText = type === 'richtext';
        post({
          type: MSG.INLINE_EDIT,
          entryId: entryOf(el),
          fieldId: el.dataset.cmsFieldId,
          value: isRichText ? el.innerHTML : (el.textContent ?? ''),
          locale,
        });
      };
      el.addEventListener('blur', commit);

      el.addEventListener(
        'keydown',
        (ke: KeyboardEvent) => {
          if (ke.key === 'Escape') el.blur();
          // Enter commits single-line (non-richtext) fields.
          if (ke.key === 'Enter' && type !== 'richtext') {
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
      if (data.type === MSG.FIELD_UPDATED) {
        // Scope the patch to the entry block the update belongs to.
        const scope =
          document.querySelector<HTMLElement>(`[data-cms-entry-id="${data.entryId}"]`) ?? document;
        const el = scope.querySelector<HTMLElement>(`[data-cms-field-id="${data.fieldId}"]`);
        if (el && !el.isContentEditable) {
          const value = data.value;
          // Localized fields send {locale: value} maps — pick the preview's locale.
          const resolved =
            value && typeof value === 'object' && !Array.isArray(value)
              ? ((value as Record<string, unknown>)[locale ?? ''] ?? Object.values(value)[0])
              : value;
          if (typeof resolved === 'string' || typeof resolved === 'number') {
            if (el.dataset.cmsFieldType === 'richtext') el.innerHTML = String(resolved ?? '');
            else el.textContent = String(resolved ?? '');
          }
        }
      }
      if (data.type === MSG.SET_INSPECTOR) {
        inspectorEnabled.current = !!data.enabled;
        if (!data.enabled) tag.style.display = 'none';
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
      tag.remove();
    };
  }, [entryId, locale]);

  return null;
}
