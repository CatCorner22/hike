"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ElevationChart } from "@/components/trails/elevation-chart";
import { SafetyNavMap } from "@/components/map/safety-nav-map";
import { PrepareOffline } from "@/components/offline/prepare-offline";
import { useGps } from "@/hooks/use-gps";
import {
  compassLabel,
  formatRemaining,
  gpsAccuracyLabel,
  isValidGeometry,
  progressAlongTrail,
} from "@/lib/geo/navigation";
import { formatElevation } from "@/lib/geo";
import { OFF_TRAIL_THRESHOLD_METERS } from "@/lib/constants";
import { parseNavigateTarget } from "@/lib/ids";
import { requestWakeLock } from "@/lib/offline/wake-lock";
import {
  buildRoutePack,
  getRoutePack,
  packCandidateIds,
  saveRoutePack,
  type RoutePack,
} from "@/lib/offline/route-pack";
import { AlertTriangle, ArrowLeft, Compass, LocateFixed } from "lucide-react";

async function fetchJson(url: string) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

async function loadFromNetwork(navId: string): Promise<RoutePack | null> {
  const target = parseNavigateTarget(navId);
  if (!target) return null;

  if (target.kind === "trail") {
    const trail = await fetchJson(`/api/trails/${target.id}`);
    if (!isValidGeometry(trail.geometry)) return null;
    return buildRoutePack({
      id: navId,
      aliases: packCandidateIds(navId).concat(trail.id, target.id),
      name: trail.name,
      geometry: trail.geometry,
      bbox: trail.bbox,
      elevationProfile: trail.elevationProfile || [],
    });
  }

  const plan = await fetchJson(`/api/plans/${target.id}`);
  let geometry = plan.customGeometry;
  let bbox = undefined;
  let elevationProfile = [];
  let name = plan.name;

  if (plan.trailId) {
    const trail = await fetchJson(`/api/trails/${plan.trailId}`);
    geometry = trail.geometry || geometry;
    bbox = trail.bbox;
    elevationProfile = trail.elevationProfile || [];
    name = plan.name || trail.name;
  }

  if (!isValidGeometry(geometry)) return null;
  return buildRoutePack({
    id: navId,
    aliases: packCandidateIds(navId).concat(target.id, plan.trailId).filter(Boolean),
    name,
    geometry,
    bbox,
    elevationProfile,
  });
}

export default function NavigatePage() {
  const params = useParams();
  const router = useRouter();
  const navId = params.planId as string;
  const gps = useGps();

  const [pack, setPack] = useState<RoutePack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [headingUp, setHeadingUp] = useState(false);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    let released = false;
    let handle: { release: () => void } | null = null;
    void requestWakeLock().then((lock) => {
      if (released) lock.release();
      else handle = lock;
    });
    return () => {
      released = true;
      handle?.release();
    };
  }, []);

  useEffect(() => {
    setOfflineOnly(!navigator.onLine);
    const onOnline = () => setOfflineOnly(!navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadError(null);
      const ids = packCandidateIds(navId);
      for (const id of ids) {
        const cached = await getRoutePack(id);
        if (cached && !cancelled) {
          setPack(cached);
          return;
        }
      }

      if (!navigator.onLine) {
        if (!cancelled) {
          setLoadError(
            "This route was not downloaded before you lost service. Reconnect and tap Prepare offline on the trail or plan page, then return here.",
          );
        }
        return;
      }

      try {
        const fresh = await loadFromNetwork(navId);
        if (!fresh) {
          throw new Error("The route geometry is missing or invalid.");
        }
        await saveRoutePack(fresh);
        if (!cancelled) setPack(fresh);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? `${error.message} Download this route while you still have service.`
              : "Could not load the route.",
          );
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [navId]);

  const progress = useMemo(() => {
    if (!pack || !gps.fix) return null;
    return progressAlongTrail(gps.fix, pack.geometry, pack.elevationProfile);
  }, [gps.fix, pack]);

  const offTrail = Boolean(
    progress && progress.offsetMeters > OFF_TRAIL_THRESHOLD_METERS,
  );

  if (loadError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-4">
        <div className="max-w-md space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Route not available offline</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
          <Button onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Exit navigation
          </Button>
        </div>
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 text-slate-200">
        Loading downloaded route…
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/95 p-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-100"
          onClick={() => router.back()}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Exit
        </Button>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-semibold">{pack.name}</p>
          <p className="text-[11px] text-slate-400">
            {offlineOnly ? "Offline pack" : "Pack saved on device"} ·{" "}
            {gpsAccuracyLabel(gps.fix?.accuracy)}
          </p>
        </div>
        <PrepareOffline
          packId={navId}
          aliases={pack.aliases}
          name={pack.name}
          geometry={pack.geometry}
          bbox={pack.bbox}
          elevationProfile={pack.elevationProfile}
          compact
        />
      </header>

      {offTrail && progress && (
        <Alert variant="destructive" className="mx-3 mt-2 rounded-lg">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Off trail</AlertTitle>
          <AlertDescription>
            {formatRemaining(progress.offsetMeters)} from the route. Walk{" "}
            {compassLabel(progress.bearingToTrail)} to rejoin.
          </AlertDescription>
        </Alert>
      )}

      {gps.message && !offTrail && (
        <p className="px-3 pt-2 text-xs text-amber-200">{gps.message}</p>
      )}

      <div className="relative min-h-0 flex-1">
        <SafetyNavMap
          geometry={pack.geometry}
          user={gps.fix}
          nearest={progress?.nearest}
          headingUp={headingUp}
          follow={follow}
          className="h-full w-full"
        />
        <div className="absolute bottom-3 right-3 flex flex-col gap-2">
          <Button
            size="sm"
            variant={follow ? "default" : "secondary"}
            onClick={() => setFollow((value) => !value)}
          >
            <LocateFixed className="mr-1 h-4 w-4" />
            Follow
          </Button>
          <Button
            size="sm"
            variant={headingUp ? "default" : "secondary"}
            onClick={() => setHeadingUp((value) => !value)}
          >
            <Compass className="mr-1 h-4 w-4" />
            {headingUp ? "Heading" : "North"}
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-3 gap-2 border-t border-slate-800 bg-slate-950 p-3 text-center">
        <Stat
          label="Remaining"
          value={progress ? formatRemaining(progress.remainingMeters) : "—"}
        />
        <Stat
          label="Off route"
          value={progress ? formatRemaining(progress.offsetMeters) : "—"}
        />
        <Stat
          label="Climb left"
          value={
            progress
              ? formatElevation(progress.remainingElevationMeters)
              : "—"
          }
        />
      </section>

      {pack.elevationProfile.length > 0 && (
        <div className="border-t border-slate-800 bg-slate-950 px-3 pb-3">
          <ElevationChart
            profile={pack.elevationProfile}
            currentDistanceMeters={progress?.traveledMeters}
            className="h-20 w-full"
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
