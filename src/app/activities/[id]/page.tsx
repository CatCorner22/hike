"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDistance, formatDuration, formatElevation } from "@/lib/geo";
import { format } from "date-fns";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> },
);

export default function ActivityDetailPage() {
  const params = useParams();
  const activityId = params.id as string;

  const [activity, setActivity] = useState<{
    id: string;
    name: string | null;
    startedAt: string;
    endedAt: string | null;
    stats: Record<string, number> | null;
    trackGeometry: GeoJSON.LineString | null;
  } | null>(null);
  const [points, setPoints] = useState<
    Array<{ lat: number; lng: number; elevation?: number | null }>
  >([]);

  useEffect(() => {
    fetch(`/api/activities/${activityId}`)
      .then((r) => r.json())
      .then((d) => {
        setActivity(d.activity);
        setPoints(d.points || []);
      });
  }, [activityId]);

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
      <div>
        <h1 className="text-2xl font-bold">
          {activity.name || "Hike activity"}
        </h1>
        <p className="text-muted-foreground">
          {format(new Date(activity.startedAt), "MMMM d, yyyy · h:mm a")}
        </p>
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
        <StatCard label="GPS points" value={String(points.length)} />
      </div>

      {trackGeometry && (
        <div className="h-80 overflow-hidden rounded-xl border">
          <MapView trackGeometry={trackGeometry} zoom={13} />
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
