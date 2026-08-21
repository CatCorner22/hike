"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  useEffect(() => {
    fetch("/api/activities")
      .then((r) => r.json())
      .then((d) => setActivities(d.activities || []));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Activities</h1>
        <p className="text-muted-foreground">
          Your recorded hiking activities and GPS tracks.
        </p>
      </div>

      {activities.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No activities recorded yet. Start recording from a trail page.
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
    </div>
  );
}
