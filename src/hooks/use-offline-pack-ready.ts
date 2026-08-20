"use client";

import { useEffect, useState } from "react";
import { hasRoutePack } from "@/lib/offline/route-pack";

export function useOfflinePackReady(packId: string | null) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!packId) {
        await Promise.resolve();
        if (!cancelled) setReady(false);
        return;
      }
      // The persistence call normally completes immediately. A bounded,
      // increasing retry window covers IndexedDB startup without keeping the
      // plan page alive forever.
      const delays = [0, 100, 250, 500, 1_000, 2_000, 4_000];
      for (const delay of delays) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const exists = await hasRoutePack(packId);
        if (cancelled) return;
        setReady(exists);
        if (exists) return;
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, [packId]);

  return ready;
}
