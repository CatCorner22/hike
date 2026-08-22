"use client";
import { apiFetch } from "@/lib/api/client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle2, Loader2 } from "lucide-react";
import { persistRoutePack, withNetworkTimeout } from "@/lib/offline/load-route-pack";
import { fetchPackWeather } from "@/lib/offline/pack-weather";
import {
  describeCorridorFeatures,
  validCorridorFeatures,
  type CorridorFeatureSet,
} from "@/lib/offline/corridor-features";
import {
  describeHazardBrief,
  fetchRouteHazardBrief,
  packWeatherFromHazardBrief,
  selectHazardSamplePoints,
  validHazardBrief,
} from "@/lib/offline/hazard-brief";
import {
  describeOfficialAlertSnapshot,
  validOfficialAlertSnapshot,
  type RouteOfficialAlertSnapshot,
} from "@/lib/offline/official-alerts";
import { validBailoutRoutes } from "@/lib/offline/bailout-routes";
import { buildRoutePack, getRoutePack, hasRoutePack, type RoutePack } from "@/lib/offline/route-pack";
import { buildTerrainCorridorSpec, describePersistedCorridor } from "@/lib/offline/terrain-corridor";
import { getNavigateOfflineStatus, warmNavigateShell } from "@/lib/offline/navigate-shell";
import { requestPersistentStorage } from "@/lib/offline/storage";
import {
  OfflineReadiness,
  formatOfflineRouteStorageError,
} from "@/components/offline/offline-readiness";

async function requestCorridorFeatures(
  routeId: string,
  bboxes: Array<[number, number, number, number]>,
): Promise<CorridorFeatureSet | null> {
  try {
    const response = await withNetworkTimeout(
      (signal) => apiFetch("/api/corridor/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId, bboxes }),
        signal,
      }),
      12_000,
    );
    if (!response.ok) return null;
    const data = await response.json() as { features?: unknown };
    return validCorridorFeatures(data.features, routeId, bboxes) ? data.features : null;
  } catch {
    return null;
  }
}

async function requestOfficialAlerts(
  routeId: string,
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  parkCode?: string | null,
): Promise<RouteOfficialAlertSnapshot | null> {
  const points = selectHazardSamplePoints(geometry).map((point) => ({
    lat: point.lat,
    lng: point.lng,
    distanceMeters: point.distanceMeters,
  }));
  if (!points.length) return null;
  try {
    const response = await withNetworkTimeout(
      (signal) => apiFetch("/api/official-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId, parkCode: parkCode ?? null, points }),
        signal,
      }),
      12_000,
    );
    if (!response.ok) return null;
    const data = await response.json() as { snapshot?: unknown };
    return validOfficialAlertSnapshot(data.snapshot, routeId) ? data.snapshot : null;
  } catch {
    return null;
  }
}

interface PrepareOfflineProps {
  packId: string;
  aliases?: string[];
  name: string;
  geometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  bbox?: [number, number, number, number];
  elevationProfile?: Array<{ distanceMeters: number; elevation: number }>;
  parkCode?: string | null;
  className?: string;
  compact?: boolean;
}

export function PrepareOffline({
  packId,
  aliases = [],
  name,
  geometry,
  bbox,
  elevationProfile,
  parkCode,
  className,
  compact = false,
}: PrepareOfflineProps) {
  const [tripReady, setTripReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshReady = useCallback(async () => {
    try {
      const [exists, navigation] = await Promise.all([
        hasRoutePack(packId),
        getNavigateOfflineStatus(packId),
      ]);
      setTripReady(exists && navigation.ready);
      return { packReady: exists, tripReady: exists && navigation.ready };
    } catch {
      // An unreadable IndexedDB is not a saved route. Saying "Update" here
      // could send a hiker away from signal believing a missing map is usable.
      setTripReady(false);
      return { packReady: false, tripReady: false };
    }
  }, [packId]);

  useEffect(() => {
    let cancelled = false;
    let refreshNumber = 0;
    const refresh = async () => {
      const currentRefresh = ++refreshNumber;
      try {
        const [exists, navigation] = await Promise.all([
          hasRoutePack(packId),
          getNavigateOfflineStatus(packId),
        ]);
        if (!cancelled && currentRefresh === refreshNumber) {
          setTripReady(exists && navigation.ready);
        }
      } catch {
        if (!cancelled && currentRefresh === refreshNumber) {
          setTripReady(false);
        }
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [packId]);

  async function prepare() {
    if (!geometry) {
      setMessage("Load the trail first, then prepare it for offline use.");
      return;
    }
    setSaving(true);
    setMessage(null);
    // Start while this click still has user activation. Chromium uses that
    // signal when deciding whether an origin may receive persistent storage.
    const persistentStorageRequest = requestPersistentStorage();
    try {
      const first =
        geometry.type === "LineString"
          ? geometry.coordinates[0]
          : geometry.coordinates.find((line) => line.length >= 1)?.[0];
      const center = bbox
        ? { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2 }
        : { lat: first?.[1] ?? 0, lng: first?.[0] ?? 0 };
      const corridor = buildTerrainCorridorSpec({ routeId: packId, geometry });
      const [corridorFeatures, hazardBrief, officialAlerts] = await Promise.all([
        requestCorridorFeatures(packId, corridor.bboxes),
        fetchRouteHazardBrief({ routeId: packId, geometry }),
        requestOfficialAlerts(packId, geometry, parkCode),
      ]);
      const weather = hazardBrief
        ? packWeatherFromHazardBrief(hazardBrief)
        : await fetchPackWeather(center.lat, center.lng);
      const existing = await getRoutePack(packId);
      const pack: RoutePack = buildRoutePack({
        id: packId,
        aliases,
        name,
        geometry,
        bbox,
        elevationProfile,
        weather: weather ?? existing?.weather,
        corridor,
        corridorFeatures: corridorFeatures ?? (
          existing?.corridorFeatures && validCorridorFeatures(existing.corridorFeatures, packId, corridor.bboxes)
            ? existing.corridorFeatures
            : undefined
        ),
        hazardBrief: hazardBrief ?? (
          existing?.hazardBrief && validHazardBrief(existing.hazardBrief, packId, bbox ?? existing.bbox)
            ? existing.hazardBrief
            : undefined
        ),
        officialAlerts: officialAlerts ?? (
          existing?.officialAlerts && validOfficialAlertSnapshot(existing.officialAlerts, packId)
            ? existing.officialAlerts
            : undefined
        ),
        bailoutRoutes: existing?.bailoutRoutes && validBailoutRoutes(existing.bailoutRoutes, packId, geometry)
          ? existing.bailoutRoutes
          : undefined,
      });
      const saved = await persistRoutePack(pack);
      const savedPackReady = await hasRoutePack(packId);
      if (!savedPackReady) {
        throw new Error("The saved route pack could not be verified. Re-download it before relying on this device.");
      }
      const [persistent, shell] = await Promise.all([
        persistentStorageRequest,
        warmNavigateShell(packId),
      ]);
      await refreshReady();
      window.dispatchEvent(new Event("hike:offline-readiness-changed"));
      const warnings = [
        !shell.ok
          ? shell.error ?? "Navigation screen was not cached."
          : null,
        !persistent
          ? "Browser storage is not persistent, so this pack may be evicted under storage pressure."
          : null,
      ].filter(Boolean);
      const weatherNote = weather
        ? `Weather snapshot ${weather.tempC ?? "—"}°C / ${weather.windKph ?? "—"} km/h stored on the pack.`
        : "Type temp/wind in Safety if you want field weather.";
      const corridorNote = saved.corridor
        ? describePersistedCorridor(saved.corridor)
        : "Terrain corridor was not recorded on this pack.";
      const featureNote = saved.corridorFeatures
        ? describeCorridorFeatures(saved.corridorFeatures)
        : "OSM corridor features were not stored (Overpass unavailable, or the bbox is too large for one snapshot).";
      const hazardNote = saved.hazardBrief
        ? describeHazardBrief(saved.hazardBrief)
        : "Route forecast snapshot was not stored (Open-Meteo unavailable).";
      const officialAlertNote = saved.officialAlerts
        ? describeOfficialAlertSnapshot(saved.officialAlerts)
        : "Official NWS/NPS alerts were not stored; this is not an all-clear.";
      setMessage(
        shell.ok
          ? `Route saved and offline launch files verified on this device. Test the route once in airplane mode before leaving signal. ${warnings.join(" ")} ${corridorNote}. ${featureNote} ${hazardNote} ${officialAlertNote} ${weatherNote}`
          : `Route saved as basic data, but this trip is not verified for offline launch. ${warnings.join(" ")} ${corridorNote}. ${featureNote} ${hazardNote} ${officialAlertNote} ${weatherNote}`,
      );
    } catch (error) {
      await refreshReady();
      window.dispatchEvent(new Event("hike:offline-readiness-changed"));
      setMessage(
        formatOfflineRouteStorageError(error).message,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={className}>
      <Button
        variant={tripReady ? "secondary" : "default"}
        size={compact ? "sm" : "default"}
        onClick={prepare}
        disabled={saving || !geometry}
      >
        {saving ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : tripReady ? (
          <CheckCircle2 className="mr-2 h-4 w-4" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        {compact
          ? tripReady
            ? "Saved"
            : "Save"
          : tripReady
            ? "Update offline pack"
            : "Prepare offline"}
      </Button>
      {message && (
        <p className="mt-2 text-xs text-muted-foreground">{message}</p>
      )}
      {!compact && <OfflineReadiness packId={packId} />}
    </div>
  );
}
