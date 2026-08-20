"use client";

import { useEffect, useState } from "react";
import { batterySafetyAdvice } from "@/lib/safety/field-ops";

export function useBatteryStatus() {
  const [state, setState] = useState<{
    available: boolean;
    level: number | null;
    charging: boolean | null;
    warning: string | null;
  }>({
    available: false,
    level: null,
    charging: null,
    warning: null,
  });

  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (type: string, listener: () => void) => void;
        removeEventListener: (type: string, listener: () => void) => void;
      }>;
    };
    if (!nav.getBattery) {
      return;
    }

    let battery: Awaited<ReturnType<NonNullable<typeof nav.getBattery>>> | null = null;

    const update = () => {
      if (!battery) return;
      setState({
        available: true,
        level: battery.level,
        charging: battery.charging,
        warning:
          !battery.charging && battery.level <= 0.15
            ? batterySafetyAdvice(battery.level, battery.charging)
            : null,
      });
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
  }, []);

  return state;
}
