'use client';

/**
 * Bridge between embedded-node NodeViews and the RichTextField that owns the
 * pickers (spec 015). NodeViews render inside the editor's React tree (via
 * ReactNodeViewRenderer), so this context reaches them. It lets a preview card
 * open the entry/asset picker to swap its target, and exposes the paths/types
 * the card needs to fetch + label its target.
 */
import { createContext, useContext } from 'react';

import type { ContentType } from '@/lib/types';

export interface EmbedBridge {
  apiUrl: string;
  envPath: string;
  spacePath: string;
  types: ContentType[];
  defaultLocale: string;
  /** Open the entry picker; `apply` receives the chosen entry id. */
  requestEntry: (apply: (id: string) => void) => void;
  /** Open the media picker; `apply` receives the chosen asset id. */
  requestAsset: (apply: (id: string) => void) => void;
}

const EmbedContext = createContext<EmbedBridge | null>(null);

export const EmbedProvider = EmbedContext.Provider;

export function useEmbedBridge(): EmbedBridge | null {
  return useContext(EmbedContext);
}
