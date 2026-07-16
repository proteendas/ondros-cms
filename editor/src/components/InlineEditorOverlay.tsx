'use client';

/**
 * InlineEditorOverlay: attaches inline-editing behavior to a DOM tree that
 * contains [data-cms-field-id] elements.
 *
 * On hover  -> shows a floating ✎ badge over the hovered field element.
 * On click  -> reports the field selection (inspector).
 * On double-click -> makes the element contentEditable; committing (blur or
 *                    Cmd/Ctrl+Enter) calls onCommit with the new value.
 *
 * Where it runs:
 *  - SAME-ORIGIN preview iframe: pass iframeRef; this component reaches into
 *    iframe.contentDocument and wires everything from the editor side.
 *  - CROSS-ORIGIN preview (the docker-compose default: :3000 vs :3001): the
 *    browser blocks DOM access, so the equivalent logic ships inside the
 *    preview app (preview/src/components/InlineEditingBridge.tsx) and talks to
 *    the editor via postMessage. This component then simply stays idle.
 */
import { RefObject, useEffect } from 'react';

interface Props {
  iframeRef: RefObject<HTMLIFrameElement>;
  onFieldSelected: (entryId: string, fieldId: string) => void;
  onCommit: (entryId: string, fieldId: string, value: string) => void;
}

export default function InlineEditorOverlay({ iframeRef, onFieldSelected, onCommit }: Props) {
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cleanup: (() => void) | null = null;

    function attach() {
      let doc: Document | null = null;
      try {
        doc = iframe!.contentDocument; // throws / null when cross-origin
      } catch {
        return; // cross-origin: the preview's own bridge takes over
      }
      if (!doc?.body) return;

      // Floating edit badge that follows the hovered field.
      const badge = doc.createElement('div');
      badge.textContent = '✎';
      Object.assign(badge.style, {
        position: 'absolute',
        display: 'none',
        padding: '2px 6px',
        background: '#2952cc',
        color: '#fff',
        borderRadius: '4px',
        fontSize: '12px',
        zIndex: '99999',
        pointerEvents: 'none',
      });
      doc.body.appendChild(badge);

      const fieldOf = (target: EventTarget | null): HTMLElement | null =>
        target instanceof Element ? target.closest<HTMLElement>('[data-cms-field-id]') : null;

      const onMouseOver = (e: Event) => {
        const el = fieldOf(e.target);
        if (!el) {
          badge.style.display = 'none';
          return;
        }
        const rect = el.getBoundingClientRect();
        badge.style.display = 'block';
        badge.style.top = `${rect.top + doc!.documentElement.scrollTop - 10}px`;
        badge.style.left = `${rect.right + doc!.documentElement.scrollLeft - 20}px`;
        el.style.outline = '1px dashed #2952cc';
      };

      const onMouseOut = (e: Event) => {
        const el = fieldOf(e.target);
        if (el) el.style.outline = '';
      };

      const onClick = (e: Event) => {
        const el = fieldOf(e.target);
        if (!el || el.isContentEditable) return;
        e.preventDefault();
        const entryId = el.closest<HTMLElement>('[data-cms-entry-id]')?.dataset.cmsEntryId;
        if (entryId) onFieldSelected(entryId, el.dataset.cmsFieldId!);
      };

      const onDblClick = (e: Event) => {
        const el = fieldOf(e.target);
        if (!el) return;
        e.preventDefault();
        const entryId = el.closest<HTMLElement>('[data-cms-entry-id]')?.dataset.cmsEntryId;
        if (!entryId) return;

        el.contentEditable = 'true';
        el.focus();

        const commit = () => {
          el.contentEditable = 'false';
          const isRichText = el.dataset.cmsFieldType === 'richtext';
          onCommit(entryId, el.dataset.cmsFieldId!, isRichText ? el.innerHTML : el.textContent ?? '');
          el.removeEventListener('blur', commit);
        };
        el.addEventListener('blur', commit);
      };

      doc.addEventListener('mouseover', onMouseOver);
      doc.addEventListener('mouseout', onMouseOut);
      doc.addEventListener('click', onClick);
      doc.addEventListener('dblclick', onDblClick);

      cleanup = () => {
        doc!.removeEventListener('mouseover', onMouseOver);
        doc!.removeEventListener('mouseout', onMouseOut);
        doc!.removeEventListener('click', onClick);
        doc!.removeEventListener('dblclick', onDblClick);
        badge.remove();
      };
    }

    iframe.addEventListener('load', attach);
    attach(); // in case it already loaded

    return () => {
      iframe.removeEventListener('load', attach);
      cleanup?.();
    };
  }, [iframeRef, onFieldSelected, onCommit]);

  return null; // behavior-only component
}
