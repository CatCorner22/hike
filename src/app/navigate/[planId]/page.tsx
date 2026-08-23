"use client";
import { apiFetch } from "@/lib/api/client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Compass, MapPin, Moon, Mountain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CompassHud } from "@/components/navigate/compass-hud";
import { NextDecisionCard } from "@/components/navigate/next-decision-card";
import { HazardBriefCard } from "@/components/offline/hazard-brief-card";
import { OfficialAlertsCard } from "@/components/offline/official-alerts-card";
import { RescueCard } from "@/components/navigate/rescue-card";
import { SafetyNavMap } from "@/components/map/safety-nav-map";
import { SafetyPanel } from "@/components/offline/safety-panel";
import { ReadinessGate } from "@/components/offline/readiness-gate";
import { formatOfflineRouteStorageError } from "@/components/offline/offline-readiness";
import { SosBeacon } from "@/components/offline/sos-beacon";
import { useBatteryStatus } from "@/hooks/use-battery-status";
import { useBatteryWarning } from "@/hooks/use-battery-warning";
import { useDeviceHeading } from "@/hooks/use-device-heading";
import { fuseNavHeading, headingDisagreement, headingSourceLabel } from "@/lib/safety/device-heading";
import { useGps } from "@/hooks/use-gps";
import { useNavigationTrack } from "@/hooks/use-navigation-track";
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
import type { RoutePack } from "@/lib/offline/route-pack";
import {
  createRouteProgressCache,
  progressWithRouteCache,
  routePackFingerprint,
  type RouteProgressCache,
} from "@/lib/offline/progress-cache";
import { requestWakeLock, releaseWakeLock, isWakeLockHeld } from "@/lib/offline/wake-lock";
import { bailoutRouteCandidates } from "@/lib/offline/bailout-routes";
import { deriveCorridorBailouts } from "@/lib/offline/corridor-decisions";
import { hikeReadiness } from "@/lib/safety/readiness";
import { nextDecisionPoint } from "@/lib/safety/decision-support";
import { bailoutDecisionPoints } from "@/lib/safety/bailout";
import { wayfindingAssessment } from "@/lib/safety/wayfinding";
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
import {
  formatWalkBearing,
  gmAngleCard,
  isFixNearRouteBbox,
  magneticDeclination,
  turnaroundWarning,
} from "@/lib/safety/declination";
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
import { deadReckon, deadReckonUncertaintyM, distanceFromPaces, formatZulu, parseTypedHeading } from "@/lib/safety/landnav";
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
  const [finishTrackArmed, setFinishTrackArmed] = useState(false);
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
  // Items the hiker chose to skip on the pre-hike checklist, kept so navigation
  // can keep showing them. Skipping must not silently drop the safety net.
  const [readinessSkipped, setReadinessSkipped] = useState<string[]>([]);
  const [wakeHeld, setWakeHeld] = useState(false);
  const snapHintRef = useRef<{ traveledMeters: number } | null>(null);
  const [deniedError, setDeniedError] = useState<string | null>(null);
  const [refreshingPack, setRefreshingPack] = useState(false);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [liveAnnouncement, setLiveAnnouncement] = useState<{
    key: string;
    tone: "critical" | "warn";
    text: string;
  } | null>(null);
  const lastAlertRef = useRef<number | null>(null);
  const announcedSafetyStatesRef = useRef<Set<string>>(new Set());
  const progressCacheRef = useRef<RouteProgressCache | null>(null);

  const gps = useGps();
  const gpsTrusted = Boolean(gps.fix && isTrustedFix(gps.fix.recordedAt, gps.fix.stale));
  const deviceHeading = useDeviceHeading({
    declinationDeg:
      gpsTrusted && gps.fix ? magneticDeclination(gps.fix.lat, gps.fix.lng) : null,
  });

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

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("navigate-night-red-document", "navigate-night-nvg-document");
    if (nightMode !== "off") root.classList.add(`navigate-night-${nightMode}-document`);
    return () => {
      root.classList.remove("navigate-night-red-document", "navigate-night-nvg-document");
    };
  }, [nightMode]);

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
    // checklist is showing, so with only loadState.status the ref was still null
    // when the effect ran and the header was never measured. headerHeight stayed
    // 0, silently disabling both the map label inset and the banner offset.
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
  const readyPackId = loadState.status === "ready" ? loadState.pack.id : null;
  const readyPackName = loadState.status === "ready" ? loadState.pack.name : null;
  const navigationTrack = useNavigationTrack({
    packId: readyPackId,
    name: readyPackName,
    fix: gpsTrusted && gps.fix ? gps.fix : null,
  });
  const trackPoints = navigationTrack.points;
  const trackPersistence = navigationTrack.persistence;
  const navHeadingFusion = useMemo(
    () =>
      fuseNavHeading({
        manualTrue: gpsDenied ? parseTypedHeading(deniedHeadingText) : null,
        deviceTrue: deviceHeading.headingTrue,
        gpsCourseTrue: gpsTrusted ? gps.fix?.heading : undefined,
        gpsDenied,
      }),
    [
      gpsDenied,
      deniedHeadingText,
      deviceHeading.headingTrue,
      gpsTrusted,
      gps.fix?.heading,
    ],
  );
  const headingConflict = useMemo(
    () =>
      headingDisagreement({
        compassTrue: deviceHeading.headingTrue,
        gpsCourseTrue: gpsTrusted ? gps.fix?.heading : null,
      }),
    [deviceHeading.headingTrue, gpsTrusted, gps.fix?.heading],
  );

  const drFix = useMemo(() => {
    if (!gpsDenied || !deniedAnchor) return null;
    const meters =
      deniedPaces > 0 ? distanceFromPaces(deniedPaces, deniedPaceLen) : 0;
    const point = deadReckon(deniedAnchor, deniedAnchor.heading, meters);
    if (!point) return null;
    return { ...point, heading: deniedAnchor.heading, meters };
  }, [gpsDenied, deniedAnchor, deniedPaces, deniedPaceLen]);

  const trusted = gpsDenied ? Boolean(drFix) : gpsTrusted;
  const corridorDecisions = useMemo(() => {
    if (loadState.status !== "ready") return [];
    return bailoutDecisionPoints([
      ...bailoutRouteCandidates(loadState.pack.bailoutRoutes),
      ...deriveCorridorBailouts({
        geometry: loadState.pack.geometry,
        features: loadState.pack.corridorFeatures,
      }),
    ]);
  }, [loadState]);
  const nextDecision = useMemo(() => {
    const traveled = trusted && progress ? progress.traveledMeters : 0;
    return nextDecisionPoint(corridorDecisions, traveled);
  }, [corridorDecisions, trusted, progress]);
  const navFix = gpsDenied && drFix ? drFix : gps.fix;
  const positionSource: PositionSource =
    gpsDenied && drFix ? "deadReckon" : gpsTrusted ? "gps" : "lastKnown";

  function resolveDeniedHeading(): number | null {
    if (deviceHeading.headingTrue != null && Number.isFinite(deviceHeading.headingTrue)) {
      return deviceHeading.headingTrue;
    }
    const live = gps.fix?.heading;
    if (live != null && Number.isFinite(live)) return live;
    return parseTypedHeading(deniedHeadingText);
  }

  function enterGpsDenied() {
    const fix = gps.fix;
    if (!fix || !gpsTrusted) {
      setDeniedError("Need a live GPS fix to anchor dead reckoning.");
      return;
    }
    const heading = resolveDeniedHeading();
    if (heading == null) {
      setDeniedNeedHeading(true);
      setDeniedError("No heading yet — enter a bearing or walk until the compass has a heading. Dead reckoning cannot guess which way you are facing.");
      return;
    }
    setDeniedNeedHeading(false);
    setDeniedError(null);
    setDeniedAnchor({
      lat: fix.lat,
      lng: fix.lng,
      heading,
      at: Date.now(),
    });
    setDeniedPaces(0);
    setGpsDenied(true);
  }

  function exitGpsDenied() {
    setGpsDenied(false);
    setDeniedAnchor(null);
    setDeniedPaces(0);
    setDeniedNeedHeading(false);
    setDeniedError(null);
  }

  const loadPack = useCallback(async (options: { forceNetwork?: boolean } = {}) => {
    let terminal = false;
    const complete = (next: LoadState) => {
      if (terminal) return;
      terminal = true;
      setLoadState(next);
    };
    if (!options.forceNetwork) setLoadState({ status: "loading" });
    // The deadline must never destroy a working route: on a manual refresh with a slow
    // radio (the exact field case for pressing Refresh), the network chain can outlast
    // this timer — 8 s per fetch, two fetches for a plan — and the old handler replaced
    // the on-screen route with the full-screen error while a valid cached pack sat in
    // hand. Time out INTO the cached pack when one exists; the honest error is only for
    // a first load with nothing cached.
    let timeoutFallback: RoutePack | null = null;
    const timeout = window.setTimeout(() => complete(
      timeoutFallback
        ? { status: "ready", pack: timeoutFallback, source: "cache" }
        : {
            status: "error",
            message: "Route loading timed out. Do not navigate from a loading screen; re-download this matching trail while you have signal.",
          }
    ), 12_000);
    let cached: RoutePack | null = null;
    try {
      try {
        cached = await loadCachedRoutePack(navId);
        timeoutFallback = cached;
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
          const res = await withNetworkTimeout((signal) => apiFetch(`/api/trails/${target.id}`, { signal }), 8000);
          if (!res.ok) throw new Error("Trail not found on server");
          const pack = await persistRoutePack(packFromTrailApi(navId, await res.json()));
          complete({ status: "ready", pack, source: "network" });
          return;
        }
        const planRes = await withNetworkTimeout((signal) => apiFetch(`/api/plans/${target.id}`, { signal }), 8000);
        if (!planRes.ok) throw new Error("Plan not found on server");
        const plan = await planRes.json();
        let trail = null;
        if (plan.trailId) {
          const trailRes = await withNetworkTimeout((signal) => apiFetch(`/api/trails/${plan.trailId}`, { signal }), 8000);
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
  // best-effort; Prepare offline is the explicit pre-departure verification flow.
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
    // Cached incremental search: a full scan costs ~494 ms per fix on a 100k
    // point route, and this runs on every GPS update.
    if (
      !progressCacheRef.current ||
      progressCacheRef.current.fingerprint !== routePackFingerprint(loadState.pack)
    ) {
      progressCacheRef.current = createRouteProgressCache(loadState.pack);
    }
    // travelDirection MUST be passed. Omitting it counts Remaining toward the
    // stored line end, not the end you are walking to.
    const p = progressWithRouteCache(
      progressCacheRef.current,
      { lat: navFix.lat, lng: navFix.lng },
      travelDirection,
    );
    if (Number.isFinite(p.traveledMeters)) {
      snapHintRef.current = { traveledMeters: p.traveledMeters };
    }
    queueMicrotask(() => setProgress(p));
  }, [navFix, loadState, trusted, travelDirection]);

  // Gate on gpsTrusted, not `trusted`: in GPS-denied mode `trusted` only means "we have
  // something to draw". Alerting off a dead-reckoned position raises warnings against a
  // track the hiker never walked.
  const severity = useMemo(() => {
    if (!progress || gpsDenied) return "unknown" as const;
    return offTrailLevel(progress.offsetMeters, gps.fix?.accuracy, {
      trustedFix: gpsTrusted,
    });
  }, [progress, gps.fix?.accuracy, gpsTrusted, gpsDenied]);

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
    ? `GPS DENIED — dead reckon ${drFix ? `${Math.round(drFix.meters)} m` : "0 m"} on ${deniedAnchor ? `${Math.round(deniedAnchor.heading)}°` : "—"}${drErrorM != null ? `, estimated ±${drErrorM} m and growing` : ""}. SOS / SMS use this DR position.`
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
  const wayfindingWarning = wayfindingAssessment({
    offTrail: severity === "critical" || severity === "warn",
    visibilityPoor: Boolean(daylight?.isDark),
    hasBackstop: backtrackOn,
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
        // No upper bound: terrain steeper than 45° must not read as safer than the
        // 30–45° band it sits above — the warning used to vanish there entirely.
        slopes != null && slopes.maxAngleDeg >= 30
          ? slopes.maxAngleDeg <= 45
            ? `Avalanche-terrain screen: steepest sustained along-track gradient is ${slopes.maxAngleDeg}° near ${Math.round(slopes.atMeters)} m. This is in the 30–45° starting-slope band, but a route profile under-reads true avalanche terrain because it only measures along-track gradient.`
            : `Avalanche-terrain screen: steepest sustained along-track gradient is ${slopes.maxAngleDeg}° near ${Math.round(slopes.atMeters)} m — at or above the 30–45° starting-slope band. Slides from this or connected terrain carry high consequence, and a route profile under-reads true avalanche terrain because it only measures along-track gradient.`
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
  // Persistent and not dismissible: the hiker skipped these, so the honest thing
  // is to keep saying which parts of the safety net are not set up.
  if (readinessSkipped.length > 0) {
    hudBanners.push({
      key: "readiness",
      tone: "warn",
      text: `Not set up: ${readinessSkipped.join(", ")}. Nobody is expecting you back at a known time.`,
    });
  }
  if (trackPersistence.status === "error") {
    hudBanners.push({
      key: "track-storage",
      tone: "warn",
      text: `${trackPersistence.message} Backtrack is available only while this screen remains open. Use Retry track save below.`,
    });
  }
  if (exposureWarning) hudBanners.push({ key: "exposure", tone: "warn", text: exposureWarning });
  if (amsWarn) hudBanners.push({ key: "ams", tone: "warn", text: amsWarn });
  for (const [key, text] of [
    ["spoof", gpsSpoof],
    ["sere", sereWarning],
    ["wayfinding", wayfindingWarning],
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
      text: "Tap back again to leave navigation. The route pack and active breadcrumb session stay on this device and resume when you return.",
    });
  }

  const announcementBanners = hudBanners.filter(
    (banner) => banner.tone === "critical" || banner.tone === "warn",
  );

  useEffect(() => {
    const activeStates = new Set(
      announcementBanners.map((banner) => `${banner.tone}:${banner.key}`),
    );
    const stillAnnounced = new Set(
      [...announcedSafetyStatesRef.current].filter((state) => activeStates.has(state)),
    );
    const newlyActive = announcementBanners.filter(
      (banner) => !stillAnnounced.has(`${banner.tone}:${banner.key}`),
    );

    // GPS can update several times while a person remains off trail. Announce
    // the transition into a warning, not the coordinate updates that follow it.
    // A second critical state (for example, a fall after an off-trail warning)
    // is still newly active and gets its own meaningful announcement.
    const critical = newlyActive.filter((banner) => banner.tone === "critical");
    const warn = newlyActive.filter((banner) => banner.tone === "warn");
    const next = critical.length ? critical : warn;
    if (!next.length) {
      announcedSafetyStatesRef.current = stillAnnounced;
      return;
    }

    const tone = critical.length ? "critical" : "warn";
    announcedSafetyStatesRef.current = new Set([
      ...stillAnnounced,
      ...next.map((banner) => `${banner.tone}:${banner.key}`),
    ]);
    setLiveAnnouncement({
      key: next.map((banner) => `${banner.tone}:${banner.key}`).join("|"),
      tone,
      text: `${tone === "critical" ? "Critical safety alert." : "Safety warning."} ${next
        .map((banner) => banner.text)
        .join(" ")}`,
    });
  }, [announcementBanners]);

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
      setOverdueBanner(status?.overdue ? status.label : null);
    }
    void tick();
    const id = window.setInterval(() => void tick(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

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
              {/*
                Raw IndexedDB text ("The requested version (4) is less than the
                existing version (99)") used to be the primary message. That tells
                a hiker about to lose signal nothing they can act on. Show the
                recovery instruction first and keep the technical detail secondary.
              */}
              {(() => {
                const mapped = formatOfflineRouteStorageError(new Error(loadState.message));
                return (
                  <>
                    <p className="mt-1 text-sm text-foreground">{mapped.message}</p>
                    {mapped.diagnostic && mapped.diagnostic !== mapped.message && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Details: {mapped.diagnostic}
                      </p>
                    )}
                  </>
                );
              })()}
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
  const navHeading = navHeadingFusion.headingTrue ?? undefined;
  const navHeadingSource = navHeadingFusion.source;
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

  return (
    <div
      data-hike-navigate-shell={navId}
      className={`navigate-shell fixed inset-0 z-50 flex flex-col bg-background ${
        nightMode === "red"
          ? "navigate-night-red"
          : nightMode === "nvg"
            ? "navigate-night-nvg"
            : ""
      }`}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {beaconOn && <SosBeacon onClose={() => setBeaconOn(false)} />}
        <SafetyNavMap
          geometry={pack.geometry}
          corridorFeatures={pack.corridorFeatures ?? null}
          bailoutRoutes={pack.bailoutRoutes ?? null}
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
          className="navigate-header pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-background/95 to-transparent p-3 pb-8"
        >
          <div className="pointer-events-auto flex items-start justify-between gap-2">
            <Button
              variant="secondary"
              size="icon-sm"
              className="min-h-11 min-w-11"
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
                onToggleGpsDenied={() => (gpsDenied ? exitGpsDenied() : enterGpsDenied())}
                onDeniedPaces={setDeniedPaces}
                onDeniedPaceLen={setDeniedPaceLen}
                packWeather={pack.weather}
                batteryPct={battery.available && battery.level != null ? battery.level * 100 : null}
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
                The header gradient fades to transparent, so muted text placed
                over the lower half sat on the dark map and was close to
                illegible -- including the USNG grid reference, which is the
                string you read aloud to a rescuer. This scrim guarantees a
                known background behind the text at any map darkness or theme.
              */}
              <div className="navigate-route-card max-w-[58%] rounded-lg bg-background/90 px-2 py-1 text-right backdrop-blur-sm">
                <p className="truncate text-sm font-semibold">{pack.name}</p>
                <p className="text-xs text-muted-foreground">
                  {source === "cache" ? "Offline pack" : "Saved to device"}
                  {packAge && ` · ${packAge}`}
                  {gps.status === "stale" && " · GPS stale"}
                </p>
                <p
                  className={`text-[10px] font-medium ${
                    trackPersistence.status === "error"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                  role={trackPersistence.status === "error" ? "alert" : "status"}
                  aria-live="polite"
                >
                  {trackPersistence.status === "opening"
                    ? "Breadcrumb: opening saved track…"
                    : trackPersistence.status === "pending"
                      ? `Breadcrumb: saving ${trackPersistence.queued} fix${trackPersistence.queued === 1 ? "" : "es"}…`
                      : trackPersistence.status === "finishing"
                        ? "Breadcrumb: finishing hike…"
                        : trackPersistence.status === "saved"
                          ? `Breadcrumb: saved · ${trackPersistence.pointCount} fix${trackPersistence.pointCount === 1 ? "" : "es"}${trackPersistence.resumed ? " · resumed" : ""}`
                          : "Breadcrumb: NOT SAVED · keep this screen open"}
                </p>
                {trackPersistence.status === "error" && (
                  <button
                    type="button"
                    className="text-[10px] font-medium text-destructive underline underline-offset-2"
                    onClick={navigationTrack.retry}
                  >
                    Retry track save
                  </button>
                )}
                {trackPersistence.status === "saved" && (
                  <button
                    type="button"
                    className="ml-2 text-[10px] text-muted-foreground underline underline-offset-2"
                    onClick={() => {
                      if (!finishTrackArmed) {
                        setFinishTrackArmed(true);
                        window.setTimeout(() => setFinishTrackArmed(false), 3000);
                        return;
                      }
                      setFinishTrackArmed(false);
                      void navigationTrack
                        .finish()
                        .then(() => {
                          window.location.href = exitHref;
                        })
                        .catch(() => undefined);
                    }}
                  >
                    {finishTrackArmed ? "Confirm finish & exit" : "Finish hike"}
                  </button>
                )}
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
                {navFix && (
                  <p className="navigate-grid-readout font-mono text-sm font-semibold tabular-nums text-foreground">
                    {formatUsng(navFix.lat, navFix.lng) ?? "grid unavailable"}
                    {gpsDenied
                      ? ` · DR ±${drErrorM ?? 25} m`
                      : !gpsTrusted
                        ? ` · last known ${formatFixAge(gps.fix!.recordedAt)}`
                        : ""}
                    {` · ${zulu}`}
                  </p>
                )}
                {gm && (
                  <p className="navigate-grid-support text-xs text-muted-foreground">{gm.gridToMagnetic}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {hudBanners.length > 0 && (
          <div
            // Offset by the measured header rather than a fixed top-16. The header
            // card carries the USNG grid reference -- the line you read aloud to a
            // rescuer -- and a banner sat on top of it.
            className="navigate-hud pointer-events-none absolute inset-x-3 z-20 flex max-h-[45%] flex-col gap-1.5 overflow-y-auto"
            style={{ top: (headerHeight || 64) + 8 }}
            aria-live="off"
          >
            {hudBanners.map((banner) => (
              <div
                key={banner.key}
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                  banner.tone === "critical"
                    ? "border-destructive bg-destructive text-destructive-foreground"
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
        {liveAnnouncement && (
          <div
            key={liveAnnouncement.key}
            className="sr-only"
            role={liveAnnouncement.tone === "critical" ? "alert" : "status"}
            aria-live={liveAnnouncement.tone === "critical" ? "assertive" : "polite"}
            aria-atomic="true"
          >
            {liveAnnouncement.text}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <HazardBriefCard
          compact
          brief={loadState.status === "ready" ? loadState.pack.hazardBrief : null}
        />
        <OfficialAlertsCard
          compact
          snapshot={loadState.status === "ready" ? loadState.pack.officialAlerts : null}
        />
        <NextDecisionCard
          point={nextDecision}
          aheadMeters={
            nextDecision && trusted && progress
              ? nextDecision.distanceMeters - progress.traveledMeters
              : nextDecision?.distanceMeters
          }
          alongRouteOnly={!(trusted && progress)}
        />
        <div className="mb-2 flex items-center justify-between gap-2">
          <CompassHud
            headingTrue={navHeading}
            lat={navFix?.lat}
            lng={navFix?.lng}
            headingUp={headingUp}
            nightMode={nightMode}
            sourceLabel={headingSourceLabel(navHeadingSource)}
            headingWarning={headingConflict.message}
            compassPrompt={
              deviceHeading.permission === "prompt" ? deviceHeading.message : null
            }
            onEnableCompass={
              deviceHeading.permission === "prompt"
                ? () => void deviceHeading.requestPermission()
                : undefined
            }
          />
          <RescueCard
            lat={navFix?.lat}
            lng={navFix?.lng}
            accuracyM={gpsDenied ? drUncertainty : gps.fix?.accuracy}
            trailName={pack.name}
            offTrailM={progress?.offsetMeters}
            stale={positionSource !== "gps"}
            recordedAt={gpsDenied ? deniedAnchor?.at : gps.fix?.recordedAt}
            positionSource={positionSource}
            batteryPct={battery.available ? (battery.level ?? 0) * 100 : null}
            batteryCharging={battery.charging ?? undefined}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/*
              Only when dead reckoning actually needs a heading. The previous
              condition also fired whenever a trusted fix lacked a heading --
              true for any stationary device -- so an unlabelled empty field sat
              in the primary safety bar during normal navigation.
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
              onClick={() => (gpsDenied ? exitGpsDenied() : enterGpsDenied())}
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
        <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          {gpsDenied
            ? "GPS denied — compass / pace"
            : gps.fix
              ? gpsAccuracyLabel(gps.fix.accuracy)
              : "Waiting for GPS…"}
        </p>
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
      <div
        className={`flex items-center gap-1 text-[10px] uppercase tracking-wide ${
          alert ? "text-safety-critical" : "text-muted-foreground"
        }`}
      >
        <Icon className="size-3" />
        {label}
      </div>
      <p className={`text-sm font-semibold tabular-nums ${alert ? "text-safety-critical" : ""}`}>
        {value}
      </p>
    </div>
  );
}
