/**
 * Whether this code is running inside the Capacitor iOS shell.
 *
 * Detected off the global the shell injects rather than by importing
 * `@capacitor/core`, so the web bundle, vitest, and the server never carry a
 * native dependency — and this module is safely importable everywhere today,
 * before the Capacitor project exists in the repo.
 */
export function isNative(): boolean {
  const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}
