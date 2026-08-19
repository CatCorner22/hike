"use client";

import { useEffect, useState } from "react";
import { hasRoutePack } from "@/lib/offline/route-pack";

export function useOfflinePackReady(packId: string | null) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!packId) {
      setReady(false);
      return;
    }

    let cancelled = false;

    async function check() {
      for (let i = 0; i < 40; i++) {
        const exists = await hasRoutePack(packId!);
        if (cancelled) return;
        if (exists) {
          setReady(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      while (!cancelled) {
        const exists = await hasRoutePack(packId!);
        if (cancelled) return;
        if (exists) {
          setReady(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    setReady(false);
    void check();
    return () => {
      cancelled = true;
    };
  }, [packId]);

  return ready;
}
