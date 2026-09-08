"use client";

import { useEffect, useState } from "react";
import { batterySafetyAdvice } from "@/lib/safety/field-ops";
import { readBatteryStatus } from "@/lib/platform/battery";

/**
 * `batterySafetyAdvice` has tiers at 20%, 10% and 5%. Gating at 15% made the 20% tier
 * — "plan your next comms window before the phone dies" — unreachable, so the band where
 * there is still time to act on it said nothing at all.
 *
 * Reads go through the platform seam: navigator.getBattery does not exist on iOS,
 * so this warning has been dead on every iPhone; the shell's Device adapter revives
 * it. A 60-second poll replaces the web-only levelchange events — battery moves
 * slowly, and a minute of latency on a percentage warning changes no decision.
 */
export function useBatteryWarning(threshold = 0.2) {
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const status = await readBatteryStatus();
      if (cancelled) return;
      if (status && !status.charging && status.level <= threshold) {
        setWarning(
          batterySafetyAdvice(status.level, status.charging) ??
            `Battery ${Math.round(status.level * 100)}% — enable battery saver and keep the screen dim.`,
        );
      } else {
        setWarning(null);
      }
    };
    void read();
    const interval = window.setInterval(() => void read(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [threshold]);

  return warning;
}
