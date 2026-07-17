/**
 * postMessage protocol between the editor (parent window) and the preview
 * iframe. The same constants exist in preview/src/lib/protocol.ts — keep the
 * two files identical (or extract to a shared package in a monorepo setup).
 *
 * Editor <- Preview:
 *   FIELD_SELECTED  { entryId, fieldId }                 inspector click in preview
 *   INLINE_EDIT     { entryId, fieldId, value, locale }  contentEditable commit in preview
 *   PREVIEW_READY   { entryId }                          bridge booted
 *
 * Editor -> Preview:
 *   FIELD_UPDATED   { entryId, fieldId, value }          optimistic DOM patch after save
 *   SET_INSPECTOR   { enabled }                          toggle inspector outlines
 */

export const MSG = {
  FIELD_SELECTED: 'cms:field-selected',
  INLINE_EDIT: 'cms:inline-edit',
  PREVIEW_READY: 'cms:preview-ready',
  FIELD_UPDATED: 'cms:field-updated',
  SET_INSPECTOR: 'cms:set-inspector',
} as const;

export interface FieldSelectedMessage {
  type: typeof MSG.FIELD_SELECTED;
  entryId: string;
  fieldId: string;
}

export interface InlineEditMessage {
  type: typeof MSG.INLINE_EDIT;
  entryId: string;
  fieldId: string;
  value: string;
  /** Locale the preview was rendering when the edit was made. */
  locale?: string;
}

export interface FieldUpdatedMessage {
  type: typeof MSG.FIELD_UPDATED;
  entryId: string;
  fieldId: string;
  value: unknown;
}

export type PreviewToEditorMessage =
  | FieldSelectedMessage
  | InlineEditMessage
  | { type: typeof MSG.PREVIEW_READY; entryId: string };
