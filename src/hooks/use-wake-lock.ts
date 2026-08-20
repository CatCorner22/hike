"use client";

import { useSyncExternalStore } from "react";
import { isWakeLockHeld, subscribeWakeLock } from "@/lib/offline/wake-lock";

/**
 * Live wake-lock state.
 *
 * The self-check used to read `isWakeLockHeld()` inside a `useMemo` that did not depend
 * on it, so the row was computed from a module global at some arbitrary earlier moment
 * and never recomputed. `useSyncExternalStore` is the supported way to read a value that
 * lives outside React and changes on its own.
 */
export function useWakeLockHeld(): boolean {
  return useSyncExternalStore(
    subscribeWakeLock,
    isWakeLockHeld,
    () => false, // server render: nothing is held
  );
}
