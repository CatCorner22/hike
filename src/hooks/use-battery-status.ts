"use client";

import { useEffect, useState } from "react";
import { readBatteryStatus } from "@/lib/platform/battery";

// Raw battery facts only — no warning field. This hook once carried a duplicate
// warning gated at 15% while the rendered one (useBatteryWarning) fires at the
// advice module's 20% tier; the first component to wire the ready-made field
// would have re-shipped the silent 16–20% band. One source of truth.
//
// Reads go through the platform seam: navigator.getBattery does not exist on
// iOS, so in the shell a Device adapter answers instead — the battery footer
// and rescue-card percentage come back to life there. Level changes are slow,
// so a 60-second poll replaces the web-only levelchange events without losing
// anything a hiker acts on.
export function useBatteryStatus() {
  const [state, setState] = useState<{
    available: boolean;
    level: number | null;
    charging: boolean | null;
  }>({
    available: false,
    level: null,
    charging: null,
  });

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const status = await readBatteryStatus();
      if (cancelled) return;
      setState(
        status
          ? { available: true, level: status.level, charging: status.charging }
          : { available: false, level: null, charging: null },
      );
    };
    void read();
    const interval = window.setInterval(() => void read(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return state;
}
