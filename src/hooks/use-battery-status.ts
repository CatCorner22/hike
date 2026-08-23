"use client";

import { useEffect, useState } from "react";

// Raw battery facts only — no warning field. This hook once carried a duplicate
// warning gated at 15% while the rendered one (useBatteryWarning) fires at the
// advice module's 20% tier; the first component to wire the ready-made field
// would have re-shipped the silent 16–20% band. One source of truth.
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
