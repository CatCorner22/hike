"use client";

import { useEffect, useState } from "react";

export function useBatteryWarning(threshold = 0.15) {
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

    const update = () => {
      if (!battery) return;
      if (!battery.charging && battery.level <= threshold) {
        setWarning(
          `Battery ${Math.round(battery.level * 100)}% — enable battery saver and keep the screen dim.`,
        );
      } else {
        setWarning(null);
      }
    };

    void nav.getBattery().then((b) => {
      battery = b;
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    });

    return () => {
      battery?.removeEventListener("levelchange", update);
      battery?.removeEventListener("chargingchange", update);
    };
  }, [threshold]);

  return warning;
}
