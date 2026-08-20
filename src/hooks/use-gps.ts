"use client";

import { useEffect, useRef, useState } from "react";
import { getLastFix, saveLastFix } from "@/lib/offline/route-pack";
import {
  DISPLAY_FIX_MS,
  isTrustedFix,
  isValidLatLng,
  sanitizeFixTimestamp,
} from "@/lib/safety/gps-quality";

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
const WATCHDOG_MS = 25_000;

export function useGps() {
  const [state, setState] = useState<GpsState>({
    fix: null,
    status: "acquiring",
    message: "Waiting for a GPS fix. Stay outdoors with a clear view of the sky.",
  });
  const watchIdRef = useRef<number | null>(null);
  const lastFixRef = useRef<GpsFix | null>(null);
  const lastCallbackRef = useRef(Date.now());
  const deniedRef = useRef(false);

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
      if (cancelled || deniedRef.current || !stored || lastFixRef.current) return;
      if (!isValidLatLng(stored.lat, stored.lng)) return;
      const recordedAt = new Date(stored.recordedAt).getTime();
      if (!Number.isFinite(recordedAt) || recordedAt < 1e12) return;
      if (Date.now() - recordedAt > DISPLAY_FIX_MS) return;
      const fix: GpsFix = {
        lat: stored.lat,
        lng: stored.lng,
        accuracy: Number.isFinite(stored.accuracy) ? stored.accuracy : undefined,
        heading: Number.isFinite(stored.heading) ? stored.heading : undefined,
        altitude: Number.isFinite(stored.altitude) ? stored.altitude : undefined,
        recordedAt,
        stale: true,
      };
      lastFixRef.current = fix;
      setState({
        fix,
        status: "stale",
        message:
          "Showing last known position until a live GPS fix arrives. Do not treat this as your current location.",
      });
    });

    const applyFix = (position: GeolocationPosition) => {
      lastCallbackRef.current = Date.now();
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      if (!isValidLatLng(lat, lng)) return;

      const prev = lastFixRef.current;
      let heading =
        position.coords.heading != null && Number.isFinite(position.coords.heading)
          ? position.coords.heading
          : undefined;

      if (heading == null && prev && isTrustedFix(prev.recordedAt, prev.stale)) {
        const moved = haversineMeters(prev.lat, prev.lng, lat, lng);
        if (moved >= 12) {
          heading = bearingDegrees(prev.lat, prev.lng, lat, lng);
        } else if (prev.heading != null) {
          heading = prev.heading;
        }
      }

      const altitude =
        position.coords.altitude != null && Number.isFinite(position.coords.altitude)
          ? position.coords.altitude
          : undefined;

      const fix: GpsFix = {
        lat,
        lng,
        accuracy:
          position.coords.accuracy != null && Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : undefined,
        heading,
        altitude,
        recordedAt: sanitizeFixTimestamp(position.timestamp),
        stale: false,
      };
      lastFixRef.current = fix;
      void saveLastFix(fix);
      setState({
        fix,
        status: "live",
        message:
          (fix.accuracy ?? 0) > 25
            ? "GPS accuracy is poor. Use the trail line and off-route warning as a check, not a guarantee."
            : null,
      });
    };

    const onError = (error: GeolocationPositionError) => {
      lastCallbackRef.current = Date.now();
      if (error.code === error.PERMISSION_DENIED) {
        deniedRef.current = true;
        if (lastFixRef.current) {
          lastFixRef.current = { ...lastFixRef.current, stale: true };
        }
        setState((prev) => ({
          fix: lastFixRef.current,
          status: "denied",
          message:
            "Location permission is off. Enable it in the browser to see your position. The downloaded route remains on the map.",
        }));
        return;
      }
      if (lastFixRef.current) {
        lastFixRef.current = { ...lastFixRef.current, stale: true };
      }
      setState((prev) => ({
        fix: lastFixRef.current ?? prev.fix,
        status: prev.fix || lastFixRef.current ? "stale" : "acquiring",
        message: prev.fix || lastFixRef.current
          ? "GPS signal lost. Holding last known position."
          : "Still waiting for GPS. Move to open sky if you can.",
      }));
    };

    const startWatch = () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = navigator.geolocation.watchPosition(applyFix, onError, {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 20000,
      });
    };

    startWatch();

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

    const watchdog = window.setInterval(() => {
      if (cancelled || deniedRef.current) return;
      if (Date.now() - lastCallbackRef.current < WATCHDOG_MS) return;
      lastCallbackRef.current = Date.now();
      startWatch();
      setState((prev) => ({
        ...prev,
        status: prev.fix ? "stale" : "acquiring",
        message: prev.fix
          ? "GPS watch restarted after silence. Holding last known position."
          : "Still waiting for GPS. Restarted location watch.",
      }));
    }, 10_000);

    return () => {
      cancelled = true;
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      window.clearInterval(staleTimer);
      window.clearInterval(watchdog);
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
