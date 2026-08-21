"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { headingFromOrientationEvent } from "@/lib/safety/device-heading";

export type DeviceHeadingPermission = "unsupported" | "prompt" | "granted" | "denied";

export interface DeviceHeadingState {
  heading: number | null;
  permission: DeviceHeadingPermission;
  live: boolean;
  message: string | null;
  requestPermission: () => Promise<boolean>;
}

type OrientEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

function needsIosPermission(): boolean {
  return (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission === "function"
  );
}

export function useDeviceHeading(enabled = true): DeviceHeadingState {
  const [heading, setHeading] = useState<number | null>(null);
  const [permission, setPermission] = useState<DeviceHeadingPermission>("prompt");
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const handlerRef = useRef<(event: Event) => void>(() => {});

  const attach = useCallback(() => {
    if (typeof window === "undefined") return;
    const onOrient = (event: Event) => {
      const parsed = headingFromOrientationEvent(event as OrientEvent);
      if (parsed == null) return;
      setHeading(parsed);
      setLive(true);
      setMessage(null);
    };
    handlerRef.current = onOrient;
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
  }, []);

  const detach = useCallback(() => {
    if (typeof window === "undefined") return;
    const handler = handlerRef.current;
    window.removeEventListener("deviceorientationabsolute", handler, true);
    window.removeEventListener("deviceorientation", handler, true);
  }, []);

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

  return { heading, permission, live, message, requestPermission };
}
