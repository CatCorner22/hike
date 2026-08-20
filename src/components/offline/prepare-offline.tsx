"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle2, Loader2 } from "lucide-react";
import { persistRoutePack } from "@/lib/offline/load-route-pack";
import { buildRoutePack, hasRoutePack, type RoutePack } from "@/lib/offline/route-pack";
import { warmNavigateShell } from "@/lib/offline/navigate-shell";
import { requestPersistentStorage } from "@/lib/offline/storage";
import { OfflineReadiness } from "@/components/offline/offline-readiness";

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
    // Start while this click still has user activation. Chromium uses that
    // signal when deciding whether an origin may receive persistent storage.
    const persistentStorageRequest = requestPersistentStorage();
    try {
      const pack: RoutePack = buildRoutePack({
        id: packId,
        aliases,
        name,
        geometry,
        bbox,
        elevationProfile,
      });
      await persistRoutePack(pack);
      setReady(true);
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
      setMessage(
        warnings.length
          ? `Route saved. ${warnings.join(" ")}`
          : "Route and navigation screen saved. Navigation will work without cell service.",
      );
    } catch (error) {
      setReady(false);
      window.dispatchEvent(new Event("hike:offline-readiness-changed"));
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
      {!compact && <OfflineReadiness packId={packId} />}
    </div>
  );
}
