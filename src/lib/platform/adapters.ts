/**
 * The seam between the shared TypeScript core and whatever platform is hosting it.
 *
 * On the web nothing registers here and every seam falls back to the browser API it
 * wraps — byte-identical behavior to before the seam existed. Inside the Capacitor
 * shell, the native bootstrap registers real implementations (Capacitor Network,
 * Device battery, Haptics, Filesystem+Share) at startup. Registration by injection
 * keeps `@capacitor/*` imports out of the web bundle, the server, and vitest — the
 * core never carries a native dependency, and every adapter is trivially fakeable in
 * tests.
 *
 * This matters beyond hygiene: on iOS WKWebView, `navigator.onLine` is unreliable,
 * `navigator.getBattery` does not exist (the battery warning is dead there), and
 * `navigator.vibrate` does not exist (the haptic Morse patterns are dead there). The
 * adapters are how those safety features come back to life on the phone.
 */

export interface NetworkAdapter {
  isOnline(): boolean;
  /** Calls back on every connectivity change; returns an unsubscribe. */
  subscribe(onChange: (online: boolean) => void): () => void;
}

export interface BatteryAdapter {
  read(): Promise<{ level: number; charging: boolean } | null>;
}

export interface HapticsAdapter {
  /** navigator.vibrate-shaped pattern: [buzz, pause, buzz, …] in milliseconds. */
  vibrate(pattern: number[]): boolean;
}

export interface SaveFileAdapter {
  saveText(filename: string, text: string, mime: string): Promise<boolean>;
}

/** What the operating system currently allows, distinguished from what it was never asked. */
export type NotificationPermission = "granted" | "denied" | "prompt";

export interface NotificationsAdapter {
  /** Idempotent: scheduling an id that is already scheduled replaces it. */
  scheduleAt(id: number, atMs: number, title: string, body: string): Promise<boolean>;
  cancel(id: number): Promise<void>;
  /**
   * The settled state, without prompting. "denied" and "prompt" both mean no
   * alarm will fire, and they need different words on screen: one asks the
   * hiker to tap a button, the other to open Settings.
   */
  permission?(): Promise<NotificationPermission>;
  /** Prompts only when the answer is still "prompt"; otherwise reports the settled state. */
  requestPermission?(): Promise<NotificationPermission>;
  /** Opens the OS notification settings for this app, where a denial can be reversed. */
  openSettings?(): Promise<boolean>;
}

export interface WakeLockAdapter {
  /** Resolves to whether the screen is actually being kept awake. */
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

export interface GeoWatcher {
  stop(): void;
}

export interface GeolocationAdapter {
  /**
   * Continuous position watch. `background: true` asks the platform to keep
   * delivering fixes with the screen locked (track recording); the web
   * fallback cannot honor it and callers must not pretend otherwise.
   * Callbacks receive GeolocationPosition/GeolocationPositionError-shaped
   * objects so the existing watchdog/trust/stale logic runs unchanged.
   */
  watch(
    onFix: (position: GeolocationPosition) => void,
    onError: (error: GeolocationPositionError) => void,
    options: { background: boolean },
  ): GeoWatcher;
}

export interface PlatformAdapters {
  network?: NetworkAdapter;
  battery?: BatteryAdapter;
  haptics?: HapticsAdapter;
  saveFile?: SaveFileAdapter;
  notifications?: NotificationsAdapter;
  heading?: import("@/lib/platform/heading").HeadingAdapter;
  wakeLock?: WakeLockAdapter;
  geolocation?: GeolocationAdapter;
}

let adapters: PlatformAdapters = {};
const listeners = new Set<() => void>();

export function setPlatformAdapters(next: PlatformAdapters): void {
  adapters = next;
  for (const listener of [...listeners]) listener();
}

/**
 * Notifies when the native adapters land.
 *
 * Registration is asynchronous by construction: NativeBootstrap awaits two
 * dynamic imports before it calls `setPlatformAdapters`, so it always resolves
 * AFTER React has flushed the first round of mount effects. A seam sampled once
 * in such an effect therefore reads the web fallback and keeps it forever —
 * `requestWakeLock()` returns its no-op handle and never retries, and
 * `isHeadingSupported()` answers false for the rest of the session.
 *
 * That was unreachable while every launch landed on the root document, because
 * the navigate screen could only be reached by a client navigation long after
 * hydration. Serving deep routes properly (StaticExportRouter) makes /navigate a
 * genuine first mount — after a WKWebView content-process reload, the common
 * case — so the seams have to be able to notice a late registration.
 */
export function subscribePlatformAdapters(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPlatformAdapters(): PlatformAdapters {
  return adapters;
}

/** Test-only: restore the web-default state. */
export function __resetPlatformAdaptersForTests(): void {
  adapters = {};
  listeners.clear();
}
