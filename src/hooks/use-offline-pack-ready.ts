"use client";

import { useEffect, useState } from "react";
import { hasRoutePack } from "@/lib/offline/route-pack";
import { getNavigateOfflineStatus } from "@/lib/offline/navigate-shell";

export interface OfflinePackReadiness {
  checking: boolean;
  packReady: boolean;
  tripReady: boolean;
}

export function useOfflinePackReady(packId: string | null) {
  const [readiness, setReadiness] = useState<OfflinePackReadiness>({
    checking: true,
    packReady: false,
    tripReady: false,
  });

  useEffect(() => {
    let cancelled = false;
    let checkNumber = 0;

    async function check() {
      const currentCheck = ++checkNumber;
      if (!packId) {
        await Promise.resolve();
        if (!cancelled && currentCheck === checkNumber) {
          setReadiness({ checking: false, packReady: false, tripReady: false });
        }
        return;
      }
      setReadiness((current) => ({ ...current, checking: true }));
      // The persistence call normally completes immediately. A bounded,
      // increasing retry window covers IndexedDB startup without keeping the
      // plan page alive forever.
      const delays = [0, 100, 250, 500, 1_000, 2_000, 4_000];
      for (const delay of delays) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          // Per-plan readiness is the route pack in IndexedDB; the navigate
          // shell is app-level and shared by every plan.
          const [exists, navigation] = await Promise.all([
            hasRoutePack(packId),
            getNavigateOfflineStatus(),
          ]);
          if (cancelled || currentCheck !== checkNumber) return;
          setReadiness({
            checking: !exists,
            packReady: exists,
            tripReady: exists && navigation.ready,
          });
          if (exists) return;
        } catch {
          if (cancelled || currentCheck !== checkNumber) return;
          setReadiness({ checking: false, packReady: false, tripReady: false });
          return;
        }
      }
      if (!cancelled && currentCheck === checkNumber) {
        setReadiness({ checking: false, packReady: false, tripReady: false });
      }
    }

    void check();
    const refresh = () => { void check(); };
    window.addEventListener("hike:offline-readiness-changed", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("hike:offline-readiness-changed", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [packId]);

  return readiness;
}
