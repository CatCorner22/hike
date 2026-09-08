"use client";
import { apiFetch } from "@/lib/api/client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDistance, formatDuration, formatElevation } from "@/lib/geo";
import { format } from "date-fns";
import { Button, buttonVariants } from "@/components/ui/button";
import { Download } from "lucide-react";
import { safeFilename } from "@/lib/safety/field";
import { saveTextFile } from "@/lib/platform/save-file";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> },
);

interface ActivityDetail {
  id: string;
  name: string | null;
  startedAt: string;
  endedAt: string | null;
  stats: Record<string, number> | null;
  trackGeometry: GeoJSON.LineString | null;
}

type ActivityPoint = {
  lat: number;
  lng: number;
  elevation?: number | null;
  recordedAt?: string;
};

function isActivityDetail(value: unknown): value is ActivityDetail {
  if (!value || typeof value !== "object") return false;
  const activity = value as Partial<ActivityDetail>;
  return typeof activity.id === "string"
    && typeof activity.startedAt === "string"
    && Number.isFinite(Date.parse(activity.startedAt))
    && (activity.endedAt === null || typeof activity.endedAt === "string")
    && (activity.name === null || typeof activity.name === "string");
}

function isActivityPoint(value: unknown): value is ActivityPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<ActivityPoint>;
  return typeof point.lat === "number"
    && Number.isFinite(point.lat)
    && point.lat >= -90
    && point.lat <= 90
    && typeof point.lng === "number"
    && Number.isFinite(point.lng)
    && point.lng >= -180
    && point.lng <= 180;
}

export default function ActivityDetailPage() {
  // useSearchParams under Suspense: the detail screen lives at a fixed path with
  // ?id= because the static build has no server to expand a dynamic segment.
  return (
    <Suspense fallback={null}>
      <ActivityDetailTarget />
    </Suspense>
  );
}

function ActivityDetailTarget() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activityId = searchParams.get("id");
  useEffect(() => {
    if (!activityId) router.replace("/activities");
  }, [activityId, router]);
  if (!activityId) return null;
  return <ActivityDetail activityId={activityId} />;
}

function ActivityDetail({ activityId }: { activityId: string }) {

  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [points, setPoints] = useState<ActivityPoint[]>([]);
  const [pointCount, setPointCount] = useState(0);
  const [downsampled, setDownsampled] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch(`/api/activities/${encodeURIComponent(activityId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as {
          activity?: unknown;
          points?: unknown;
          pointCount?: unknown;
          downsampled?: unknown;
          error?: unknown;
        };
        if (!response.ok) {
          throw new Error(typeof body.error === "string" ? body.error : `Activity could not be loaded (${response.status}).`);
        }
        if (!isActivityDetail(body.activity) || !Array.isArray(body.points) || !body.points.every(isActivityPoint)) {
          throw new Error("The activity response was incomplete or invalid.");
        }
        const authoritativeCount = typeof body.pointCount === "number"
          && Number.isInteger(body.pointCount)
          && body.pointCount >= body.points.length
          ? body.pointCount
          : body.points.length;
        if (cancelled) return;
        setActivity(body.activity);
        setPoints(body.points);
        setPointCount(authoritativeCount);
        setDownsampled(body.downsampled === true);
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "The activity could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, loadAttempt]);

  if (loadError) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Activity unavailable</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="alert" className="text-sm text-destructive">{loadError}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                setActivity(null);
                setLoadError(null);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              Retry
            </Button>
            <Link href="/activities" className={buttonVariants({ variant: "outline" })}>
              Back to activities
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!activity) return <Skeleton className="h-64 w-full" />;

  const trackGeometry =
    activity.trackGeometry ||
    (points.length >= 2
      ? {
          type: "LineString" as const,
          coordinates: points.map((p) => [p.lng, p.lat]),
        }
      : undefined);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="text-2xl font-bold">
          {activity.name || "Trail activity"}
        </h1>
        <p className="text-muted-foreground">
          {format(new Date(activity.startedAt), "MMMM d, yyyy · h:mm a")}
        </p>
        </div>
        <div className="text-right">
          <Button
            type="button"
            variant="outline"
            disabled={!activity.endedAt || exporting}
            onClick={async () => {
              setExporting(true);
              setExportError(null);
              try {
                const response = await apiFetch(`/api/activities/${encodeURIComponent(activity.id)}/export`, {
                  cache: "no-store",
                });
                const text = await response.text();
                if (!response.ok) {
                  let message = "The GPX track could not be exported.";
                  try { message = (JSON.parse(text) as { error?: string }).error ?? message; } catch { /* non-JSON error */ }
                  throw new Error(message);
                }
                const saved = await saveTextFile(
                  `${safeFilename(activity.name || "Trail activity")}-activity.gpx`,
                  text,
                  "application/gpx+xml",
                );
                if (!saved) throw new Error("The phone would not save the GPX file.");
              } catch (error) {
                setExportError(error instanceof Error ? error.message : "The GPX track could not be exported.");
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Exporting…" : "Export GPX"}
          </Button>
          {!activity.endedAt && (
            <p className="mt-1 text-xs text-muted-foreground">Finish recording before export.</p>
          )}
          {exportError && <p role="alert" className="mt-1 text-xs text-destructive">{exportError}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Distance"
          value={
            activity.stats?.distanceMeters != null
              ? formatDistance(activity.stats.distanceMeters)
              : "—"
          }
        />
        <StatCard
          label="Duration"
          value={
            activity.stats?.durationSeconds != null
              ? formatDuration(activity.stats.durationSeconds)
              : "—"
          }
        />
        <StatCard
          label="Elevation gain"
          value={
            activity.stats?.elevationGainMeters != null
              ? formatElevation(activity.stats.elevationGainMeters)
              : "—"
          }
        />
        <StatCard label="GPS points" value={pointCount.toLocaleString()} />
      </div>

      {trackGeometry && (
        <div>
          <div className="h-80 overflow-hidden rounded-xl border">
            <MapView trackGeometry={trackGeometry} zoom={13} />
          </div>
          {downsampled && (
            <p className="mt-2 text-xs text-muted-foreground">
              Map display reduced to {points.length.toLocaleString()} representative points from {pointCount.toLocaleString()} saved fixes. GPX export retains the complete track.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-normal text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
