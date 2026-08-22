"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompletedNavigationTracks } from "@/components/activities/completed-navigation-tracks";
import { formatDistance, formatDuration, formatElevation } from "@/lib/geo";

interface Activity {
  id: string;
  name: string | null;
  startedAt: string;
  endedAt: string | null;
  stats: {
    distanceMeters?: number;
    durationSeconds?: number;
    elevationGainMeters?: number;
  } | null;
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadActivities = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/activities", { signal });
      const data = await response.json() as { activities?: Activity[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Recorded activities could not be loaded.");
      if (!Array.isArray(data.activities)) throw new Error("Recorded activities could not be read from the server response.");
      setActivities(data.activities);
      setLoadState("ready");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setLoadError(error instanceof Error ? error.message : "Recorded activities could not be loaded.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadTimer = window.setTimeout(() => void loadActivities(controller.signal), 0);
    return () => {
      window.clearTimeout(loadTimer);
      controller.abort();
    };
  }, [loadActivities]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Activities</h1>
        <p className="text-muted-foreground">
          Your recorded hiking activities and device-only navigation tracks.
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="recorded-activities-heading">
        <h2 id="recorded-activities-heading" className="text-lg font-semibold">
          Recorded activities
        </h2>
        {loadState === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">Loading recorded activities…</p>
        ) : loadState === "error" ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Recorded activities could not be loaded</AlertTitle>
            <AlertDescription>
              <p>{loadError ?? "Check your connection and try again."}</p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => {
                  setLoadState("loading");
                  setLoadError(null);
                  void loadActivities();
                }}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : activities.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No activities recorded yet. Start recording from a trail or trip page.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {activities.map((activity) => (
              <Link key={activity.id} href={`/activities/${activity.id}`}>
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle className="text-base">
                      {activity.name || "Trail activity"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(activity.startedAt), "MMM d, yyyy · h:mm a")}
                    </p>
                    <div className="mt-2 flex gap-4 text-sm">
                      {activity.stats?.distanceMeters != null && (
                        <span>{formatDistance(activity.stats.distanceMeters)}</span>
                      )}
                      {activity.stats?.durationSeconds != null && (
                        <span>{formatDuration(activity.stats.durationSeconds)}</span>
                      )}
                      {activity.stats?.elevationGainMeters != null && (
                        <span>+{formatElevation(activity.stats.elevationGainMeters)}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <CompletedNavigationTracks />
    </div>
  );
}
