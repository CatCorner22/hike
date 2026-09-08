"use client";

import { useEffect, useRef, useState } from "react";
import { haversineMeters as sharedHaversineMeters } from "@/lib/geo/coords";
import { getLastFix, saveLastFix } from "@/lib/offline/route-pack";
import { startGeoWatch } from "@/lib/platform/geolocation";
import { geoWatchTuning, type PowerMode } from "@/lib/safety/power-reserve";
import { getPlatformAdapters } from "@/lib/platform/adapters";
import {
  isClockSuspectFix,
  isTrustedFix,
  isValidLatLng,
  sanitizeFixTimestamp,
  sanitizeStoredFixTimestamp,
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
/** Writing every fix hammers IndexedDB at up to 1 Hz for the whole hike. */
const SAVE_FIX_EVERY_MS = 10_000;
/** Location permission can be granted mid-hike, so a denial must not be permanent. */
const DENIED_RETRY_MS = 30_000;

/**
 * `mode` is the hiker's own power choice. Passing it here rather than reading a
 * global keeps the watch a pure function of what they asked for, and makes the
 * re-subscribe on change fall out of the effect's dependency list.
 */
export function useGps(mode: PowerMode = "full") {
  const [state, setState] = useState<GpsState>({
    fix: null,
    status: "acquiring",
    message: "Waiting for a GPS fix. Stay outdoors with a clear view of the sky.",
  });
  const stopWatchRef = useRef<(() => void) | null>(null);
  const lastFixRef = useRef<GpsFix | null>(null);
  const lastCallbackRef = useRef(0);
  const deniedRef = useRef(false);
  const deniedSinceRef = useRef(0);
  const lastSavedFixAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    lastCallbackRef.current = Date.now();

    // Through the platform seam: the shell registers a native watcher, so the
    // web-API absence check applies only when no adapter is present.
    if (!getPlatformAdapters().geolocation && !("geolocation" in navigator)) {
      queueMicrotask(() => {
        if (!cancelled) setState({
          fix: null,
          status: "unavailable",
          message: "This device has no GPS. Navigation is map-only.",
        });
      });
      return;
    }

    void getLastFix().then((stored) => {
      if (cancelled || deniedRef.current || !stored || lastFixRef.current) return;
      if (!isValidLatLng(stored.lat, stored.lng)) return;
      const recordedAt = sanitizeStoredFixTimestamp(new Date(stored.recordedAt).getTime());
      if (recordedAt == null) return;
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
      deniedRef.current = false;
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

      const recordedAt = sanitizeFixTimestamp(position.timestamp);
      const clockSuspect = isClockSuspectFix();
      const fix: GpsFix = {
        lat,
        lng,
        accuracy:
          position.coords.accuracy != null && Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : undefined,
        heading,
        altitude,
        recordedAt,
        stale: clockSuspect,
      };
      lastFixRef.current = fix;
      const nowMs = Date.now();
      if (nowMs - lastSavedFixAtRef.current >= SAVE_FIX_EVERY_MS) {
        lastSavedFixAtRef.current = nowMs;
        void saveLastFix(fix);
      }
      setState({
        fix,
        status: clockSuspect ? "stale" : "live",
        message: clockSuspect
          ? "GPS clock on this reading is invalid. Position is shown but not trusted for alerts."
          : (fix.accuracy ?? 0) > 25
            ? "GPS accuracy is poor. Use the trail line and off-route warning as a check, not a guarantee."
            : null,
      });
    };

    const onError = (error: GeolocationPositionError) => {
      lastCallbackRef.current = Date.now();
      if (error.code === error.PERMISSION_DENIED) {
        deniedRef.current = true;
        if (lastFixRef.current) {
          // A hiker must not see the last coordinate as a current GPS position after permission is revoked.
          lastFixRef.current = { ...lastFixRef.current, stale: true };
        }
        deniedSinceRef.current = Date.now();
        setState({
          fix: lastFixRef.current,
          status: "denied",
          message:
            "Location permission is off. Enable it in the browser to see your position. The downloaded route remains on the map.",
        });
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
      stopWatchRef.current?.();
      // Background, not foreground. The old comment here said the navigate
      // screen's wake lock keeps fixes arriving — but a wake lock only stops the
      // screen sleeping on its own. Press the power button, switch apps, or drop
      // the phone in a pocket and iOS suspends a foreground-only watcher: the
      // breadcrumb stops, off-route alerting stops, and the check-in timer stops,
      // all silently, while the header still reads "Breadcrumb: saved · N fixes".
      // A hiker pocketing their phone is the normal case, not an edge case.
      stopWatchRef.current = startGeoWatch(applyFix, onError, {
        background: true,
        ...geoWatchTuning(mode),
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

    let permissionStatus: PermissionStatus | null = null;
    const onPermissionChange = () => {
      if (cancelled || permissionStatus?.state === "denied") return;
      deniedRef.current = false;
      startWatch();
    };
    void navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        permissionStatus = status;
        status.addEventListener("change", onPermissionChange);
      })
      .catch(() => {
        /* Permissions API unavailable — the watchdog retry below still covers it. */
      });

    const watchdog = window.setInterval(() => {
      if (cancelled) return;
      if (deniedRef.current) {
        // Permission can be granted from browser settings mid-hike; re-arm periodically
        // so recovering does not require a page reload.
        if (Date.now() - deniedSinceRef.current < DENIED_RETRY_MS) return;
        deniedSinceRef.current = Date.now();
        startWatch();
        return;
      }
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
      stopWatchRef.current?.();
      stopWatchRef.current = null;
      permissionStatus?.removeEventListener("change", onPermissionChange);
      window.clearInterval(staleTimer);
      window.clearInterval(watchdog);
    };
    // Changing power mode re-subscribes the watch, which is the only way the
    // platform learns the new accuracy request. Everything the effect owns is
    // torn down and rebuilt, so a mode change cannot leave two watchers running.
  }, [mode]);

  return state;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return sharedHaversineMeters({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
}

function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
