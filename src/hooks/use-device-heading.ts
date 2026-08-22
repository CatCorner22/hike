"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { headingFromOrientationEvent } from "@/lib/safety/device-heading";

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
  const [headingTrue, setHeadingTrue] = useState<number | null>(null);
  const [permission, setPermission] = useState<DeviceHeadingPermission>("prompt");
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const handlerRef = useRef<((event: Event) => void) | null>(null);
  const declinationRef = useRef<number | null>(usableDeclination(declinationDeg));

  useEffect(() => {
    declinationRef.current = usableDeclination(declinationDeg);
    if (declinationRef.current != null) return;
    queueMicrotask(() => {
      setHeadingTrue(null);
      setLive(false);
      setMessage((current) =>
        permission === "granted"
          ? "Phone compass cannot be converted to true north here — using GPS course when moving."
          : current,
      );
    });
  }, [declinationDeg, permission]);

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
        setHeadingTrue(null);
        setLive(false);
        setMessage(
          "Phone compass cannot be converted to true north here — using GPS course when moving.",
        );
        return;
      }
      const parsed = headingFromOrientationEvent(event as OrientEvent, {
        declinationDeg: declination,
        screenOrientationDeg: currentScreenOrientationDeg(),
      });
      if (parsed == null) {
        setHeadingTrue(null);
        setLive(false);
        setMessage("Hold the phone flat in portrait to use its compass safely.");
        return;
      }
      setHeadingTrue(parsed);
      setLive(true);
      setMessage(null);
    };
    handlerRef.current = onOrient;
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
  }, [detach]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    if (!("DeviceOrientationEvent" in window)) {
      setPermission("unsupported");
      setMessage("This browser has no compass sensor.");
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
          setPermission("denied");
          setMessage("Compass permission denied — using GPS course when moving.");
          return false;
        }
        setPermission("granted");
        attach();
        return true;
      } catch {
        setPermission("denied");
        setMessage("Compass permission denied — using GPS course when moving.");
        return false;
      }
    }
    setPermission("granted");
    attach();
    return true;
  }, [attach]);

  useEffect(() => {
    if (!enabled) {
      detach();
      return;
    }
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      queueMicrotask(() => {
        setPermission("unsupported");
        setMessage("This browser has no compass sensor.");
      });
      return detach;
    }
    if (needsIosPermission()) {
      queueMicrotask(() => {
        setPermission("prompt");
        setMessage("Tap Enable compass to use the phone magnetometer.");
      });
      return detach;
    }
    queueMicrotask(() => setPermission("granted"));
    attach();
    return detach;
  }, [enabled, attach, detach]);

  return { headingTrue, permission, live, message, requestPermission };
}
