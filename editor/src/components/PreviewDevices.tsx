'use client';

/**
 * Viewport switcher for the live preview (AEM Universal Editor-style).
 *
 * Authors need to know a page holds up at the widths their visitors actually
 * use, and "resize the browser" is not available inside a split pane. So the
 * previewed site is rendered at a real device width and scaled down to fit
 * whatever space it has — the site still believes it is that wide, so its own
 * media queries fire exactly as they would on the device.
 *
 * Shared by the split-view pane and the full-screen /preview route so both
 * offer the same sizes.
 */
import { useCallback, useEffect, useState } from 'react';

import Icon, { IconName } from '@/components/ui/Icon';

export interface PreviewDevice {
  id: string;
  label: string;
  /** null = fill whatever space is available (no fixed width). */
  width: number | null;
  height: number | null;
  icon: IconName;
  /** Rotation is only meaningful for the handheld sizes. */
  rotatable?: boolean;
}

export const DEVICES: PreviewDevice[] = [
  { id: 'fit', label: 'Fit to pane', width: null, height: null, icon: 'device-fit' },
  { id: 'desktop', label: 'Desktop · 1440', width: 1440, height: 900, icon: 'device-desktop' },
  { id: 'laptop', label: 'Laptop · 1280', width: 1280, height: 800, icon: 'device-laptop' },
  { id: 'tablet', label: 'Tablet · 834', width: 834, height: 1112, icon: 'device-tablet', rotatable: true },
  { id: 'mobile', label: 'Mobile · 390', width: 390, height: 844, icon: 'device-mobile', rotatable: true },
];

export function findDevice(id: string): PreviewDevice {
  return DEVICES.find((d) => d.id === id) ?? DEVICES[0];
}

/**
 * Measure the stage and work out how far the device has to shrink to fit.
 *
 * Only ever scales down: blowing a 390px layout up to fill a wide pane would
 * show the author something no device renders.
 */
export type StageRef = (el: HTMLDivElement | null) => void;

export function useDeviceScale(
  device: PreviewDevice,
  landscape: boolean,
): {
  stageRef: StageRef;
  width: number | null;
  height: number | null;
  scale: number;
} {
  // A callback ref, not useRef: the stage only mounts once a preview URL has
  // resolved, so an effect keyed on [] would run while the element is still
  // null, observe nothing, and never retry — leaving scale pinned at 1 and
  // every viewport wider than the pane overflowing it.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => setNode(el), []);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!node) return;
    // Seed from the current box: ResizeObserver only fires on the next frame,
    // and the first paint should already be at the right scale.
    const rect = node.getBoundingClientRect();
    setBox({ width: rect.width, height: rect.height });

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  if (device.width === null || device.height === null) {
    return { stageRef, width: null, height: null, scale: 1 };
  }

  const width = landscape && device.rotatable ? device.height : device.width;
  const height = landscape && device.rotatable ? device.width : device.height;
  const fitsWidth = box.width > 0 ? box.width / width : 1;
  const fitsHeight = box.height > 0 ? box.height / height : 1;
  const scale = Math.min(1, fitsWidth, fitsHeight);

  return { stageRef, width, height, scale };
}

/** Segmented device buttons + rotate, for a preview toolbar. */
export function DeviceControls({
  deviceId,
  landscape,
  scale,
  onDevice,
  onRotate,
  compact,
}: {
  deviceId: string;
  landscape: boolean;
  scale: number;
  onDevice: (id: string) => void;
  onRotate: () => void;
  /** Hide the size read-out where there is no room for it. */
  compact?: boolean;
}) {
  const device = findDevice(deviceId);
  const width = landscape && device.rotatable ? device.height : device.width;
  const height = landscape && device.rotatable ? device.width : device.height;

  return (
    <>
      {/* A row of device buttons rather than a dropdown: the choice is small,
          switching is the whole point, and a browser's device bar is the
          convention people already know. */}
      <span className="device-switch" role="group" aria-label="Preview viewport size">
        {DEVICES.map((d) => (
          <button
            key={d.id}
            type="button"
            className={d.id === deviceId ? 'active' : undefined}
            onClick={() => onDevice(d.id)}
            title={d.label}
            aria-label={d.label}
            aria-pressed={d.id === deviceId}
          >
            <Icon name={d.icon} size={14} />
          </button>
        ))}
      </span>
      {device.rotatable && (
        <button
          className="btn secondary small"
          onClick={onRotate}
          title={landscape ? 'Switch to portrait' : 'Switch to landscape'}
          aria-pressed={landscape}
        >
          <Icon name="rotate" size={13} />
        </button>
      )}
      {!compact && width && height && (
        <span className="preview-size" aria-live="polite">
          {width} × {height}
          {scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}
        </span>
      )}
    </>
  );
}

/**
 * Wraps the iframe so it renders at the device's real pixel width and is
 * scaled to fit. `children` receives no props — it is the iframe itself.
 */
export function DeviceStage({
  stageRef,
  width,
  height,
  scale,
  children,
}: {
  stageRef: StageRef;
  width: number | null;
  height: number | null;
  scale: number;
  children: React.ReactNode;
}) {
  const fixed = width !== null && height !== null;
  return (
    <div className={`preview-stage${fixed ? ' framed' : ''}`} ref={stageRef}>
      {fixed ? (
        <div
          className="preview-viewport"
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            // Reserve the on-screen size the scaled frame actually occupies,
            // so the surrounding layout doesn't leave a gap under it.
            marginBottom: height * scale - height,
          }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** Remembers the chosen device across sessions, per browser. */
export function useStoredDevice(storageKey: string) {
  const [deviceId, setDeviceId] = useState('fit');
  const [landscape, setLandscape] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored && DEVICES.some((d) => d.id === stored)) setDeviceId(stored);
    } catch {
      /* blocked storage: the default is fine */
    }
  }, [storageKey]);

  const select = useCallback(
    (id: string) => {
      setDeviceId(id);
      if (!findDevice(id).rotatable) setLandscape(false);
      try {
        window.localStorage.setItem(storageKey, id);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  return {
    deviceId,
    landscape,
    selectDevice: select,
    rotate: useCallback(() => setLandscape((l) => !l), []),
  };
}
