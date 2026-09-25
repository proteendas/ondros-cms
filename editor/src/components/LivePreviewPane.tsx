'use client';

/**
 * Live preview — the project's own site, not a generic rendering.
 *
 * Like Adobe's Universal Editor, this pane does not render content itself. It
 * loads the deployed site of the GitHub repository connected to this space
 * (Settings -> Code Sync) and edits it in place, so what an author sees is
 * exactly what that project ships:
 *
 *   page-wise       an entry whose type models a slug is its own page, so the
 *                   iframe opens that page's real URL
 *   component-wise  a block (hero, card…) has no page of its own, so the
 *                   backend finds a page that references it and the bridge
 *                   scrolls to and outlines that component
 *
 * The site becomes editable by including the bridge script
 * (`/code-sync/ondros-editor.js`) and marking elements with `data-ondros-*`.
 * The bridge speaks the same postMessage protocol as before, so inline edits
 * and instant field patches keep working:
 *
 *   1. WebSocket: the backend broadcasts entry.updated after every save.
 *   2. postMessage (parent -> iframe): FIELD_UPDATED patches the DOM instantly.
 *
 * Without a connected repository there is nothing to render, so the pane says
 * so and offers to connect rather than showing a broken frame.
 */
import Link from 'next/link';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import Icon from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { MSG } from '@/lib/protocol';
import type { CodeSyncState, ContentType, Entry, PreviewTarget } from '@/lib/types';

import InlineEditorOverlay from './InlineEditorOverlay';

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
  /**
   * Origin of the site now in the iframe. The entry editor needs it to accept
   * postMessages from it — with Code Sync that origin belongs to the customer,
   * so it cannot be known at build time.
   */
  onPreviewOriginChange?: (origin: string | null) => void;
}

const LivePreviewPane = forwardRef<LivePreviewHandle, Props>(function LivePreviewPane(
  {
    entry,
    spaceId,
    environmentKey,
    locale,
    onFieldSelected,
    onInlineCommit,
    onPreviewOriginChange,
  },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [inspector, setInspector] = useState(true);
  const [nonce, setNonce] = useState(0);

  const [codeSync, setCodeSync] = useState<CodeSyncState | null>(null);
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The bridge reports how many instrumented elements it found. Zero on a page
  // that otherwise loaded is the tell-tale of a site missing data-ondros-*
  // markup, and it's worth saying out loud rather than leaving authors puzzled.
  const [instrumented, setInstrumented] = useState<number | null>(null);

  // ---- is this space connected to a repository? ---------------------------
  useEffect(() => {
    if (!spaceId) return;
    api<CodeSyncState>(`/spaces/${spaceId}/code-sync`)
      .then(setCodeSync)
      .catch(() =>
        setCodeSync({
          connected: false,
          configured: false,
          mode: 'none',
          install_url: '',
          app_slug: '',
          connection: null,
        }),
      );
  }, [spaceId]);

  // ---- which URL on that site shows this entry? ---------------------------
  const resolveTarget = useCallback(() => {
    if (!spaceId || !environmentKey || !codeSync?.connected) return;
    setError(null);
    api<PreviewTarget>(
      `/spaces/${spaceId}/environments/${encodeURIComponent(environmentKey)}` +
        `/code-sync/preview-target?entry_id=${entry.id}`,
    )
      .then(setTarget)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not resolve a preview URL'));
    // entry.slug matters: filling in a slug turns an unroutable draft into a page.
  }, [spaceId, environmentKey, entry.id, entry.slug, codeSync?.connected]);

  useEffect(resolveTarget, [resolveTarget]);

  // The site's own origin, so field patches aren't broadcast to any listener.
  const previewOrigin = (() => {
    try {
      return target?.url ? new URL(target.url).origin : null;
    } catch {
      return null;
    }
  })();
  const targetOrigin = previewOrigin ?? '*';

  // Tell the entry editor which origin to accept messages from, so clicks and
  // inline edits in the connected site reach the form.
  useEffect(() => {
    onPreviewOriginChange?.(previewOrigin);
  }, [previewOrigin, onPreviewOriginChange]);

  useImperativeHandle(ref, () => ({
    notifyFieldUpdated(entryId, fieldId, value) {
      iframeRef.current?.contentWindow?.postMessage(
        { type: MSG.FIELD_UPDATED, entryId, fieldId, value },
        targetOrigin,
      );
    },
    reload() {
      setNonce((n) => n + 1);
    },
  }));

  // ---- the bridge announcing itself ---------------------------------------
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data && typeof data === 'object' && data.type === MSG.PREVIEW_READY) {
        setInstrumented(
          typeof data.instrumentedFields === 'number' ? data.instrumentedFields : null,
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function toggleInspector() {
    const next = !inspector;
    setInspector(next);
    iframeRef.current?.contentWindow?.postMessage(
      { type: MSG.SET_INSPECTOR, enabled: next },
      targetOrigin,
    );
  }

  // Tell the site it is being previewed, which locale to render, and which
  // component to reveal when previewing a block.
  const src = (() => {
    if (!target?.url) return '';
    try {
      const url = new URL(target.url);
      url.searchParams.set('ondros-preview', '1');
      if (locale) url.searchParams.set('ondros-locale', locale);
      if (target.focus_entry_id) url.searchParams.set('ondros-focus', target.focus_entry_id);
      if (environmentKey) url.searchParams.set('ondros-environment', environmentKey);
      // Cache-buster so Reload really refetches a statically served page.
      if (nonce) url.searchParams.set('ondros-nonce', String(nonce));
      return url.toString();
    } catch {
      return '';
    }
  })();

  if (codeSync && !codeSync.connected) {
    return <NotConnected state={codeSync} spaceId={spaceId} />;
  }

  return (
    <div>
      <div className="preview-toolbar">
        <strong className="pt-title">Live preview</strong>
        <span className="pt-meta">
          {environmentKey} · {locale} · {target?.mode === 'component' ? 'component' : 'page'}
        </span>
        {target?.mode === 'component' && target.host_title && (
          <span
            className="chip pt-host"
            title={`This block has no page of its own, so it is shown inside /${target.host_title}, a page that uses it`}
          >
            <Icon name="content" size={10} /> in /{target.host_title}
          </span>
        )}
        <span className="pt-actions">
          <button
            className="btn secondary small"
            onClick={toggleInspector}
            title={inspector ? 'Inspector on — click to disable' : 'Inspector off — click to enable'}
          >
            <Icon name={inspector ? 'inspector-on' : 'inspector-off'} size={13} />
            <span className="pt-label">{inspector ? 'Inspector on' : 'Inspector off'}</span>
          </button>
          <button
            className="btn secondary small"
            title="Reload the preview"
            onClick={() => {
              setNonce((n) => n + 1);
              resolveTarget();
            }}
          >
            <Icon name="reload" size={13} />
            <span className="pt-label">Reload</span>
          </button>
          {src && (
            <a
              className="btn secondary small"
              href={src}
              target="_blank"
              rel="noreferrer"
              title="Open the preview in a new tab"
            >
              <span className="pt-label">Open</span>
              <Icon name="open-external" size={12} />
            </a>
          )}
        </span>
      </div>

      {error && <p className="error-text">{error}</p>}

      {target && (target.mode === 'orphan' || target.mode === 'unroutable') && (
        <NothingToRender target={target} />
      )}

      {src && (
        <>
          {instrumented === 0 && (
            <p className="help-text">
              <Icon name="warning" size={12} /> This page loaded but carries no{' '}
              <code>data-ondros-*</code> attributes, so nothing can be selected or edited in
              place. See Settings → Code Sync for the markup contract.
            </p>
          )}
          <iframe
            key={nonce}
            ref={iframeRef}
            className="preview-frame"
            src={src}
            title="Live preview"
          />
        </>
      )}

      {!src && !target && !error && <p className="muted">Resolving preview URL…</p>}

      {/* Same-origin fallback wiring; idle when the iframe is cross-origin
          (then the site's ondros-editor.js bridge + postMessage handle it). */}
      <InlineEditorOverlay
        iframeRef={iframeRef}
        onFieldSelected={onFieldSelected}
        onCommit={onInlineCommit}
      />
    </div>
  );
});

/** No repository connected: the pane has nothing it could legitimately show. */
function NotConnected({ state, spaceId }: { state: CodeSyncState; spaceId: string }) {
  const installHref = state.install_url
    ? `${state.install_url}${state.install_url.includes('?') ? '&' : '?'}state=${spaceId}`
    : '';
  return (
    <div>
      <div className="preview-toolbar">
        <strong className="pt-title">Live preview</strong>
      </div>
      <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <div style={{ marginBottom: 10 }}>
          <Icon name="github" size={30} />
        </div>
        <h2 style={{ margin: '0 0 6px' }}>Connect with GitHub for preview</h2>
        <p className="muted" style={{ maxWidth: 420, margin: '0 auto 14px' }}>
          Previews render your own pages and components from the repository that builds this
          site. Connect one and this pane shows the real page, with every field editable in
          place.
        </p>
        {state.configured && state.mode === 'app' && installHref ? (
          <a className="btn" href={installHref}>
            <Icon name="github" size={14} /> Connect with GitHub
          </a>
        ) : (
          <Link className="btn" href="/settings/code-sync">
            <Icon name="code-sync" size={14} /> Set up Code Sync
          </Link>
        )}
        {!state.configured && (
          <p className="help-text" style={{ marginTop: 12 }}>
            Code Sync isn&apos;t configured on this server yet — an operator needs to register
            the GitHub App first.
          </p>
        )}
      </div>
    </div>
  );
}

/** Connected, but this particular entry has no page that could render it. */
function NothingToRender({ target }: { target: PreviewTarget }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <Icon name="warning" size={15} />
        <strong>
          {target.mode === 'unroutable' ? 'This entry has no URL yet' : 'Not used on any page yet'}
        </strong>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {target.message}
      </p>
    </div>
  );
}

export default LivePreviewPane;
