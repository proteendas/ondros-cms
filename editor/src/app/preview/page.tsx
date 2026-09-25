'use client';

/**
 * Full-screen preview of one entry, opened from the editor's "Open" button.
 *
 * The split-view pane is narrow by nature, so this route exists to give the
 * previewed site the whole window — with the same viewport switcher, because
 * checking a layout at 390px is exactly what someone opening a bigger preview
 * is usually trying to do.
 *
 * It is chrome-free (see AppShell) and read-only: no inspector, no inline
 * editing. Editing happens in the editor, where the form is.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import Icon from '@/components/ui/Icon';
import {
  DeviceControls,
  DeviceStage,
  findDevice,
  useDeviceScale,
  useStoredDevice,
} from '@/components/PreviewDevices';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import type { Entry, PreviewTarget } from '@/lib/types';

export default function PreviewPage() {
  return (
    <Suspense fallback={<p className="muted" style={{ padding: 24 }}>Loading…</p>}>
      <PreviewPageInner />
    </Suspense>
  );
}

function PreviewPageInner() {
  const params = useSearchParams();
  const entryId = params.get('entry') ?? '';
  const { space, environment } = useWorkspace();

  const [entry, setEntry] = useState<Entry | null>(null);
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const locale = params.get('locale') ?? space?.default_locale ?? 'en-US';
  const { deviceId, landscape, selectDevice, rotate } = useStoredDevice('cms_preview_device');
  const { stageRef, width, height, scale } = useDeviceScale(findDevice(deviceId), landscape);

  useEffect(() => {
    if (!entryId) return;
    api<Entry>(`/entries/${entryId}`).then(setEntry).catch((e) => setError(e.message));
  }, [entryId]);

  const resolve = useCallback(() => {
    if (!entryId || !space || !environment) return;
    api<PreviewTarget>(
      `/spaces/${space.id}/environments/${encodeURIComponent(environment.key)}` +
        `/code-sync/preview-target?entry_id=${entryId}`,
    )
      .then(setTarget)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not resolve a preview URL'));
  }, [entryId, space, environment]);

  useEffect(resolve, [resolve]);

  const src = (() => {
    if (!target?.url) return '';
    try {
      const url = new URL(target.url);
      // The ticket is the authorization, not the flag: anyone can type
      // ?ondros-preview=1, so the site only trusts a signature it can verify.
      url.searchParams.set('ondros-preview', target.preview_token || '1');
      if (locale) url.searchParams.set('ondros-locale', locale);
      if (target.focus_entry_id) url.searchParams.set('ondros-focus', target.focus_entry_id);
      if (environment) url.searchParams.set('ondros-environment', environment.key);
      if (nonce) url.searchParams.set('ondros-nonce', String(nonce));
      return url.toString();
    } catch {
      return '';
    }
  })();

  return (
    <div className="preview-page">
      <header className="preview-page-bar">
        <Link href={entryId ? `/entries/${entryId}` : '/entries'} className="btn secondary small">
          <Icon name="back" size={13} /> Back to editor
        </Link>
        <strong className="pt-title">{entry ? entry.slug ?? 'Preview' : 'Preview'}</strong>
        {target?.mode === 'component' && target.host_title && (
          <span className="chip" title="A block, shown inside a page that uses it">
            <Icon name="content" size={10} /> in /{target.host_title}
          </span>
        )}
        <span className="spacer" />
        <DeviceControls
          deviceId={deviceId}
          landscape={landscape}
          scale={scale}
          onDevice={selectDevice}
          onRotate={rotate}
        />
        <button
          className="btn secondary small"
          onClick={() => { setNonce((n) => n + 1); resolve(); }}
          title="Reload the preview"
        >
          <Icon name="reload" size={13} />
        </button>
        {src && (
          <a
            className="btn secondary small"
            href={src}
            target="_blank"
            rel="noreferrer"
            title="Open the site itself, without this frame"
          >
            <Icon name="open-external" size={12} />
          </a>
        )}
      </header>

      {error && <p className="error-text" style={{ padding: '12px 16px' }}>{error}</p>}

      {target && (target.mode === 'orphan' || target.mode === 'unroutable') && (
        <p className="muted" style={{ padding: '16px' }}>{target.message}</p>
      )}

      {src ? (
        <div className="preview-page-body">
          <DeviceStage stageRef={stageRef} width={width} height={height} scale={scale}>
            <iframe key={nonce} className="preview-frame" src={src} title="Preview" />
          </DeviceStage>
        </div>
      ) : (
        !error && !target && <p className="muted" style={{ padding: 16 }}>Resolving preview URL…</p>
      )}
    </div>
  );
}
