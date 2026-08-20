"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ElevationChart } from "@/components/trails/elevation-chart";
import { ResearchBrief } from "@/components/trails/research-brief";
import { ActivityRecorder } from "@/components/activities/activity-recorder";
import { formatDistance, formatElevation, lineLengthMeters } from "@/lib/geo";
import { NavigateLink } from "@/components/offline/navigate-link";
import { PrepareOffline } from "@/components/offline/prepare-offline";
import { useOfflinePackReady } from "@/hooks/use-offline-pack-ready";
import { packFromTrailApi, persistRoutePack } from "@/lib/offline/load-route-pack";
import type { TrailResearchBrief } from "@/lib/research/schema";
import {
  Calendar,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> },
);

interface TrailData {
  id: string;
  osmId: string;
  osmType: string;
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox: [number, number, number, number];
  center: { lat: number; lng: number };
  lengthMeters?: number;
  elevationGainMeters?: number;
  difficulty?: string;
  sacScale?: string;
  network?: string;
  wikipediaUrl?: string;
  elevationProfile: Array<{ distanceMeters: number; elevation: number }>;
}

export default function TrailDetailPage() {
  const params = useParams();
  const router = useRouter();
  const trailId = params.id as string;

  const [trail, setTrail] = useState<TrailData | null>(null);
  const [brief, setBrief] = useState<TrailResearchBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [researchLoading, setResearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const packReady = useOfflinePackReady(trail ? `trail-${trailId}` : null);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/trails/${trailId}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setTrail(data);
        if (data.geometry) {
          try {
            await persistRoutePack(packFromTrailApi(`trail-${trailId}`, data));
          } catch {
            /* Navigate stays gated until a valid pack is on device */
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [trailId]);

  const loadResearch = useCallback(async (refresh = false) => {
    setResearchLoading(true);
    try {
      const response = await fetch(
        `/api/research/${trailId}${refresh ? "?refresh=true" : ""}`,
      );
      const data = await response.json();
      if (response.ok) setBrief(data.brief);
    } finally {
      setResearchLoading(false);
    }
  }, [trailId]);

  useEffect(() => {
    if (!trail?.id) return;
    const initialResearch = window.setTimeout(() => void loadResearch(), 0);
    return () => window.clearTimeout(initialResearch);
  }, [trail?.id, loadResearch]);

  async function createPlan() {
    if (!trail) return;
    const response = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: trail.name,
        trailId: trail.id,
      }),
    });
    if (response.ok) {
      const plan = await response.json();
      router.push(`/plan/${plan.id}`);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !trail) {
    return <p className="text-destructive">{error || "Trail not found"}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{trail.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {trail.network && <Badge variant="outline">{trail.network}</Badge>}
            {trail.sacScale && <Badge>SAC {trail.sacScale}</Badge>}
            {(() => {
              const measured = lineLengthMeters(trail.geometry);
              const tagged = trail.lengthMeters;
              if (tagged && measured > 0 && Math.abs(tagged - measured) / measured > 0.08) {
                return (
                  <>
                    <Badge variant="secondary">OSM {formatDistance(tagged)}</Badge>
                    <Badge variant="outline">Measured {formatDistance(measured)}</Badge>
                  </>
                );
              }
              const shown = tagged || measured;
              return shown ? (
                <Badge variant="secondary">{formatDistance(shown)}</Badge>
              ) : null;
            })()}
            {trail.elevationGainMeters != null && trail.elevationGainMeters > 0 && (
              <Badge variant="secondary">
                +{formatElevation(trail.elevationGainMeters)}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={createPlan}>
            <Plus className="mr-2 h-4 w-4" />
            Add to plan
          </Button>
          <NavigateLink
            href={`/navigate/trail-${trailId}`}
            ready={packReady}
          />
          <PrepareOffline
            packId={`trail-${trailId}`}
            aliases={[`trail-${trail.id}`, trailId, trail.id]}
            name={trail.name}
            geometry={trail.geometry}
            bbox={trail.bbox}
            elevationProfile={trail.elevationProfile}
          />
          <a
            href={`/api/sync/offline?trailId=${trailId}`}
            download
            className={buttonVariants({ variant: "outline" })}
          >
            <Calendar className="mr-2 h-4 w-4" />
            GPX
          </a>
        </div>
      </div>

      <div className="h-80 overflow-hidden rounded-xl border">
        <MapView
          trailGeometry={trail.geometry}
          fitBounds={trail.bbox}
          showNavigation
        />
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Elevation profile</h2>
        <ElevationChart profile={trail.elevationProfile} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Trail research</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadResearch(true)}
            disabled={researchLoading}
          >
            {researchLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
        {researchLoading && !brief ? (
          <Skeleton className="h-48 w-full" />
        ) : brief ? (
          <ResearchBrief brief={brief} />
        ) : null}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Record activity</h2>
        <ActivityRecorder trailId={trail.id} />
      </div>
    </div>
  );
}
