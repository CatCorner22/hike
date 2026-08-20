"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Compass, MapPin, Moon, Mountain, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SafetyNavMap } from "@/components/map/safety-nav-map";
import { SafetyPanel } from "@/components/offline/safety-panel";
import { SosBeacon } from "@/components/offline/sos-beacon";
import { useBatteryWarning } from "@/hooks/use-battery-warning";
import { useGps } from "@/hooks/use-gps";
import { formatDistance, formatElevation } from "@/lib/geo";
import {
  compassLabel,
  gpsAccuracyLabel,
  progressAlongTrail,
  type TrailProgress,
} from "@/lib/geo/navigation";
import { parseNavigateTarget } from "@/lib/ids";
import {
  loadCachedRoutePack,
  packFromPlanApi,
  packFromTrailApi,
  persistRoutePack,
  withNetworkTimeout,
} from "@/lib/offline/load-route-pack";
import { warmNavigateShell } from "@/lib/offline/navigate-shell";
import { appendNavPoint, getNavSession, startNavSession } from "@/lib/offline/nav-track";
import type { RoutePack } from "@/lib/offline/route-pack";
import { requestWakeLock, releaseWakeLock } from "@/lib/offline/wake-lock";
import { offTrailLevel, shouldRepeatAlert, vibrateOffTrail } from "@/lib/safety/alerts";
import {
  backtrackProgress,
  rapidAscentWarning,
  reverseTrackLine,
  stationaryMinutes,
} from "@/lib/safety/backtrack";
import { moonPhase } from "@/lib/safety/astro";
import { altitudeFromProfile } from "@/lib/safety/altitude";
import { slopeAnglesFromProfile } from "@/lib/safety/avalanche";
import { formatWalkBearing, gmAngleCard, isFixNearRouteBbox, turnaroundWarning } from "@/lib/safety/declination";
import { daylightStatus } from "@/lib/safety/daylight";
import { formatFixAge, isTrustedFix } from "@/lib/safety/gps-quality";
import {
  getOverdueAlarm,
  listWaypoints,
  overdueStatus,
  type SafetyWaypoint,
} from "@/lib/safety/profile";
import { hypothermiaWarning, suddenStopWarning, waterReminder } from "@/lib/safety/field";
import { formatNaismith, gpsAnomalyWarning, naismithMinutes, slopeFromProfile, slopeWarning } from "@/lib/safety/field-ops";
import { commsWindowReminder, buddySeparationWarning } from "@/lib/safety/sar-advanced";
import { sereAssessment } from "@/lib/safety/sere";
import { deadReckon, distanceFromPaces, formatZulu } from "@/lib/safety/landnav";
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
  const [lastDrinkAt, setLastDrinkAt] = useState<number | null>(null);
  const [lastCommsAt, setLastCommsAt] = useState<number | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [deniedAnchor, setDeniedAnchor] = useState<{
    lat: number;
    lng: number;
    heading: number;
    at: number;
  } | null>(null);
  const [deniedPaces, setDeniedPaces] = useState(0);
  const [deniedNow, setDeniedNow] = useState(0);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const lastAlertRef = useRef<number | null>(null);
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
    const id = window.setInterval(() => setZulu(formatZulu()), 15000);
    return () => window.clearInterval(id);
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
  }, [loadState.status]);

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
  const gpsTrusted = Boolean(gps.fix && isTrustedFix(gps.fix.recordedAt, gps.fix.stale));

  useEffect(() => {
    if (!gpsDenied) return;
    const refresh = () => setDeniedNow(Date.now());
    const initial = window.setTimeout(refresh, 0);
    const id = window.setInterval(refresh, 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, [gpsDenied]);

  const drFix = useMemo(() => {
    if (!gpsDenied || !deniedAnchor) return null;
    const meters =
      deniedPaces > 0
        ? distanceFromPaces(deniedPaces, 65)
        : Math.max(0, ((deniedNow - deniedAnchor.at) / 1000) * 1.15);
    const point = deadReckon(deniedAnchor, deniedAnchor.heading, meters);
    return { ...point, heading: deniedAnchor.heading, meters };
  }, [gpsDenied, deniedAnchor, deniedPaces, deniedNow]);

  const trusted = gpsDenied ? Boolean(drFix) : gpsTrusted;
  const navFix = gpsDenied && drFix ? drFix : gps.fix;

  const loadPack = useCallback(async () => {
    setLoadState({ status: "loading" });

    const cached = await loadCachedRoutePack(navId);
    if (cached) {
      setLoadState({ status: "ready", pack: cached, source: "cache" });
      return;
    }

    const target = parseNavigateTarget(navId);
    if (!target) {
      setLoadState({
        status: "error",
        message: "Invalid route id. Open the trail or plan and tap Prepare offline first.",
      });
      return;
    }

    try {
      if (target.kind === "trail") {
        const res = await withNetworkTimeout(
          (signal) => fetch(`/api/trails/${target.id}`, { signal }),
          8000,
        );
        if (!res.ok) throw new Error("Trail not found on server");
        const data = await res.json();
        const pack = await persistRoutePack(packFromTrailApi(navId, data));
        setLoadState({ status: "ready", pack, source: "network" });
        return;
      }

      const planRes = await withNetworkTimeout(
        (signal) => fetch(`/api/plans/${target.id}`, { signal }),
        8000,
      );
      if (!planRes.ok) throw new Error("Plan not found on server");
      const plan = await planRes.json();
      let trail = null;
      if (plan.trailId) {
        const trailRes = await withNetworkTimeout(
          (signal) => fetch(`/api/trails/${plan.trailId}`, { signal }),
          8000,
        );
        if (trailRes.ok) trail = await trailRes.json();
      }
      const built = packFromPlanApi(navId, plan, trail);
      if (!built) throw new Error("Plan has no route geometry");
      const pack = await persistRoutePack(built);
      setLoadState({ status: "ready", pack, source: "network" });
    } catch (err) {
      const retry = await loadCachedRoutePack(navId, { retries: 5, retryMs: 400 });
      if (retry) {
        setLoadState({ status: "ready", pack: retry, source: "cache" });
        return;
      }
      setLoadState({
        status: "error",
        message:
          err instanceof Error
            ? `${err.message}. Prepare offline on Wi‑Fi before you lose service.`
            : "Route unavailable offline. Prepare offline before heading out.",
      });
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
    return () => {
      void releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    if (loadState.status !== "ready" || !navFix || !trusted) {
      if (!trusted) queueMicrotask(() => setProgress(null));
      return;
    }
    const p = progressAlongTrail(
      { lat: navFix.lat, lng: navFix.lng },
      loadState.pack.geometry,
      loadState.pack.elevationProfile,
    );
    queueMicrotask(() => setProgress(p));
  }, [navFix, loadState, trusted]);

  useEffect(() => {
    if (loadState.status !== "ready") return;
    let cancelled = false;

    sessionIdRef.current = null;
    void startNavSession(navId, loadState.pack.name).then((id) => {
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
  }, [loadState, navId]);

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

  const severity = useMemo(() => {
    if (!progress) return "unknown" as const;
    return offTrailLevel(progress.offsetMeters, gps.fix?.accuracy, { trustedFix: trusted });
  }, [progress, gps.fix?.accuracy, trusted]);

  useEffect(() => {
    if (severity === "unknown" || severity === "ok") return;
    if (shouldRepeatAlert(lastAlertRef.current, severity)) {
      vibrateOffTrail(severity);
      lastAlertRef.current = Date.now();
    }
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
    return turf.bearing(
      turf.point([navFix.lng, navFix.lat]),
      turf.point([start.lng, start.lat]),
    );
  }, [navFix, loadState, trusted]);

  const daylight = useMemo(() => {
    const lat =
      gps.fix?.lat ??
      (loadState.status === "ready"
        ? (loadState.pack.bbox[1] + loadState.pack.bbox[3]) / 2
        : null);
    const lng =
      gps.fix?.lng ??
      (loadState.status === "ready"
        ? (loadState.pack.bbox[0] + loadState.pack.bbox[2]) / 2
        : null);
    if (lat == null || lng == null) return null;
    return daylightStatus(new Date(), lat, lng);
  }, [gps.fix, loadState]);

  const turnaround = useMemo(() => {
    if (!trusted || !progress || !daylight) return null;
    return turnaroundWarning(
      progress.remainingMeters,
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
  const deniedWarning = gpsDenied
    ? `GPS DENIED — dead reckon ${drFix ? `${Math.round(drFix.meters)} m` : ""} on ${deniedAnchor ? `${Math.round(deniedAnchor.heading)}°` : "—"}. SOS still uses a live GPS fix if one exists.`
    : null;
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

  const skyWarning =
    deniedWarning ??
    gpsSpoof ??
    fallWarning ??
    exposureWarning ??
    sereWarning ??
    buddyWarn ??
    routeProfileWarnings.altitude ??
    routeProfileWarnings.avalanche ??
    slopeWarn ??
    commsWarn ??
    stillWarning ??
    ascentWarning ??
    hydrateWarning ??
    turnaround ??
    daylight?.warning ??
    moonWarning ??
    null;

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
      setOverdueBanner(status.overdue ? status.label : null);
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
  const user =
    navFix && trusted
      ? {
          lat: navFix.lat,
          lng: navFix.lng,
          heading: navHeading,
          accuracy: gpsDenied ? undefined : gps.fix?.accuracy,
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
                lat={gps.fix?.lat}
                lng={gps.fix?.lng}
                accuracyM={gps.fix?.accuracy}
                trailName={pack.name}
                packId={pack.id}
                offTrailM={trusted ? progress?.offsetMeters : undefined}
                bearingToTrail={trusted ? progress?.bearingToTrail : undefined}
                bearingToStart={bearingToStart}
                daylightWarning={skyWarning}
                altitudeM={gps.fix?.altitude}
                stale={!gpsTrusted && Boolean(gps.fix)}
                recordedAt={gps.fix?.recordedAt}
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
                onToggleGpsDenied={() => {
                  if (gpsDenied) {
                    setGpsDenied(false);
                    setDeniedAnchor(null);
                    setDeniedPaces(0);
                    return;
                  }
                  const fix = gps.fix;
                  if (!fix || !gpsTrusted) return;
                  setDeniedAnchor({
                    lat: fix.lat,
                    lng: fix.lng,
                    heading: fix.heading ?? 0,
                    at: Date.now(),
                  });
                  setDeniedPaces(0);
                  setGpsDenied(true);
                }}
                onDeniedPaces={setDeniedPaces}
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
              />
              <div className="max-w-[55%] text-right">
                <p className="truncate text-sm font-semibold">{pack.name}</p>
                <p className="text-xs text-muted-foreground">
                  {source === "cache" ? "Offline pack" : "Saved to device"}
                  {gps.status === "stale" && " · GPS stale"}
                </p>
                {navFix && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {formatUsng(navFix.lat, navFix.lng)}
                    {gpsDenied ? " · DR" : !gpsTrusted ? ` · last known ${formatFixAge(gps.fix!.recordedAt)}` : ""}
                    {` · ${zulu}`}
                  </p>
                )}
                {gm && (
                  <p className="text-[10px] text-muted-foreground">{gm.gridToMagnetic}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {overdueBanner && !exitArmed && !beaconOn && (
          <div className="pointer-events-none absolute inset-x-3 top-16 z-20 rounded-lg border border-destructive bg-destructive/90 px-3 py-2 text-sm font-medium text-white">
            {overdueBanner}
          </div>
        )}

        {exitArmed && (
          <div className="pointer-events-none absolute inset-x-3 top-16 z-20 rounded-lg border border-border bg-background/95 px-3 py-2 text-xs">
            Tap back again to leave navigation. The route pack stays on this device.
          </div>
        )}

        {severity !== "ok" && severity !== "unknown" && progress && trusted && !exitArmed && (
          <div
            className={`pointer-events-none absolute inset-x-3 top-16 z-10 rounded-lg border px-3 py-2 text-sm font-medium ${
              severity === "critical"
                ? "border-destructive bg-destructive/90 text-white"
                : "border-amber-500 bg-amber-500/90 text-black"
            }`}
          >
            {severity === "critical"
              ? `OFF TRAIL — ${Math.round(progress.offsetMeters)} m from route. Walk ${formatWalkBearing(progress.bearingToTrail, gps.fix?.lat, gps.fix?.lng)} (${compassLabel(progress.bearingToTrail)}) back.`
              : `Drifting off trail (${Math.round(progress.offsetMeters)} m)`}
          </div>
        )}

        {skyWarning && severity === "ok" && !exitArmed && (
          <div className="pointer-events-none absolute inset-x-3 top-16 z-10 rounded-lg border border-amber-500/50 bg-background/90 px-3 py-2 text-xs">
            {skyWarning}
          </div>
        )}

        {batteryWarning && (
          <div className="pointer-events-none absolute inset-x-3 top-28 z-10 rounded-lg border border-amber-500/50 bg-background/90 px-3 py-2 text-xs">
            {batteryWarning}
          </div>
        )}

        {gps.message && (
          <div className="pointer-events-none absolute inset-x-3 bottom-32 z-10 rounded-lg border border-amber-500/50 bg-background/95 px-3 py-2 text-xs">
            {gps.message}
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
          <div className="flex gap-2">
            <Button
              variant={gpsDenied ? "default" : "outline"}
              size="sm"
              disabled={!gpsDenied && !gpsTrusted}
              onClick={() => {
                if (gpsDenied) {
                  setGpsDenied(false);
                  setDeniedAnchor(null);
                  setDeniedPaces(0);
                  return;
                }
                const fix = gps.fix;
                if (!fix || !gpsTrusted) return;
                setDeniedAnchor({
                  lat: fix.lat,
                  lng: fix.lng,
                  heading: fix.heading ?? 0,
                  at: Date.now(),
                });
                setDeniedPaces(0);
                setGpsDenied(true);
              }}
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
            label={backtrackOn ? "Backtrack" : "Remaining"}
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
            value={trusted && progress ? `${Math.round(progress.offsetMeters)} m` : "—"}
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
