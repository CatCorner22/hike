"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ElevationChart } from "@/components/trails/elevation-chart";
import { ResearchBrief } from "@/components/trails/research-brief";
import { ActivityRecorder } from "@/components/activities/activity-recorder";
import { formatDistance, formatElevation, gpxFromLineString } from "@/lib/geo";
import { cacheTrailOffline } from "@/lib/offline";
import type { TrailResearchBrief } from "@/lib/research/schema";
import {
  Calendar,
  Download,
  Loader2,
  Navigation,
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
  const trailId = params.id as string;

  const [trail, setTrail] = useState<TrailData | null>(null);
  const [brief, setBrief] = useState<TrailResearchBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [researchLoading, setResearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/trails/${trailId}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setTrail(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [trailId]);

  async function loadResearch(refresh = false) {
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
  }

  useEffect(() => {
    if (trail) loadResearch();
  }, [trail?.id]);

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
      window.location.href = `/plan/${plan.id}`;
    }
  }

  async function downloadOffline() {
    if (!trail) return;
    const gpx = gpxFromLineString(trail.name, trail.geometry);
    await cacheTrailOffline({
      id: trail.id,
      name: trail.name,
      geometry: trail.geometry,
      gpx,
    });
    alert("Trail saved for offline use");
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
            {trail.lengthMeters && (
              <Badge variant="secondary">
                {formatDistance(trail.lengthMeters)}
              </Badge>
            )}
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
          <Link
            href={`/navigate/trail-${trail.id}`}
            className={buttonVariants({ variant: "outline" })}
          >
            <Navigation className="mr-2 h-4 w-4" />
            Navigate
          </Link>
          <Button variant="outline" onClick={downloadOffline}>
            <Download className="mr-2 h-4 w-4" />
            Offline
          </Button>
          <a
            href={`/api/sync/offline?trailId=${trail.id}`}
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
