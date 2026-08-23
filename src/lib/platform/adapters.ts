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

export interface NotificationsAdapter {
  /** Idempotent: scheduling an id that is already scheduled replaces it. */
  scheduleAt(id: number, atMs: number, title: string, body: string): Promise<boolean>;
  cancel(id: number): Promise<void>;
}

export interface PlatformAdapters {
  network?: NetworkAdapter;
  battery?: BatteryAdapter;
  haptics?: HapticsAdapter;
  saveFile?: SaveFileAdapter;
  notifications?: NotificationsAdapter;
  heading?: import("@/lib/platform/heading").HeadingAdapter;
}

let adapters: PlatformAdapters = {};

export function setPlatformAdapters(next: PlatformAdapters): void {
  adapters = next;
}

export function getPlatformAdapters(): PlatformAdapters {
  return adapters;
}

/** Test-only: restore the web-default state. */
export function __resetPlatformAdaptersForTests(): void {
  adapters = {};
}
