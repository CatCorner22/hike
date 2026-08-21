"use client";

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
import { buildRoutePack, hasRoutePack, type RoutePack } from "@/lib/offline/route-pack";
import { buildTerrainCorridorSpec, describePersistedCorridor } from "@/lib/offline/terrain-corridor";
import { warmNavigateShell } from "@/lib/offline/navigate-shell";
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
      (signal) => fetch("/api/corridor/features", {
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

interface PrepareOfflineProps {
  packId: string;
  aliases?: string[];
  name: string;
  geometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  bbox?: [number, number, number, number];
  elevationProfile?: Array<{ distanceMeters: number; elevation: number }>;
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
  className,
  compact = false,
}: PrepareOfflineProps) {
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshReady = useCallback(async () => {
    try {
      const exists = await hasRoutePack(packId);
      setReady(exists);
      return exists;
    } catch {
      // An unreadable IndexedDB is not a saved route. Saying "Update" here
      // could send a hiker away from signal believing a missing map is usable.
      setReady(false);
      return false;
    }
  }, [packId]);

  useEffect(() => {
    let cancelled = false;
    let refreshNumber = 0;
    const refresh = async () => {
      const currentRefresh = ++refreshNumber;
      try {
        const exists = await hasRoutePack(packId);
        if (!cancelled && currentRefresh === refreshNumber) setReady(exists);
      } catch {
        if (!cancelled && currentRefresh === refreshNumber) setReady(false);
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
      const [weather, corridorFeatures] = await Promise.all([
        fetchPackWeather(center.lat, center.lng),
        requestCorridorFeatures(packId, corridor.bboxes),
      ]);
      const pack: RoutePack = buildRoutePack({
        id: packId,
        aliases,
        name,
        geometry,
        bbox,
        elevationProfile,
        weather: weather ?? undefined,
        corridor,
        corridorFeatures: corridorFeatures ?? undefined,
      });
      const saved = await persistRoutePack(pack);
      if (!await refreshReady()) {
        throw new Error("The saved route pack could not be verified. Re-download it before relying on this device.");
      }
      const [persistent, shell] = await Promise.all([
        persistentStorageRequest,
        warmNavigateShell(packId),
      ]);
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
      setMessage(
        warnings.length
          ? `Route saved. ${warnings.join(" ")} ${corridorNote}. ${featureNote} ${weatherNote}`
          : `Route and navigation screen saved. Navigation will work without cell service. ${corridorNote}. ${featureNote} ${weatherNote}`,
      );
    } catch (error) {
      setReady(false);
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
        variant={ready ? "secondary" : "default"}
        size={compact ? "sm" : "default"}
        onClick={prepare}
        disabled={saving || !geometry}
      >
        {saving ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : ready ? (
          <CheckCircle2 className="mr-2 h-4 w-4" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        {compact
          ? ready
            ? "Saved"
            : "Save"
          : ready
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
