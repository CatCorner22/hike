"use client";

import { useEffect, useRef, useState } from "react";
import { getLastFix, saveLastFix } from "@/lib/offline/route-pack";
import { DISPLAY_FIX_MS, isTrustedFix } from "@/lib/safety/gps-quality";

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
      const recordedAt = new Date(stored.recordedAt).getTime();
      if (Date.now() - recordedAt > DISPLAY_FIX_MS) return;
      const fix: GpsFix = {
        lat: stored.lat,
        lng: stored.lng,
        accuracy: stored.accuracy,
        heading: stored.heading,
        recordedAt,
        stale: true,
      };
      lastFixRef.current = fix;
      setState({
        fix,
        status: "stale",
        message: "Showing last known position until a live GPS fix arrives. Do not treat this as your current location.",
      });
    });

    const applyFix = (position: GeolocationPosition) => {
      const prev = lastFixRef.current;
      let heading =
        position.coords.heading != null && Number.isFinite(position.coords.heading)
          ? position.coords.heading
          : undefined;

      if (
        heading == null &&
        prev &&
        isTrustedFix(prev.recordedAt, prev.stale)
      ) {
        const moved = haversineMeters(
          prev.lat,
          prev.lng,
          position.coords.latitude,
          position.coords.longitude,
        );
        if (moved >= 12) {
          heading = bearingDegrees(
            prev.lat,
            prev.lng,
            position.coords.latitude,
            position.coords.longitude,
          );
        } else if (prev.heading != null) {
          heading = prev.heading;
        }
      }

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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
