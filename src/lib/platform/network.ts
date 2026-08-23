import { getPlatformAdapters } from "@/lib/platform/adapters";

/**
 * Connectivity, through the platform seam.
 *
 * Web fallback is `navigator.onLine` + the online/offline events — exactly what the
 * call sites did before the seam. The Capacitor shell registers a NetworkAdapter
 * because `navigator.onLine` inside WKWebView is unreliable (it can report online
 * with the radio dead and vice versa), and a wrong answer here gates route-pack
 * downloads and shell warming.
 */
export function isOnline(): boolean {
  const adapter = getPlatformAdapters().network;
  if (adapter) return adapter.isOnline();
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function subscribeNetworkStatus(onChange: (online: boolean) => void): () => void {
  const adapter = getPlatformAdapters().network;
  if (adapter) return adapter.subscribe(onChange);
  if (typeof window === "undefined") return () => undefined;
  const notify = () => onChange(navigator.onLine !== false);
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}
