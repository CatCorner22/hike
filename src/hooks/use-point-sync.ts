"use client";

import { useCallback, useEffect, useState } from "react";
import { flushPendingPoints, getPendingPointCount } from "@/lib/offline";

export function usePointSync(intervalMs = 30_000) {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await flushPendingPoints();
      setPending(result.pending);
      setLastError(null);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Point sync failed");
      setPending(await getPendingPointCount());
    } finally {
      setSyncing(false);
    }
  }, []);

  const refreshPending = useCallback(() => {
    void getPendingPointCount().then(setPending);
  }, []);

  useEffect(() => {
    const initialSync = window.setTimeout(() => void sync(), 0);
    const onOnline = () => void sync();
    const onQueued = () => { refreshPending(); void sync(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("hike-points-queued", onQueued);
    const interval = window.setInterval(() => void sync(), intervalMs);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("hike-points-queued", onQueued);
      window.clearTimeout(initialSync);
      window.clearInterval(interval);
    };
  }, [intervalMs, refreshPending, sync]);

  return { pending, syncing, lastError };
}
