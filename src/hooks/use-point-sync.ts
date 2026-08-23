"use client";

import { useCallback, useEffect, useState } from "react";
import { flushPendingPoints, getPendingPointCount } from "@/lib/offline";
import { subscribeNetworkStatus } from "@/lib/platform/network";

export function usePointSync(intervalMs = 30_000) {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  // Points the server will never accept are removed rather than retried forever. That
  // is a real loss of recorded track, so it has to be said out loud, not swallowed.
  const [dropped, setDropped] = useState(0);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await flushPendingPoints();
      setPending(result.pending);
      if (result.dropped > 0) setDropped((total) => total + result.dropped);
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
    const onQueued = () => { refreshPending(); void sync(); };
    // Through the platform seam: reconnect events from the shell's Network
    // plugin are trustworthy where WKWebView's 'online' event is not.
    const unsubscribeNetwork = subscribeNetworkStatus((online) => {
      if (online) void sync();
    });
    window.addEventListener("hike-points-queued", onQueued);
    const interval = window.setInterval(() => void sync(), intervalMs);
    return () => {
      unsubscribeNetwork();
      window.removeEventListener("hike-points-queued", onQueued);
      window.clearTimeout(initialSync);
      window.clearInterval(interval);
    };
  }, [intervalMs, refreshPending, sync]);

  return { pending, syncing, lastError, dropped };
}
