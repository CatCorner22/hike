"use client";

import { useEffect } from "react";
import { isNative } from "@/lib/platform/native";
import { setPlatformAdapters } from "@/lib/platform/adapters";
import { mintSession, setTokenStore } from "@/lib/api/client";

/**
 * Registers the Capacitor implementations behind the platform seams, once, at
 * app start, and only inside the native shell — on the web this component
 * renders nothing and touches nothing, so web behavior stays byte-identical.
 *
 * The dynamic imports are the seam discipline: `@capacitor/*` never enters the
 * web bundle's synchronous graph, the server, or vitest. If any part of the
 * registration fails the app keeps running on the web fallbacks, which are
 * honest about what they cannot do (that is their design).
 */
export function NativeBootstrap() {
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ buildCapacitorAdapters, reclaimOrphanedGeoWatchers }, { Preferences }] =
          await Promise.all([
            import("@/lib/platform/capacitor/register"),
            import("@capacitor/preferences"),
          ]);
        if (cancelled) return;
        /**
         * Before this page opens any location watcher, close the ones the last
         * page left running.
         *
         * WKWebView's content process is killed under memory pressure and
         * Capacitor reloads the page; the JS that held the watcher id dies, the
         * native CLLocationManager does not. Reclaiming first — and awaiting it
         * before the adapters are published, so nothing can start a watcher in
         * between — is what stops one orphan accumulating per kill on the
         * battery a hiker is depending on.
         */
        await reclaimOrphanedGeoWatchers().catch(() => 0);
        if (cancelled) return;
        setPlatformAdapters(buildCapacitorAdapters());
        setTokenStore({
          async read() {
            const { value } = await Preferences.get({ key: "hike-session-token" });
            return value ?? null;
          },
          async write(token) {
            await Preferences.set({ key: "hike-session-token", value: token });
          },
        });
        // Warm the session so the first API call after install does not pay
        // the mint round-trip; offline at launch is ordinary and non-fatal.
        void mintSession();
      } catch {
        // Web fallbacks remain in place; nothing to surface here — every seam
        // reports its own capability honestly at the point of use.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
