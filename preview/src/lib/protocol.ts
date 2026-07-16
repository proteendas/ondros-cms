/**
 * postMessage protocol with the editor app. MUST stay identical to
 * editor/src/lib/protocol.ts (extract into a shared package if you monorepo).
 */
export const MSG = {
  FIELD_SELECTED: 'cms:field-selected',
  INLINE_EDIT: 'cms:inline-edit',
  PREVIEW_READY: 'cms:preview-ready',
  FIELD_UPDATED: 'cms:field-updated',
  SET_INSPECTOR: 'cms:set-inspector',
} as const;
