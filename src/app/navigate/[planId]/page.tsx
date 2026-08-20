"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Compass, MapPin, Moon, Mountain, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SafetyNavMap } from "@/components/map/safety-nav-map";
import { SafetyPanel } from "@/components/offline/safety-panel";
import { ReadinessGate } from "@/components/offline/readiness-gate";
import { SosBeacon } from "@/components/offline/sos-beacon";
import { useBatteryStatus } from "@/hooks/use-battery-status";
import { useBatteryWarning } from "@/hooks/use-battery-warning";
import { useGps } from "@/hooks/use-gps";
import { formatDistance, formatElevation } from "@/lib/geo";
import {
  compassLabel,
  gpsAccuracyLabel,
  normalizeHeading,
  travelDirectionAlong,
  type TrailProgress,
} from "@/lib/geo/navigation";
import { parseNavigateTarget } from "@/lib/ids";
import {
  isLikelyOffline,
  loadCachedRoutePack,
  packFromPlanApi,
  packFromTrailApi,
  persistRoutePack,
  withNetworkTimeout,
} from "@/lib/offline/load-route-pack";
import { warmNavigateShell } from "@/lib/offline/navigate-shell";
import { appendNavPoint, getNavSession, startNavSession } from "@/lib/offline/nav-track";
import type { RoutePack } from "@/lib/offline/route-pack";
import {
  createRouteProgressCache,
  progressWithRouteCache,
  type RouteProgressCache,
} from "@/lib/offline/progress-cache";
import { requestWakeLock, releaseWakeLock, isWakeLockHeld } from "@/lib/offline/wake-lock";
import { hikeReadiness } from "@/lib/safety/readiness";
import { copyEmergencyInfo, emergencyMessage } from "@/lib/safety/emergency";
import { offTrailLevel, shouldRepeatAlert, vibrateOffTrail } from "@/lib/safety/alerts";
import {
  backtrackProgress,
  gainLastHourM,
  rapidAscentWarning,
  reverseTrackLine,
  stationaryMinutes,
} from "@/lib/safety/backtrack";
import {
  checkinStatus,
  getCheckinSettings,
  lastCheckin,
} from "@/lib/safety/checkin";
import { moonPhase } from "@/lib/safety/astro";
import { altitudeFromProfile } from "@/lib/safety/altitude";
import { slopeAnglesFromProfile } from "@/lib/safety/avalanche";
import { formatWalkBearing, gmAngleCard, isFixNearRouteBbox, turnaroundWarning } from "@/lib/safety/declination";
import { daylightStatus } from "@/lib/safety/daylight";
import { formatFixAge, isTrustedFix } from "@/lib/safety/gps-quality";
import {
  getIceProfile,
  getOverdueAlarm,
  listWaypoints,
  overdueStatus,
  type SafetyWaypoint,
} from "@/lib/safety/profile";
import { hypothermiaWarning, suddenStopWarning, waterReminder } from "@/lib/safety/field";
import { formatNaismith, gpsAnomalyWarning, naismithMinutes, slopeFromProfile, slopeWarning } from "@/lib/safety/field-ops";
import { commsWindowReminder, buddySeparationWarning } from "@/lib/safety/sar-advanced";
import { sereAssessment } from "@/lib/safety/sere";
import { amsAssessment, avalancheTerrainWarning } from "@/lib/safety/wilderness";
import type { PositionSource } from "@/lib/safety/emergency";
import { deadReckon, deadReckonUncertaintyM, distanceFromPaces, formatZulu } from "@/lib/safety/landnav";
import { formatUsng } from "@/lib/safety/usng";
import * as turf from "@turf/turf";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; pack: RoutePack; source: "cache" | "network" }
  | { status: "error"; message: string };

function trailheadPoint(geometry: GeoJSON.LineString | GeoJSON.MultiLineString) {
  const coords =
    geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.coordinates.find((line) => line.length >= 2) ?? [];
  if (coords.length < 1) return null;
  return { lng: coords[0][0], lat: coords[0][1] };
}

export default function NavigatePage() {
  const params = useParams<{ planId: string }>();
  const navId = params.planId;

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [progress, setProgress] = useState<TrailProgress | null>(null);
  const [headingUp, setHeadingUp] = useState(true);
  const [exitArmed, setExitArmed] = useState(false);
  const [backtrackOn, setBacktrackOn] = useState(false);
  const [beaconOn, setBeaconOn] = useState(false);
  const [waypoints, setWaypoints] = useState<SafetyWaypoint[]>([]);
  const [trackPoints, setTrackPoints] = useState<
    Array<{ lat: number; lng: number; altitude?: number; recordedAt: string }>
  >([]);
  const [overdueBanner, setOverdueBanner] = useState<string | null>(null);
  const [nightMode, setNightMode] = useState<"off" | "red" | "nvg">("off");
  const [goto, setGoto] = useState<{ lat: number; lng: number } | null>(null);
  const [searchOverlay, setSearchOverlay] = useState<GeoJSON.LineString | null>(null);
  const [zulu, setZulu] = useState(formatZulu());
  // One ticking clock for everything time-derived in render. Reading Date.now()
  // straight from a useMemo is impure and, worse, freezes whatever it feeds as soon as
  // its other dependencies stop changing (daylight froze when GPS dropped).
  const [nowMs, setNowMs] = useState(0);
  const [lastDrinkAt, setLastDrinkAt] = useState<number | null>(null);
  const [lastCommsAt, setLastCommsAt] = useState<number | null>(null);
  const [checkinSettings, setCheckinSettings] = useState({ enabled: false, intervalMin: 60 });
  const [lastCheckinAt, setLastCheckinAt] = useState<string | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [deniedAnchor, setDeniedAnchor] = useState<{
    lat: number;
    lng: number;
    heading: number;
    at: number;
  } | null>(null);
  const [deniedPaces, setDeniedPaces] = useState(0);
  const [deniedPaceLen, setDeniedPaceLen] = useState(65);
  const [deniedHeadingText, setDeniedHeadingText] = useState("");
  const [deniedNeedHeading, setDeniedNeedHeading] = useState(false);
  const [navUnlocked, setNavUnlocked] = useState(false);
  // Items the hiker chose to skip on the pre-hike checklist. Kept so navigation
  // can keep showing them: skipping must not silently drop the safety net.
  const [readinessSkipped, setReadinessSkipped] = useState<string[]>([]);
  const [wakeHeld, setWakeHeld] = useState(false);
  const [deniedError, setDeniedError] = useState<string | null>(null);
  const [refreshingPack, setRefreshingPack] = useState(false);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const lastAlertRef = useRef<number | null>(null);
  const progressCacheRef = useRef<RouteProgressCache | null>(null);
  const pendingPointsRef = useRef<
    Array<{
      lat: number;
      lng: number;
      accuracy?: number;
      altitude?: number;
      recordedAt: number;
    }>
  >([]);

  const gps = useGps();

  useEffect(() => {
    const tick = () => {
      setZulu(formatZulu());
      setNowMs(Date.now());
    };
    const initial = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 15000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, []);

  // The header overlay grows and shrinks as warning banners appear, so measure
  // it and let the map inset its orientation labels below it.
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      // Use the border box (contentRect excludes the header's padding, which is
      // substantial here) and add a small gap so labels clear the banner edge.
      const height =
        entry?.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight ?? 0;
      if (Number.isFinite(height) && height > 0) {
        const next = Math.round(height) + 8;
        setHeaderHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
    // navUnlocked matters: the header does not mount while the readiness
    // checklist is showing, so with only loadState.status here the ref was
    // still null when the effect ran and the header was never measured.
    // headerHeight stayed 0, which silently disabled both the map label inset
    // and the banner offset -- a banner then covered the USNG grid reference.
  }, [loadState.status, navUnlocked]);

  useEffect(() => {
    let cancelled = false;
    async function refreshCheckin() {
      const [settings, last] = await Promise.all([getCheckinSettings(), lastCheckin(navId)]);
      if (cancelled) return;
      setCheckinSettings(settings);
      setLastCheckinAt(last?.recordedAt ?? null);
    }
    void refreshCheckin();
    const id = window.setInterval(() => void refreshCheckin(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [navId]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`hike-drink-${navId}`);
      if (raw) {
        const t = Number(raw);
        if (Number.isFinite(t)) queueMicrotask(() => setLastDrinkAt(t));
      }
      const comms = sessionStorage.getItem(`hike-comms-${navId}`);
      if (comms) {
        const t = Number(comms);
        if (Number.isFinite(t)) queueMicrotask(() => setLastCommsAt(t));
      }
    } catch {
      /* private mode */
    }
  }, [navId]);
  const batteryWarning = useBatteryWarning();
  const battery = useBatteryStatus();
  const gpsTrusted = Boolean(gps.fix && isTrustedFix(gps.fix.recordedAt, gps.fix.stale));

  const drFix = useMemo(() => {
    if (!gpsDenied || !deniedAnchor || deniedPaces <= 0) return null;
    const meters = distanceFromPaces(deniedPaces, deniedPaceLen);
    if (!Number.isFinite(meters) || meters <= 0) return null;
    // Do not advance a denied-GPS fix from elapsed time: a guessed walking speed
    // would invent a current coordinate that can be mistaken for a live position.
    const point = deadReckon(deniedAnchor, deniedAnchor.heading, meters);
    return { ...point, heading: deniedAnchor.heading, meters };
  }, [gpsDenied, deniedAnchor, deniedPaces, deniedPaceLen]);

  const trusted = gpsDenied ? Boolean(drFix) : gpsTrusted;
  const navFix = gpsDenied && drFix ? drFix : gps.fix;
  const positionSource: PositionSource =
    gpsDenied && drFix ? "deadReckon" : gpsTrusted ? "gps" : "lastKnown";

  const resolveDeniedHeading = useCallback((): number | null => {
    const live = gps.fix?.heading;
    if (live != null && Number.isFinite(live)) return ((live % 360) + 360) % 360;
    const typed = Number(deniedHeadingText);
    if (Number.isFinite(typed)) return ((typed % 360) + 360) % 360;
    return null;
  }, [gps.fix?.heading, deniedHeadingText]);

  /**
   * Dead reckoning needs a real heading. `heading` is null whenever the device is not
   * moving (and often on iOS Safari), and defaulting it to 0 silently walks the hiker
   * due north on the map regardless of which way they go.
   */
  const toggleDeadReckoning = useCallback(() => {
    setDeniedError(null);
    if (gpsDenied) {
      setGpsDenied(false);
      setDeniedAnchor(null);
      setDeniedPaces(0);
      setDeniedNeedHeading(false);
      return;
    }
    const fix = gps.fix;
    if (!fix || !gpsTrusted) {
      setDeniedError("Need a live GPS fix to anchor dead reckoning.");
      return;
    }
    const heading = resolveDeniedHeading();
    if (heading == null) {
      setDeniedNeedHeading(true);
      setDeniedError("No heading yet — walk a few paces in your intended direction, then arm DR. Dead reckoning cannot guess which way you are facing.");
      return;
    }
    setDeniedNeedHeading(false);
    setDeniedAnchor({ lat: fix.lat, lng: fix.lng, heading, at: Date.now() });
    setDeniedPaces(0);
    setGpsDenied(true);
  }, [gpsDenied, gps.fix, gpsTrusted, resolveDeniedHeading]);

  const loadPack = useCallback(async (options: { forceNetwork?: boolean } = {}) => {
    let terminal = false;
    const complete = (next: LoadState) => {
      if (terminal) return;
      terminal = true;
      setLoadState(next);
    };
    if (!options.forceNetwork) setLoadState({ status: "loading" });
    const timeout = window.setTimeout(() => complete({
      status: "error",
      message: "Route loading timed out. Do not navigate from a loading screen; re-download this matching trail while you have signal.",
    }), 12_000);
    let cached: RoutePack | null = null;
    try {
      try {
        cached = await loadCachedRoutePack(navId);
      } catch (error) {
        complete({ status: "error", message: error instanceof Error ? error.message : "Saved route does not match this trail — re-download while you have signal." });
        return;
      }
      // Cache wins by default; a manual refresh never removes a working route.
      if (cached && !options.forceNetwork) {
        complete({ status: "ready", pack: cached, source: "cache" });
        return;
      }
      if (!cached && isLikelyOffline()) {
        complete({
          status: "error",
          message: "No offline route pack and no network. Open the trail on Wi‑Fi and tap Prepare offline first.",
        });
        return;
      }
      const target = parseNavigateTarget(navId);
      if (!target) {
        if (cached) complete({ status: "ready", pack: cached, source: "cache" });
        else complete({ status: "error", message: "Invalid route id. Open the trail or plan and tap Prepare offline first." });
        return;
      }
      try {
        if (target.kind === "trail") {
          const res = await withNetworkTimeout((signal) => fetch(`/api/trails/${target.id}`, { signal }), 8000);
          if (!res.ok) throw new Error("Trail not found on server");
          const pack = await persistRoutePack(packFromTrailApi(navId, await res.json()));
          complete({ status: "ready", pack, source: "network" });
          return;
        }
        const planRes = await withNetworkTimeout((signal) => fetch(`/api/plans/${target.id}`, { signal }), 8000);
        if (!planRes.ok) throw new Error("Plan not found on server");
        const plan = await planRes.json();
        let trail = null;
        if (plan.trailId) {
          const trailRes = await withNetworkTimeout((signal) => fetch(`/api/trails/${plan.trailId}`, { signal }), 8000);
          if (trailRes.ok) trail = await trailRes.json();
        }
        const built = packFromPlanApi(navId, plan, trail);
        if (!built) throw new Error("Plan has no route geometry");
        complete({ status: "ready", pack: await persistRoutePack(built), source: "network" });
      } catch (error) {
        let retry = cached;
        if (!retry) {
          try { retry = await loadCachedRoutePack(navId, { retries: 5, retryMs: 400 }); } catch { /* report network error below */ }
        }
        if (retry) complete({ status: "ready", pack: retry, source: "cache" });
        else complete({ status: "error", message: error instanceof Error ? `${error.message}. Prepare offline on Wi‑Fi before you lose service.` : "Route unavailable offline. Prepare offline before heading out." });
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }, [navId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadPack(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadPack]);

  // This covers a first online navigation visit before the newly registered
  // service worker has controlled the document. It is intentionally
  // best-effort; Prepare offline remains the pre-departure guarantee.
  useEffect(() => {
    if (navigator.onLine) void warmNavigateShell(navId);
  }, [navId]);

  useEffect(() => {
    void requestWakeLock();
    const id = window.setInterval(() => setWakeHeld(isWakeLockHeld()), 4000);
    queueMicrotask(() => setWakeHeld(isWakeLockHeld()));
    return () => {
      window.clearInterval(id);
      void releaseWakeLock();
    };
  }, []);

  const unlockIfReady = useCallback(() => {
    void (async () => {
      const [profile, alarm] = await Promise.all([getIceProfile(), getOverdueAlarm()]);
      const result = hikeReadiness({
        packReady: true,
        profile,
        returnAt: alarm?.returnAt ?? null,
      });
      if (result.ok) setNavUnlocked(true);
    })();
  }, []);

  // Which end of the route the hiker is actually walking toward. The stored line
  // direction is arbitrary, so without this "Remaining" counts up as you approach your
  // destination. Recomputed from the breadcrumb track, not on every fix.
  const travelDirection = useMemo(() => {
    if (loadState.status !== "ready") return "unknown" as const;
    return travelDirectionAlong(
      loadState.pack.geometry,
      trackPoints.map((point) => ({ lat: point.lat, lng: point.lng })),
    );
  }, [loadState, trackPoints]);

  useEffect(() => {
    if (loadState.status !== "ready" || !navFix || !trusted) {
      if (!trusted) queueMicrotask(() => setProgress(null));
      return;
    }
    if (!progressCacheRef.current || progressCacheRef.current.packId !== loadState.pack.id) {
      progressCacheRef.current = createRouteProgressCache(loadState.pack);
    }
    // The cached path must receive direction so its remaining-distance calculation
    // stays identical to progressAlongTrail and cannot reverse the turnaround warning.
    const p = progressWithRouteCache(
      progressCacheRef.current,
      { lat: navFix.lat, lng: navFix.lng },
      travelDirection,
    );
    queueMicrotask(() => setProgress(p));
  }, [navFix, loadState, trusted, travelDirection]);

  const activePack = loadState.status === "ready" ? loadState.pack : null;

  useEffect(() => {
    if (!activePack) return;
    let cancelled = false;

    sessionIdRef.current = null;
    void startNavSession(navId, activePack.name).then((id) => {
      if (cancelled) return;
      sessionIdRef.current = id;
      const queued = pendingPointsRef.current;
      pendingPointsRef.current = [];
      for (const point of queued) {
        void appendNavPoint(id, point);
      }
    });

    return () => {
      cancelled = true;
      sessionIdRef.current = null;
    };
  }, [activePack, navId]);

  useEffect(() => {
    if (!gps.fix || loadState.status !== "ready" || !gpsTrusted) return;
    const point = {
      lat: gps.fix.lat,
      lng: gps.fix.lng,
      accuracy: gps.fix.accuracy,
      altitude: gps.fix.altitude,
      recordedAt: gps.fix.recordedAt,
    };
    if (!sessionIdRef.current) {
      pendingPointsRef.current.push(point);
      return;
    }
    void appendNavPoint(sessionIdRef.current, point);
  }, [gps.fix, loadState.status, gpsTrusted]);

  // Gate on gpsTrusted, not `trusted`: in GPS-denied mode `trusted` only means "we have
  // something to draw". Alerting off a dead-reckoned position raises warnings against a
  // track the hiker never walked.
  const severity = useMemo(() => {
    if (!progress) return "unknown" as const;
    return offTrailLevel(progress.offsetMeters, gps.fix?.accuracy, {
      trustedFix: gpsTrusted,
    });
  }, [progress, gps.fix?.accuracy, gpsTrusted]);

  // `severity` is a string, so an effect keyed only on it runs once and never again
  // while you stay off-trail. shouldRepeatAlert enforces the 12 s / 30 s cadence, so
  // poll it on a timer for as long as the alert stands.
  useEffect(() => {
    if (severity === "unknown" || severity === "ok") return;
    const fire = () => {
      if (shouldRepeatAlert(lastAlertRef.current, severity)) {
        vibrateOffTrail(severity);
        lastAlertRef.current = Date.now();
      }
    };
    fire();
    const id = window.setInterval(fire, 4000);
    return () => window.clearInterval(id);
  }, [severity]);

  const exitHref = useMemo(() => {
    if (loadState.status !== "ready") return "/";
    const target = parseNavigateTarget(loadState.pack.id);
    if (!target) return "/";
    return target.kind === "trail" ? `/trails/${target.id}` : `/plan/${target.id}`;
  }, [loadState]);

  const bearingToStart = useMemo(() => {
    if (loadState.status !== "ready" || !navFix || !trusted) return undefined;
    const start = trailheadPoint(loadState.pack.geometry);
    if (!start) return undefined;
    return normalizeHeading(
      turf.bearing(
        turf.point([navFix.lng, navFix.lat]),
        turf.point([start.lng, start.lat]),
      ),
    );
  }, [navFix, loadState, trusted]);

  const daylight = useMemo(() => {
    const lat =
      navFix?.lat ??
      (loadState.status === "ready"
        ? (loadState.pack.bbox[1] + loadState.pack.bbox[3]) / 2
        : null);
    const lng =
      navFix?.lng ??
      (loadState.status === "ready"
        ? (loadState.pack.bbox[0] + loadState.pack.bbox[2]) / 2
        : null);
    if (lat == null || lng == null || nowMs === 0) return null;
    return daylightStatus(new Date(nowMs), lat, lng);
  }, [navFix, loadState, nowMs]);

  const turnaround = useMemo(() => {
    if (!trusted || !progress || !daylight) return null;
    return turnaroundWarning(
      progress.remainingMeters,
      progress.remainingElevationMeters,
      daylight.minutesUntilSunset,
      daylight.isDark,
    );
  }, [trusted, progress, daylight]);

  const stillMin = useMemo(
    () => (gpsTrusted ? stationaryMinutes(trackPoints) : 0),
    [gpsTrusted, trackPoints],
  );
  const ascentWarning = useMemo(
    () => (gpsTrusted ? rapidAscentWarning(trackPoints) : null),
    [gpsTrusted, trackPoints],
  );
  const stillWarning =
    stillMin >= 20 ? `No movement for ${stillMin} min. If you are hurt, open SOS.` : null;
  const exposureWarning = hypothermiaWarning({
    isDark: Boolean(daylight?.isDark),
    altitudeM: gps.fix?.altitude,
    stationaryMin: stillMin,
  });
  const fallWarning = gpsTrusted ? suddenStopWarning(trackPoints) : null;
  const hikeStartedAt = trackPoints[0] ? Date.parse(trackPoints[0].recordedAt) : null;
  const hydrateWarning = waterReminder(lastDrinkAt, hikeStartedAt);
  const moon = useMemo(() => { void zulu; return moonPhase(); }, [zulu]);
  const moonWarning = daylight?.isDark ? moon.nightNav : null;
  // A dead-reckoned position drifts with every metre walked. Quote an error radius so
  // the grid below is not read as a surveyed fix.
  const drErrorM = drFix ? Math.max(25, Math.round(drFix.meters * 0.1)) : null;
  const deniedWarning = gpsDenied
    ? !drFix
      ? "GPS DENIED — dead-reckoned position is unavailable until you record paced distance. Do not use this screen as a current location."
      : `GPS DENIED — dead reckon ${Math.round(drFix.meters)} m on ${Math.round(drFix.heading)}°${drErrorM != null ? `, estimated ±${drErrorM} m and growing` : ""}.`
    : deniedNeedHeading
      ? "Need a compass heading or typed bearing before GPS-denied dead reckon."
      : !gpsTrusted && gps.fix
        ? `GPS untrusted — last known ${formatFixAge(gps.fix.recordedAt)}. Display only; not used for off-trail or SOS as live.`
        : deniedError;
  const sereWarning = sereAssessment({
    isDark: Boolean(daylight?.isDark),
    altitudeM: gps.fix?.altitude,
    stationaryMin: stillMin,
    hasSignal: gpsTrusted,
  });
  const gpsSpoof = gpsTrusted ? gpsAnomalyWarning(trackPoints) : null;
  const buddyWarn =
    trusted && navFix ? buddySeparationWarning({ lat: navFix.lat, lng: navFix.lng }, waypoints) : null;
  const commsWarn = lastCommsAt != null ? commsWindowReminder(lastCommsAt) : null;
  const slopePct =
    loadState.status === "ready" && progress
      ? slopeFromProfile(loadState.pack.elevationProfile, progress.traveledMeters)
      : null;
  const slopeWarn = slopePct != null ? slopeWarning(slopePct) : null;
  const routeProfileWarnings = useMemo(() => {
    if (loadState.status !== "ready") return { altitude: null, avalanche: null };
    const altitude = altitudeFromProfile(loadState.pack.elevationProfile);
    const slopes = slopeAnglesFromProfile(loadState.pack.elevationProfile);
    return {
      altitude:
        altitude == null || altitude.maxElevationM < 2500
          ? null
          : altitude.crosses3000
            ? `Route altitude screen: profile crosses 3,000 m (maximum ${Math.round(altitude.maxElevationM)} m). Plan acclimatization and do not ascend with symptoms.`
            : `Route altitude screen: profile reaches ${Math.round(altitude.maxElevationM)} m, crossing 2,500 m. Watch for altitude symptoms and allow time to acclimatize.`,
      avalanche:
        slopes != null && slopes.maxAngleDeg >= 30 && slopes.maxAngleDeg <= 45
          ? `Avalanche-terrain screen: steepest sustained along-track gradient is ${slopes.maxAngleDeg}° near ${Math.round(slopes.atMeters)} m. This is in the 30–45° starting-slope band, but a route profile under-reads true avalanche terrain because it only measures along-track gradient.`
          : null,
    };
  }, [loadState]);
  const checkinOverdue =
    checkinStatus(lastCheckinAt, checkinSettings)?.overdue === true
      ? checkinStatus(lastCheckinAt, checkinSettings)?.label
      : null;
  const gainHr = gpsTrusted ? gainLastHourM(trackPoints) : 0;
  const amsWarn = amsAssessment({
    altitudeM: gps.fix?.altitude,
    gainLastHourM: gainHr,
    symptoms: [],
  }).warning;
  const avyWarn =
    slopePct != null ? avalancheTerrainWarning({ slopePct }) : null;

  const offsetLabel =
    trusted && progress && Number.isFinite(progress.offsetMeters)
      ? `${Math.round(progress.offsetMeters)} m`
      : "—";

  const packAge = useMemo(() => {
    if (loadState.status !== "ready" || nowMs === 0) return null;
    const cachedAt = Date.parse(loadState.pack.cachedAt);
    if (!Number.isFinite(cachedAt)) return null;
    const days = Math.floor((nowMs - cachedAt) / 86_400_000);
    if (days >= 1) return `saved ${days} d ago`;
    const hours = Math.floor((nowMs - cachedAt) / 3_600_000);
    return hours >= 1 ? `saved ${hours} h ago` : "saved today";
  }, [loadState, nowMs]);

  // Stacked HUD, ranked by time-to-harm: untrusted → OFF TRAIL → overdue/check-in → fall → exposure/AMS → rest.
  const hudBanners: Array<{ key: string; tone: "critical" | "warn" | "info"; text: string }> = [];
  if (deniedWarning) {
    hudBanners.push({
      key: "denied",
      tone: gpsDenied || deniedNeedHeading ? "critical" : "warn",
      text: deniedWarning,
    });
  }
  if (severity === "critical" && progress && trusted && Number.isFinite(progress.offsetMeters)) {
    hudBanners.push({
      key: "offtrail",
      tone: "critical",
      text: `OFF TRAIL — ${Math.round(progress.offsetMeters)} m from route. Walk ${formatWalkBearing(progress.bearingToTrail, navFix?.lat, navFix?.lng)} (${compassLabel(progress.bearingToTrail)}) back.`,
    });
  } else if (severity === "warn" && progress && trusted && Number.isFinite(progress.offsetMeters)) {
    hudBanners.push({
      key: "drift",
      tone: "warn",
      text: `Drifting off trail (${Math.round(progress.offsetMeters)} m)`,
    });
  }
  if (overdueBanner && !beaconOn) {
    hudBanners.push({ key: "overdue", tone: "critical", text: overdueBanner });
  }
  if (checkinOverdue && !beaconOn) {
    hudBanners.push({ key: "checkin", tone: "critical", text: checkinOverdue });
  }
  if (fallWarning) hudBanners.push({ key: "fall", tone: "critical", text: fallWarning });
  // Persistent, not dismissible: the hiker skipped these, so the only honest
  // thing is to keep saying which parts of the safety net are not set up.
  if (readinessSkipped.length > 0) {
    hudBanners.push({
      key: "readiness",
      tone: "warn",
      text: `Not set up: ${readinessSkipped.join(", ")}. Nobody is expecting you back at a known time.`,
    });
  }
  if (exposureWarning) hudBanners.push({ key: "exposure", tone: "warn", text: exposureWarning });
  if (amsWarn) hudBanners.push({ key: "ams", tone: "warn", text: amsWarn });
  for (const [key, text] of [
    ["dr-anchor", deniedError],
    ["spoof", gpsSpoof],
    ["sere", sereWarning],
    ["avy", avyWarn],
    ["profile-avy", routeProfileWarnings.avalanche],
    ["profile-alt", routeProfileWarnings.altitude],
    ["buddy", buddyWarn],
    ["slope", slopeWarn],
    ["comms", commsWarn],
    ["still", stillWarning],
    ["ascent", ascentWarning],
    ["hydrate", hydrateWarning],
    ["turnaround", turnaround],
    ["daylight", daylight?.warning ?? null],
    ["moon", moonWarning],
    ["battery", batteryWarning],
    ["gps", gps.message],
  ] as const) {
    if (text) hudBanners.push({ key, tone: "warn", text });
  }
  if (exitArmed) {
    hudBanners.push({
      key: "exit",
      tone: "info",
      text: "Tap back again to leave navigation. The route pack stays on this device.",
    });
  }
  const crumbs = useMemo(
    () => reverseTrackLine(trackPoints),
    [trackPoints],
  );
  const retrace = useMemo(() => {
    if (!backtrackOn || !navFix || !trusted) return null;
    return backtrackProgress({ lat: navFix.lat, lng: navFix.lng }, trackPoints);
  }, [backtrackOn, navFix, trusted, trackPoints]);

  useEffect(() => {
    if (loadState.status !== "ready") return;
    void listWaypoints(loadState.pack.id).then(setWaypoints);
  }, [loadState]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const alarm = await getOverdueAlarm();
      if (cancelled) return;
      if (!alarm) {
        setOverdueBanner(null);
        return;
      }
      const status = overdueStatus(alarm.returnAt);
      // Surface an unparseable deadline too. Rendering only on `overdue` meant a
      // corrupt stored return time showed nothing, so the hiker believed the
      // overdue alarm was armed when it was not.
      setOverdueBanner(status.overdue || !status.valid ? status.label : null);
    }
    void tick();
    const id = window.setInterval(() => void tick(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (loadState.status !== "ready") return;
    let cancelled = false;
    async function refresh() {
      if (!sessionIdRef.current) return;
      const session = await getNavSession(sessionIdRef.current);
      if (!cancelled && session) setTrackPoints(session.points);
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [loadState]);

  if (loadState.status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <p className="text-muted-foreground">Loading offline route pack…</p>
      </div>
    );
  }

  if (loadState.status === "ready" && !navUnlocked) {
    return (
      <ReadinessGate
        packReady
        onReady={unlockIfReady}
        onProceedAnyway={() => {
          void (async () => {
            const [profile, alarm] = await Promise.all([getIceProfile(), getOverdueAlarm()]);
            setReadinessSkipped(
              hikeReadiness({ packReady: true, profile, returnAt: alarm?.returnAt ?? null })
                .missing,
            );
          })().finally(() => setNavUnlocked(true));
        }}
      />
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4" />
            Back
          </Button>
        </Link>
        <Card className="border-destructive/50">
          <CardContent className="flex gap-3 pt-6">
            <AlertTriangle className="size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Cannot navigate offline</p>
              <p className="mt-1 text-sm text-muted-foreground">{loadState.message}</p>
              <Button className="mt-4" variant="outline" onClick={() => void loadPack()}>
                Retry
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                First time here?{" "}
                <Link href="/guide#offline" className="text-primary underline">
                  How offline routes work
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { pack, source } = loadState;
  const fixOnRoute = Boolean(
    gps.fix && isFixNearRouteBbox(gps.fix.lat, gps.fix.lng, pack.bbox),
  );
  const navHeading = gpsDenied ? drFix?.heading : gpsTrusted ? gps.fix?.heading : undefined;
  const drUncertainty =
    gpsDenied && drFix
      ? deadReckonUncertaintyM({
          lastAccuracyM: gps.fix?.accuracy,
          distanceM: drFix.meters,
        })
      : undefined;
  const user =
    navFix && trusted
      ? {
          lat: navFix.lat,
          lng: navFix.lng,
          heading: navHeading,
          accuracy: gpsDenied ? drUncertainty : gps.fix?.accuracy,
        }
      : gps.fix && fixOnRoute && !gpsDenied
        ? {
            lat: gps.fix.lat,
            lng: gps.fix.lng,
            heading: undefined,
            accuracy: gps.fix.accuracy,
          }
        : null;
  const ghost = gpsDenied && gps.fix ? { lat: gps.fix.lat, lng: gps.fix.lng } : null;
  const gm = navFix ? gmAngleCard(navFix.lat, navFix.lng) : null;
  const usng = navFix ? formatUsng(navFix.lat, navFix.lng) : null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-background ${
        nightMode === "red"
          ? "[&_*]:!border-red-900 [&]:bg-[#140303]"
          : nightMode === "nvg"
            ? "[&]:bg-[#03140a]"
            : ""
      }`}
    >
      <div className="relative min-h-0 flex-1">
        {beaconOn && <SosBeacon onClose={() => setBeaconOn(false)} />}
        <SafetyNavMap
          geometry={pack.geometry}
          user={user}
          nearest={
            backtrackOn
              ? retrace?.nearest ?? null
              : trusted
                ? progress?.nearest ?? null
                : null
          }
          headingUp={headingUp && trusted && navHeading != null}
          follow={trusted}
          backtrack={backtrackOn ? crumbs : null}
          waypoints={waypoints}
          goto={goto}
          ghost={ghost}
          search={searchOverlay}
          showGrid
          nightMode={nightMode}
          gpsDenied={gpsDenied}
          uncertaintyM={drUncertainty}
          topInsetPx={headerHeight}
          className="absolute inset-0 h-full w-full"
        />

        <div
          ref={headerRef}
          className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-background/95 to-transparent p-3 pb-8"
        >
          <div className="pointer-events-auto flex items-start justify-between gap-2">
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label={exitArmed ? "Tap again to exit navigation" : "Exit navigation"}
              onClick={() => {
                if (!exitArmed) {
                  setExitArmed(true);
                  window.setTimeout(() => setExitArmed(false), 2500);
                  return;
                }
                window.location.href = exitHref;
              }}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div className="flex items-start gap-2">
              <SafetyPanel
                lat={navFix?.lat}
                lng={navFix?.lng}
                accuracyM={gpsDenied ? drUncertainty : gps.fix?.accuracy}
                trailName={pack.name}
                packId={pack.id}
                offTrailM={trusted ? progress?.offsetMeters : undefined}
                bearingToTrail={trusted ? progress?.bearingToTrail : undefined}
                bearingToStart={bearingToStart ?? undefined}
                daylightWarning={daylight?.warning ?? null}
                isDark={Boolean(daylight?.isDark)}
                positionSource={positionSource}
                altitudeM={gps.fix?.altitude}
                stale={positionSource !== "gps"}
                recordedAt={gpsDenied ? deniedAnchor?.at : gps.fix?.recordedAt}
                backtrackEnabled={backtrackOn}
                backtrackReady={trackPoints.length >= 2}
                onToggleBacktrack={() => setBacktrackOn((v) => !v)}
                onBeacon={() => setBeaconOn(true)}
                onWaypointsChange={setWaypoints}
                heading={trusted ? navHeading : undefined}
                onGoto={setGoto}
                waypoints={waypoints}
                trackPoints={trackPoints}
                gpsDenied={gpsDenied}
                onToggleGpsDenied={toggleDeadReckoning}
                onDeniedPaces={setDeniedPaces}
                onDeniedPaceLen={setDeniedPaceLen}
                packWeather={pack.weather}
                onDrank={() => {
                  const t = Date.now();
                  setLastDrinkAt(t);
                  try {
                    sessionStorage.setItem(`hike-drink-${navId}`, String(t));
                  } catch {
                    /* private mode */
                  }
                }}
                gpsTrusted={gpsTrusted}
                geometry={pack.geometry}
                remainingMeters={trusted ? progress?.remainingMeters : undefined}
                remainingGainM={trusted ? progress?.remainingElevationMeters : undefined}
                traveledMeters={trusted ? progress?.traveledMeters : undefined}
                elevationProfile={pack.elevationProfile}
                onSearchOverlay={setSearchOverlay}
                lastCommsAt={lastCommsAt}
                onCommsAttempt={() => {
                  const t = Date.now();
                  setLastCommsAt(t);
                  try {
                    sessionStorage.setItem(`hike-comms-${navId}`, String(t));
                  } catch {
                    /* private mode */
                  }
                }}
                onCheckinLogged={() => {
                  void lastCheckin(navId).then((e) => setLastCheckinAt(e?.recordedAt ?? null));
                }}
              />
              {/*
                The header gradient fades to transparent, so muted text over its
                lower half sat on the dark map and was close to illegible --
                including the USNG grid reference, which is the string you read
                aloud to a rescuer. This scrim guarantees a known background
                behind the text at any map darkness or theme.
              */}
              <div className="max-w-[58%] rounded-lg bg-background/90 px-2 py-1 text-right backdrop-blur-sm">
                <p className="truncate text-sm font-semibold">{pack.name}</p>
                <p className="text-xs text-muted-foreground">
                  {source === "cache" ? "Offline pack" : "Saved to device"}
                  {packAge && ` · ${packAge}`}
                  {gps.status === "stale" && " · GPS stale"}
                </p>
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                  disabled={refreshingPack}
                  onClick={() => {
                    setRefreshingPack(true);
                    void loadPack({ forceNetwork: true }).finally(() =>
                      setRefreshingPack(false),
                    );
                  }}
                >
                  {refreshingPack ? "Refreshing route…" : "Refresh route"}
                </button>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {usng ?? "USNG unavailable"}
                  {gpsDenied && drErrorM != null
                    ? ` · DR ±${drErrorM} m`
                    : !gpsTrusted && gps.fix
                      ? ` · last known ${formatFixAge(gps.fix.recordedAt)}`
                      : ""}
                  {` · ${zulu}`}
                </p>
                {gm && (
                  <p className="text-[10px] text-muted-foreground">{gm.gridToMagnetic}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {hudBanners.length > 0 && (
          <div
            // Positioned below the measured header rather than a fixed top-16.
            // The header card grew (grid reference, G-M correction) and a banner
            // sat on top of it, covering the USNG grid string -- the one line
            // you read aloud to a rescuer.
            className="pointer-events-none absolute inset-x-3 z-20 flex max-h-[45%] flex-col gap-1.5 overflow-y-auto"
            style={{ top: (headerHeight || 64) + 8 }}
          >
            {hudBanners.map((banner) => (
              <div
                key={banner.key}
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                  banner.tone === "critical"
                    ? "border-destructive bg-destructive/90 text-white"
                    : banner.tone === "info"
                      ? "border-border bg-background/95 text-foreground"
                      : "border-amber-500/60 bg-amber-500/90 text-black"
                }`}
              >
                {banner.text}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Radio
              className={`size-3.5 ${gps.status === "live" ? "text-primary" : "text-muted-foreground"}`}
            />
            {gpsDenied
              ? "GPS denied — compass / pace"
              : gps.fix
                ? gpsAccuracyLabel(gps.fix.accuracy)
                : "Waiting for GPS…"}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/*
              Only shown when dead reckoning actually needs a heading. The
              previous condition also fired whenever GPS was trusted but
              reported no heading -- true for any stationary device -- so an
              unlabelled empty field sat in the primary safety bar during
              normal operation.
            */}
            {(deniedNeedHeading || gpsDenied) && (
              <input
                aria-label="Dead-reckon heading degrees true"
                className="h-8 w-16 rounded-md border bg-background px-2 text-xs"
                inputMode="decimal"
                placeholder="° true"
                value={deniedHeadingText}
                onChange={(e) => setDeniedHeadingText(e.target.value)}
              />
            )}
            <Button
              variant={gpsDenied ? "default" : "outline"}
              size="sm"
              disabled={!gpsDenied && !gpsTrusted}
              onClick={toggleDeadReckoning}
            >
              {gpsDenied ? "DR" : "GPS"}
            </Button>
            <Button
              variant={nightMode === "off" ? "outline" : "default"}
              size="sm"
              onClick={() =>
                setNightMode((m) => (m === "off" ? "red" : m === "red" ? "nvg" : "off"))
              }
            >
              <Moon className="size-3.5" />
              {nightMode === "off" ? "Day" : nightMode === "red" ? "Red" : "NVG"}
            </Button>
            <Button
              variant={headingUp ? "default" : "outline"}
              size="sm"
              onClick={() => setHeadingUp((v) => !v)}
              disabled={!trusted || navHeading == null}
            >
              <Compass className="size-3.5" />
              {headingUp && trusted && navHeading != null ? "Heading up" : "North up"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            icon={MapPin}
            label={
              backtrackOn
                ? "Backtrack"
                : progress && progress.remainingDirection === "unknown"
                  ? "To nearer end"
                  : "Remaining"
            }
            value={
              backtrackOn && retrace
                ? formatDistance(retrace.remainingMeters)
                : trusted && progress
                  ? formatDistance(progress.remainingMeters)
                  : "—"
            }
          />
          <Stat
            icon={Mountain}
            label="Climb left"
            value={
              trusted && progress ? formatElevation(progress.remainingElevationMeters) : "—"
            }
          />
          <Stat
            icon={Compass}
            label="Off trail"
            value={offsetLabel}
            alert={severity === "critical"}
          />
          <Stat
            icon={Mountain}
            label="Est. time"
            value={
              trusted && progress && progress.remainingMeters > 0
                ? formatNaismith(
                    naismithMinutes(progress.remainingMeters, progress.remainingElevationMeters),
                  ).replace("Naismith ", "")
                : trusted && progress && progress.remainingMeters < 50
                  ? "Done"
                  : "—"
            }
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <p>
            {positionSource === "deadReckon"
              ? "DR"
              : positionSource === "gps"
                ? "GPS live"
                : "Last known"}
            {" · "}
            pack {formatFixAge(Date.parse(pack.cachedAt))}
            {" · "}
            {battery.available
              ? `battery ${Math.round((battery.level ?? 0) * 100)}%${battery.charging ? " charging" : ""}`
              : "battery API unavailable"}
            {" · "}
            {checkinSettings.enabled
              ? lastCheckinAt
                ? `check-in ${formatFixAge(Date.parse(lastCheckinAt))}`
                : "no check-in yet"
              : "check-in off"}
            {" · "}
            wake lock {wakeHeld ? "held" : "not held"}
          </p>
          {checkinOverdue && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                const text = emergencyMessage({
                  lat: navFix?.lat,
                  lng: navFix?.lng,
                  accuracyM: gpsDenied ? drUncertainty : gps.fix?.accuracy,
                  trailName: pack.name,
                  offTrailM: progress?.offsetMeters,
                  stale: positionSource !== "gps",
                  recordedAt: gpsDenied ? deniedAnchor?.at : gps.fix?.recordedAt,
                  positionSource,
                  partyNote: "I'm late for my check-in. This is my grid.",
                });
                void (async () => {
                  if (navigator.share) {
                    try {
                      await navigator.share({ title: "I'm late — hiking grid", text });
                      return;
                    } catch {
                      /* fall through */
                    }
                  }
                  await copyEmergencyInfo(text);
                })();
              }}
            >
              I&apos;m late — send grid
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  alert,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2 ${alert ? "border-destructive bg-destructive/10" : "border-border"}`}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <p className={`text-sm font-semibold tabular-nums ${alert ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  );
}
