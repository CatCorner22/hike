import { getPlatformAdapters } from "@/lib/platform/adapters";

/**
 * Vibration, through the platform seam.
 *
 * Web fallback is `navigator.vibrate` — absent on iOS, where every haptic Morse
 * pattern (SOS pulse included) has been silently dead. The Capacitor shell registers
 * a HapticsAdapter that walks the same [buzz, pause, …] arrays with impact events, so
 * the timing semantics are preserved and the pattern constants stay single-sourced.
 *
 * Returns whether a vibration was actually dispatched, so callers can label the
 * feature honestly instead of pretending it fired.
 */
export function vibratePattern(pattern: number[]): boolean {
  if (!Array.isArray(pattern) || pattern.length === 0) return false;
  if (!pattern.every((ms) => Number.isFinite(ms) && ms >= 0 && ms <= 10_000)) return false;
  const adapter = getPlatformAdapters().haptics;
  if (adapter) return adapter.vibrate(pattern);
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  return navigator.vibrate(pattern) === true;
}
