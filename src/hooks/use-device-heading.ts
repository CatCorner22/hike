"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  reduceDeviceOrientationHeadingSample,
  unavailableDeviceHeadingState,
} from "@/lib/safety/device-heading";
import { isHeadingSupported, subscribeHeading } from "@/lib/platform/heading";
import { subscribePlatformAdapters } from "@/lib/platform/adapters";

export type DeviceHeadingPermission = "unsupported" | "prompt" | "granted" | "denied";

export interface DeviceHeadingState {
  /** Device magnetometer converted to true north; never a raw magnetic reading. */
  headingTrue: number | null;
  permission: DeviceHeadingPermission;
  live: boolean;
  message: string | null;
  requestPermission: () => Promise<boolean>;
}

type OrientEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

function usableDeclination(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && Math.abs(value) <= 90 ? value : null;
}

export interface UseDeviceHeadingOptions {
  enabled?: boolean;
  /** Current magnetic declination, east-positive, from a trusted location fix. */
  declinationDeg?: number | null;
}

function currentScreenOrientationDeg(): number | null {
  if (typeof window === "undefined") return null;
  const modern = window.screen?.orientation?.angle;
  if (typeof modern === "number" && Number.isFinite(modern)) return modern;
  const legacy = (window as Window & { orientation?: unknown }).orientation;
  return typeof legacy === "number" && Number.isFinite(legacy) ? legacy : null;
}

function needsIosPermission(): boolean {
  return (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission === "function"
  );
}

export function useDeviceHeading({
  enabled = true,
  declinationDeg = null,
}: UseDeviceHeadingOptions = {}): DeviceHeadingState {
  const [reading, setReading] = useState(() => unavailableDeviceHeadingState(null));
  const [permission, setPermission] = useState<DeviceHeadingPermission>("prompt");
  const handlerRef = useRef<((event: Event) => void) | null>(null);
  const declinationRef = useRef<number | null>(usableDeclination(declinationDeg));

  useEffect(() => {
    declinationRef.current = usableDeclination(declinationDeg);
    if (declinationRef.current != null) return;
    queueMicrotask(() => {
      setReading((current) =>
        unavailableDeviceHeadingState(
          permission === "granted"
            ? "Phone compass cannot be converted to true north here — using GPS course when moving."
            : current.message,
        ),
      );
    });
  }, [declinationDeg, permission]);

  /**
   * The native adapters register after React has flushed the first mount
   * effects, so the one-shot `isHeadingSupported()` sample below would pin the
   * web deviceorientation path for the whole session — no true-north heading at
   * rest, on the platform where the seam exists precisely to provide it. Bump a
   * generation when registration lands so the effect re-evaluates.
   */
  const [adapterGeneration, setAdapterGeneration] = useState(0);
  useEffect(
    () => subscribePlatformAdapters(() => setAdapterGeneration((generation) => generation + 1)),
    [],
  );

  const detach = useCallback(() => {
    if (typeof window === "undefined") return;
    const handler = handlerRef.current;
    if (handler == null) return;
    window.removeEventListener("deviceorientationabsolute", handler, true);
    window.removeEventListener("deviceorientation", handler, true);
    handlerRef.current = null;
  }, []);

  const attach = useCallback(() => {
    if (typeof window === "undefined") return;
    detach();
    const onOrient = (event: Event) => {
      const declination = declinationRef.current;
      if (declination == null) {
        setReading(
          unavailableDeviceHeadingState(
            "Phone compass cannot be converted to true north here — using GPS course when moving.",
          ),
        );
        return;
      }
      setReading((current) =>
        reduceDeviceOrientationHeadingSample(current, event as OrientEvent, {
          declinationDeg: declination,
          screenOrientationDeg: currentScreenOrientationDeg(),
        }),
      );
    };
    handlerRef.current = onOrient;
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
  }, [detach]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    if (!("DeviceOrientationEvent" in window)) {
      setPermission("unsupported");
      setReading(unavailableDeviceHeadingState("This browser has no compass sensor."));
      return false;
    }
    if (needsIosPermission()) {
      try {
        const req = (
          DeviceOrientationEvent as unknown as {
            requestPermission: () => Promise<PermissionState>;
          }
        ).requestPermission;
        const result = await req();
        if (result !== "granted") {
          detach();
          setPermission("denied");
          setReading(
            unavailableDeviceHeadingState(
              "Compass permission denied — using GPS course when moving.",
            ),
          );
          return false;
        }
        setPermission("granted");
        attach();
        return true;
      } catch {
        detach();
        setPermission("denied");
        setReading(
          unavailableDeviceHeadingState(
            "Compass permission denied — using GPS course when moving.",
          ),
        );
        return false;
      }
    }
    setPermission("granted");
    attach();
    return true;
  }, [attach, detach]);

  useEffect(() => {
    if (!enabled) {
      detach();
      queueMicrotask(() => setReading(unavailableDeviceHeadingState(null)));
      return;
    }
    // The shell's native magnetometer needs no per-session permission prompt and
    // arrives OS-corrected to true north; it takes precedence over the web
    // deviceorientation path whenever the adapter is registered.
    if (isHeadingSupported()) {
      queueMicrotask(() => setPermission("granted"));
      const unsubscribe = subscribeHeading((sample) => {
        const declination = declinationRef.current;
        const headingTrue =
          sample.trueHeading ??
          (declination != null
            ? (((sample.magneticHeading + declination) % 360) + 360) % 360
            : null);
        setReading({
          headingTrue,
          live: headingTrue != null,
          message:
            headingTrue == null
              ? "Phone compass cannot be converted to true north here — using GPS course when moving."
              : null,
        });
      });
      return () => {
        unsubscribe();
        detach();
      };
    }
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      queueMicrotask(() => {
        setPermission("unsupported");
        setReading(unavailableDeviceHeadingState("This browser has no compass sensor."));
      });
      return detach;
    }
    if (needsIosPermission()) {
      queueMicrotask(() => {
        setPermission("prompt");
        setReading(
          unavailableDeviceHeadingState("Tap Enable compass to use the phone magnetometer."),
        );
      });
      return detach;
    }
    queueMicrotask(() => setPermission("granted"));
    attach();
    return detach;
  }, [enabled, attach, detach, adapterGeneration]);

  return { ...reading, permission, requestPermission };
}
