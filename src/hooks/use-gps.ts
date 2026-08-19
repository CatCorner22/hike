"use client";

import { useEffect, useRef, useState } from "react";
import { getLastFix, saveLastFix } from "@/lib/offline/route-pack";

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  altitude?: number;
  recordedAt: number;
  stale: boolean;
}

export interface GpsState {
  fix: GpsFix | null;
  status: "acquiring" | "live" | "stale" | "denied" | "unavailable";
  message: string | null;
}

const STALE_MS = 20_000;

export function useGps() {
  const [state, setState] = useState<GpsState>({
    fix: null,
    status: "acquiring",
    message: "Waiting for a GPS fix. Stay outdoors with a clear view of the sky.",
  });
  const watchIdRef = useRef<number | null>(null);
  const lastFixRef = useRef<GpsFix | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!("geolocation" in navigator)) {
      setState({
        fix: null,
        status: "unavailable",
        message: "This device has no GPS. Navigation is map-only.",
      });
      return;
    }

    void getLastFix().then((stored) => {
      if (cancelled || !stored || lastFixRef.current) return;
      const fix: GpsFix = {
        lat: stored.lat,
        lng: stored.lng,
        accuracy: stored.accuracy,
        heading: stored.heading,
        recordedAt: new Date(stored.recordedAt).getTime(),
        stale: true,
      };
      lastFixRef.current = fix;
      setState({
        fix,
        status: "stale",
        message: "Showing last known position until a live GPS fix arrives.",
      });
    });

    const applyFix = (position: GeolocationPosition) => {
      const heading =
        position.coords.heading != null && Number.isFinite(position.coords.heading)
          ? position.coords.heading
          : lastFixRef.current?.heading;
      const fix: GpsFix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading,
        altitude: position.coords.altitude ?? undefined,
        recordedAt: position.timestamp || Date.now(),
        stale: false,
      };
      lastFixRef.current = fix;
      void saveLastFix(fix);
      setState({
        fix,
        status: "live",
        message:
          position.coords.accuracy > 25
            ? "GPS accuracy is poor. Use the trail line and off-route warning as a check, not a guarantee."
            : null,
      });
    };

    const onError = (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) {
        setState((prev) => ({
          ...prev,
          status: "denied",
          message:
            "Location permission is off. Enable it in the browser to see your position. The downloaded route remains on the map.",
        }));
        return;
      }
      setState((prev) => ({
        ...prev,
        status: prev.fix ? "stale" : "acquiring",
        message: prev.fix
          ? "GPS signal lost. Holding last known position."
          : "Still waiting for GPS. Move to open sky if you can.",
      }));
    };

    watchIdRef.current = navigator.geolocation.watchPosition(applyFix, onError, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 20000,
    });

    const staleTimer = window.setInterval(() => {
      const current = lastFixRef.current;
      if (!current || current.stale) return;
      if (Date.now() - current.recordedAt > STALE_MS) {
        lastFixRef.current = { ...current, stale: true };
        setState((prev) => ({
          ...prev,
          fix: lastFixRef.current,
          status: "stale",
          message: "GPS has gone stale. Holding last known position.",
        }));
      }
    }, 5000);

    return () => {
      cancelled = true;
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      window.clearInterval(staleTimer);
    };
  }, []);

  return state;
}
