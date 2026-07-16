'use client';

/**
 * Subscribes to /ws/entries/{entryId} for live updates.
 * The editor uses this to track version/status changes (e.g. a save made by
 * inline editing in the preview, or another editor tab). It deliberately does
 * NOT merge remote field values into the form while the user is typing —
 * proper multi-user merging needs OT/CRDT; see the README.
 */
import { useEffect, useRef } from 'react';

import { API_URL, getToken } from './api';

export interface EntrySocketMessage {
  type: string;
  entryId?: string;
  version?: number;
  status?: string;
  fields?: Record<string, unknown>;
  changed?: string[];
  [key: string]: unknown;
}

export function useEntrySocket(
  entryId: string | null,
  onMessage: (msg: EntrySocketMessage) => void,
): void {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!entryId) return;

    const wsBase = API_URL.replace(/^http/, 'ws');
    const token = getToken();
    const url = `${wsBase}/ws/entries/${entryId}${token ? `?token=${token}` : ''}`;

    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket(url);
      ws.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (!closed) retryTimer = setTimeout(connect, 2000); // simple auto-reconnect
      };
    };
    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [entryId]);
}
