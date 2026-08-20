"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle2, Loader2 } from "lucide-react";
import { persistRoutePack } from "@/lib/offline/load-route-pack";
import { fetchPackWeather } from "@/lib/offline/pack-weather";
import { buildRoutePack, hasRoutePack, type RoutePack } from "@/lib/offline/route-pack";

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

  useEffect(() => {
    void hasRoutePack(packId).then(setReady);
  }, [packId]);

  async function prepare() {
    if (!geometry) {
      setMessage("Load the trail first, then prepare it for offline use.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const first =
        geometry.type === "LineString"
          ? geometry.coordinates[0]
          : geometry.coordinates.find((line) => line.length >= 1)?.[0];
      const center = bbox
        ? { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2 }
        : { lat: first?.[1] ?? 0, lng: first?.[0] ?? 0 };
      const weather = await fetchPackWeather(center.lat, center.lng);
      const pack: RoutePack = buildRoutePack({
        id: packId,
        aliases,
        name,
        geometry,
        bbox,
        elevationProfile,
        weather: weather ?? undefined,
      });
      await persistRoutePack(pack);
      setReady(true);
      setMessage(
        weather
          ? `Route saved. Weather snapshot ${weather.tempC ?? "—"}°C / ${weather.windKph ?? "—"} km/h stored on the pack.`
          : "Route saved on this device. Navigation will work without cell service. Type temp/wind in Safety if you want field weather.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save the route pack on this device.",
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
    </div>
  );
}
