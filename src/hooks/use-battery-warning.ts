"use client";

import { useEffect, useState } from "react";
import { batterySafetyAdvice } from "@/lib/safety/field-ops";

/**
 * `batterySafetyAdvice` has tiers at 20%, 10% and 5%. Gating at 15% made the 20% tier
 * — "plan your next comms window before the phone dies" — unreachable, so the band where
 * there is still time to act on it said nothing at all.
 */
export function useBatteryWarning(threshold = 0.2) {
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (type: string, listener: () => void) => void;
        removeEventListener: (type: string, listener: () => void) => void;
      }>;
    };
    if (!nav.getBattery) return;

    let battery: Awaited<ReturnType<NonNullable<typeof nav.getBattery>>> | null = null;
    let cancelled = false;

    const update = () => {
      if (!battery) return;
      if (!battery.charging && battery.level <= threshold) {
        setWarning(
          batterySafetyAdvice(battery.level, battery.charging) ??
            `Battery ${Math.round(battery.level * 100)}% — enable battery saver and keep the screen dim.`,
        );
      } else {
        setWarning(null);
      }
    };

    void nav.getBattery().then((b) => {
      // getBattery() can resolve after unmount; subscribing then would leak listeners
      // that outlive the component and never get removed.
      if (cancelled) return;
      battery = b;
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    });

    return () => {
      cancelled = true;
      battery?.removeEventListener("levelchange", update);
      battery?.removeEventListener("chargingchange", update);
    };
  }, [threshold]);

  return warning;
}
