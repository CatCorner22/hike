"use client";
import { apiFetch } from "@/lib/api/client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ElevationChart } from "@/components/trails/elevation-chart";
import { ResearchBrief } from "@/components/trails/research-brief";
import { RouteDifficultyPanel } from "@/components/trails/route-difficulty-panel";
import { ActivityRecorder } from "@/components/activities/activity-recorder";
import { formatDistance, formatElevation, lineLengthMeters } from "@/lib/geo";
import { NavigateLink } from "@/components/offline/navigate-link";
import { PrepareOffline } from "@/components/offline/prepare-offline";
import { useOfflinePackReady } from "@/hooks/use-offline-pack-ready";
import { packFromTrailApi, persistRoutePack } from "@/lib/offline/load-route-pack";
import type { TrailResearchBrief } from "@/lib/research/schema";
import { httpsUrl } from "@/lib/urls";
import { npsParkCodeFromTags } from "@/lib/nps/park-code";
import { navigateHref, planDetailHref } from "@/lib/routes";
import {
  Calendar,
  ExternalLink,
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
  tags?: Record<string, string>;
}

export default function TrailDetailPage() {
  // useSearchParams under Suspense: the detail screen lives at a fixed path with
  // ?id= because the static build has no server to expand a dynamic segment.
  return (
    <Suspense fallback={null}>
      <TrailDetailTarget />
    </Suspense>
  );
}

function TrailDetailTarget() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const trailId = searchParams.get("id");
  useEffect(() => {
    if (!trailId) router.replace("/explore");
  }, [trailId, router]);
  if (!trailId) return null;
  return <TrailDetail trailId={trailId} />;
}

function TrailDetail({ trailId }: { trailId: string }) {
  const router = useRouter();

  const [trail, setTrail] = useState<TrailData | null>(null);
  const [brief, setBrief] = useState<TrailResearchBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const offlineReadiness = useOfflinePackReady(trail ? `trail-${trailId}` : null);

  useEffect(() => {
    async function load() {
      try {
        const response = await apiFetch(`/api/trails/${trailId}`);
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
    setResearchError(null);
    try {
      const response = await fetch(
        `/api/research/${trailId}${refresh ? "?refresh=true" : ""}`,
      );
      const data = (await response.json()) as {
        brief?: TrailResearchBrief;
        error?: string;
      };
      if (!response.ok || !data.brief) {
        throw new Error(data.error || "Trail research is unavailable.");
      }
      setBrief(data.brief);
    } catch (researchFailure) {
      setResearchError(
        researchFailure instanceof Error
          ? researchFailure.message
          : "Trail research is unavailable.",
      );
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
    setCreatingPlan(true);
    setPlanError(null);
    try {
      const response = await apiFetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trail.name,
          trailId: trail.id,
          customGeometry: trail.geometry,
        }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id) {
        setPlanError(data.error || "Could not add this trail to a plan.");
        return;
      }
      router.push(planDetailHref(data.id));
    } catch {
      setPlanError("Could not add this trail to a plan.");
    } finally {
      setCreatingPlan(false);
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

  const wikipediaHref = httpsUrl(trail.wikipediaUrl);

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
            {wikipediaHref && (
              <a
                href={wikipediaHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs text-primary hover:underline"
              >
                Wikipedia
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            )}
          </div>
          {planError && <p className="mt-2 text-sm text-destructive">{planError}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={createPlan} disabled={creatingPlan}>
            {creatingPlan ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add to plan
          </Button>
          <NavigateLink
            href={navigateHref(`trail-${trailId}`)}
            {...offlineReadiness}
          />
          <PrepareOffline
            packId={`trail-${trailId}`}
            aliases={[`trail-${trail.id}`, trailId, trail.id]}
            name={trail.name}
            geometry={trail.geometry}
            bbox={trail.bbox}
            elevationProfile={trail.elevationProfile}
            parkCode={npsParkCodeFromTags(trail.tags)}
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

      <RouteDifficultyPanel
        geometry={trail.geometry}
        elevationProfile={trail.elevationProfile}
        reportedDistanceMeters={trail.lengthMeters}
        tags={trail.tags}
      />

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
        ) : null}
        {researchError && (
          <p role="status" className="mb-2 text-sm text-destructive">
            {researchError} Existing trail and map data remain available.
          </p>
        )}
        {brief ? <ResearchBrief brief={brief} /> : null}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Record activity</h2>
        <ActivityRecorder trailId={trail.id || trailId} />
      </div>
    </div>
  );
}
