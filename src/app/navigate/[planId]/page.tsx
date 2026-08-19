"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Compass, MapPin, Mountain, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SafetyNavMap } from "@/components/map/safety-nav-map";
import { SafetyPanel } from "@/components/offline/safety-panel";
import { useBatteryWarning } from "@/hooks/use-battery-warning";
import { useGps } from "@/hooks/use-gps";
import { formatDistance, formatDuration, formatElevation } from "@/lib/geo";
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
import { appendNavPoint, startNavSession } from "@/lib/offline/nav-track";
import type { RoutePack } from "@/lib/offline/route-pack";
import { requestWakeLock, releaseWakeLock } from "@/lib/offline/wake-lock";
import { offTrailLevel, shouldRepeatAlert, vibrateOffTrail } from "@/lib/safety/alerts";
import { formatWalkBearing, isFixNearRouteBbox, turnaroundWarning } from "@/lib/safety/declination";
import { daylightStatus } from "@/lib/safety/daylight";
import { formatCoords } from "@/lib/safety/emergency";
import { formatFixAge, isTrustedFix } from "@/lib/safety/gps-quality";
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
  const batteryWarning = useBatteryWarning();
  const trusted = Boolean(gps.fix && isTrustedFix(gps.fix.recordedAt, gps.fix.stale));

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
        const res = await withNetworkTimeout(fetch(`/api/trails/${target.id}`), 8000);
        if (!res.ok) throw new Error("Trail not found on server");
        const data = await res.json();
        const pack = await persistRoutePack(packFromTrailApi(navId, data));
        setLoadState({ status: "ready", pack, source: "network" });
        return;
      }

      const planRes = await withNetworkTimeout(fetch(`/api/plans/${target.id}`), 8000);
      if (!planRes.ok) throw new Error("Plan not found on server");
      const plan = await planRes.json();
      let trail = null;
      if (plan.trailId) {
        const trailRes = await withNetworkTimeout(fetch(`/api/trails/${plan.trailId}`), 8000);
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
    void loadPack();
  }, [loadPack]);

  useEffect(() => {
    void requestWakeLock();
    return () => {
      void releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    if (loadState.status !== "ready" || !gps.fix || !trusted) {
      if (!trusted) setProgress(null);
      return;
    }
    const p = progressAlongTrail(
      { lat: gps.fix.lat, lng: gps.fix.lng },
      loadState.pack.geometry,
      loadState.pack.elevationProfile,
    );
    setProgress(p);
  }, [gps.fix, loadState, trusted]);

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
    if (!gps.fix || loadState.status !== "ready" || !trusted) return;
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
  }, [gps.fix, loadState.status, trusted]);

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
    if (loadState.status !== "ready" || !gps.fix || !trusted) return undefined;
    const start = trailheadPoint(loadState.pack.geometry);
    if (!start) return undefined;
    return turf.bearing(
      turf.point([gps.fix.lng, gps.fix.lat]),
      turf.point([start.lng, start.lat]),
    );
  }, [gps.fix, loadState, trusted]);

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

  const skyWarning = turnaround ?? daylight?.warning ?? null;

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
  const user =
    gps.fix && (trusted || fixOnRoute)
      ? {
          lat: gps.fix.lat,
          lng: gps.fix.lng,
          heading: trusted ? gps.fix.heading : undefined,
          accuracy: gps.fix.accuracy,
        }
      : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="relative min-h-0 flex-1">
        <SafetyNavMap
          geometry={pack.geometry}
          user={user}
          nearest={trusted ? progress?.nearest ?? null : null}
          headingUp={headingUp && trusted && gps.fix?.heading != null}
          follow={trusted}
          className="absolute inset-0 h-full w-full"
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-background/95 to-transparent p-3 pb-8">
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
                offTrailM={trusted ? progress?.offsetMeters : undefined}
                bearingToTrail={trusted ? progress?.bearingToTrail : undefined}
                bearingToStart={bearingToStart}
                daylightWarning={skyWarning}
                altitudeM={gps.fix?.altitude}
                stale={!trusted && Boolean(gps.fix)}
                recordedAt={gps.fix?.recordedAt}
              />
              <div className="max-w-[55%] text-right">
                <p className="truncate text-sm font-semibold">{pack.name}</p>
                <p className="text-xs text-muted-foreground">
                  {source === "cache" ? "Offline pack" : "Saved to device"}
                  {gps.status === "stale" && " · GPS stale"}
                </p>
                {gps.fix && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {formatCoords(gps.fix.lat, gps.fix.lng)}
                    {!trusted ? ` · last known ${formatFixAge(gps.fix.recordedAt)}` : ""}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

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
            {gps.fix ? gpsAccuracyLabel(gps.fix.accuracy) : "Waiting for GPS…"}
          </div>
          <Button
            variant={headingUp ? "default" : "outline"}
            size="sm"
            onClick={() => setHeadingUp((v) => !v)}
            disabled={!trusted || gps.fix?.heading == null}
          >
            <Compass className="size-3.5" />
            {headingUp && trusted && gps.fix?.heading != null ? "Heading up" : "North up"}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            icon={MapPin}
            label="Remaining"
            value={trusted && progress ? formatDistance(progress.remainingMeters) : "—"}
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
                ? formatDuration(Math.round((progress.remainingMeters / 5000) * 3600))
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
