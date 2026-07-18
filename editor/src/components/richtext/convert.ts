/**
 * Conversion helpers between rich text values and plain text / HTML (spec 015).
 *
 * AI actions operate on text: we extract plain text from a stored doc for the
 * prompt, and convert the AI's returned HTML/text into a TipTap JSON document
 * (matching our node/mark set) before writing it back — never dropping raw
 * HTML into the field. `htmlToDoc` runs in the browser (uses DOMParser); the
 * AI sidebar is a client component.
 */
import type { JSONContent } from '@tiptap/core';

import { docToValue, valueToContent, type RichTextValue } from './config';

/** Plain text from a stored richtext value (JSON doc or legacy HTML string). */
export function richTextToText(value: RichTextValue): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    if (typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.innerHTML = value;
      return (el.textContent || '').trim();
    }
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const parts: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'text') parts.push(n.text ?? '');
    (n.content ?? []).forEach(walk);
    if (['paragraph', 'heading', 'blockquote', 'listItem', 'codeBlock'].includes(n.type ?? '')) {
      parts.push('\n');
    }
  };
  const content = valueToContent(value);
  if (typeof content !== 'string') walk(content);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

const MARK_FOR_TAG: Record<string, string> = {
  STRONG: 'bold', B: 'bold', EM: 'italic', I: 'italic',
  U: 'underline', S: 'strike', STRIKE: 'strike', DEL: 'strike', CODE: 'code',
};

function inlineFrom(node: ChildNode, marks: { type: string; attrs?: Record<string, unknown> }[]): JSONContent[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return text ? [{ type: 'text', text, ...(marks.length ? { marks } : {}) }] : [];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as HTMLElement;
  if (el.tagName === 'BR') return [{ type: 'hardBreak' }];
  const next = [...marks];
  const markType = MARK_FOR_TAG[el.tagName];
  if (markType && !next.some((m) => m.type === markType)) next.push({ type: markType });
  if (el.tagName === 'A') {
    const href = el.getAttribute('href');
    if (href) next.push({ type: 'link', attrs: { href } });
  }
  const color = el.style?.color;
  if (color && !next.some((m) => m.type === 'textStyle')) next.push({ type: 'textStyle', attrs: { color } });
  return Array.from(el.childNodes).flatMap((c) => inlineFrom(c, next));
}

function blockFrom(el: HTMLElement): JSONContent[] {
  const tag = el.tagName;
  const inline = () => Array.from(el.childNodes).flatMap((c) => inlineFrom(c, []));
  if (/^H[1-6]$/.test(tag)) {
    return [{ type: 'heading', attrs: { level: Number(tag[1]) }, content: inline() }];
  }
  if (tag === 'BLOCKQUOTE') return [{ type: 'blockquote', content: [{ type: 'paragraph', content: inline() }] }];
  if (tag === 'PRE') return [{ type: 'codeBlock', content: [{ type: 'text', text: el.textContent ?? '' }] }];
  if (tag === 'UL' || tag === 'OL') {
    const items = Array.from(el.children)
      .filter((c) => c.tagName === 'LI')
      .map((li) => ({ type: 'listItem', content: [{ type: 'paragraph', content: Array.from(li.childNodes).flatMap((c) => inlineFrom(c, [])) }] }));
    return [{ type: tag === 'UL' ? 'bulletList' : 'orderedList', content: items }];
  }
  if (tag === 'HR') return [{ type: 'horizontalRule' }];
  // Default: a paragraph of the element's inline content.
  const content = inline();
  return [{ type: 'paragraph', ...(content.length ? { content } : {}) }];
}

/** Convert AI HTML into a TipTap JSON doc using our node/mark set (browser). */
export function htmlToDoc(html: string): JSONContent {
  if (typeof document === 'undefined') return textToDoc(html.replace(/<[^>]*>/g, ''));
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const blocks: JSONContent[] = [];
  parsed.body.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.trim()) blocks.push({ type: 'paragraph', content: [{ type: 'text', text }] });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      blocks.push(...blockFrom(node as HTMLElement));
    }
  });
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
}

/** Plain text (double-newline = paragraph) into a doc. */
export function textToDoc(text: string): JSONContent {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    type: 'doc',
    content: paras.length
      ? paras.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }))
      : [{ type: 'paragraph' }],
  };
}

/** Coerce arbitrary AI output into a stored richtext value. */
export function aiOutputToRichText(output: string): RichTextValue {
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(output);
  return docToValue(looksHtml ? htmlToDoc(output) : textToDoc(output));
}
