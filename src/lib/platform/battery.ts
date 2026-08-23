import { getPlatformAdapters } from "@/lib/platform/adapters";

/**
 * Battery status, through the platform seam.
 *
 * Web fallback is `navigator.getBattery`, which iOS Safari and WKWebView simply do not
 * have — so on the phone the low-battery safety warning has been dead code. The
 * Capacitor shell registers a BatteryAdapter (Device.getBatteryInfo) to revive it.
 * `null` means "unknown", and callers must treat unknown as no-warning rather than
 * inventing a level.
 */
export async function readBatteryStatus(): Promise<{ level: number; charging: boolean } | null> {
  const adapter = getPlatformAdapters().battery;
  if (adapter) {
    try {
      return await adapter.read();
    } catch {
      return null;
    }
  }
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<{ level: number; charging: boolean }>;
  };
  if (!nav.getBattery) return null;
  try {
    const battery = await nav.getBattery();
    if (!Number.isFinite(battery.level) || battery.level < 0 || battery.level > 1) return null;
    return { level: battery.level, charging: battery.charging === true };
  } catch {
    return null;
  }
}
