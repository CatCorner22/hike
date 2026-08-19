"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatPace,
} from "@/lib/geo";
import { queueActivityPoint } from "@/lib/offline";
import { Pause, Play, Square } from "lucide-react";

interface ActivityRecorderProps {
  trailId?: string;
  planId?: string;
  onComplete?: (activityId: string) => void;
}

interface LiveStats {
  distanceMeters: number;
  elevationGainMeters: number;
  durationSeconds: number;
  pointCount: number;
}

export function ActivityRecorder({
  trailId,
  planId,
  onComplete,
}: ActivityRecorderProps) {
  const [status, setStatus] = useState<"idle" | "recording" | "paused">("idle");
  const [activityId, setActivityId] = useState<string | null>(null);
  const [stats, setStats] = useState<LiveStats>({
    distanceMeters: 0,
    elevationGainMeters: 0,
    durationSeconds: 0,
    pointCount: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<Date | null>(null);
  const lastPointRef = useRef<{ lat: number; lng: number; elevation?: number } | null>(null);
  const pointsRef = useRef<
    Array<{ lat: number; lng: number; elevation?: number; recordedAt: Date }>
  >([]);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => () => stopWatch(), [stopWatch]);

  const startRecording = async () => {
    setError(null);
    try {
      const response = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trailId,
          planId,
          startedAt: new Date().toISOString(),
        }),
      });

      if (!response.ok) throw new Error("Failed to start activity");
      const data = await response.json();
      setActivityId(data.id);
      startTimeRef.current = new Date();
      pointsRef.current = [];
      lastPointRef.current = null;
      setStatus("recording");

      watchIdRef.current = navigator.geolocation.watchPosition(
        async (position) => {
          const point = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            elevation: position.coords.altitude ?? undefined,
            recordedAt: new Date(),
          };

          pointsRef.current.push(point);

          if (lastPointRef.current) {
            const R = 6371000;
            const dLat = ((point.lat - lastPointRef.current.lat) * Math.PI) / 180;
            const dLng = ((point.lng - lastPointRef.current.lng) * Math.PI) / 180;
            const a =
              Math.sin(dLat / 2) ** 2 +
              Math.cos((lastPointRef.current.lat * Math.PI) / 180) *
                Math.cos((point.lat * Math.PI) / 180) *
                Math.sin(dLng / 2) ** 2;
            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            setStats((prev) => {
              let elevGain = prev.elevationGainMeters;
              if (
                point.elevation != null &&
                lastPointRef.current?.elevation != null &&
                point.elevation > lastPointRef.current.elevation
              ) {
                elevGain += point.elevation - lastPointRef.current.elevation;
              }
              const duration =
                startTimeRef.current
                  ? (Date.now() - startTimeRef.current.getTime()) / 1000
                  : 0;
              return {
                distanceMeters: prev.distanceMeters + dist,
                elevationGainMeters: elevGain,
                durationSeconds: duration,
                pointCount: prev.pointCount + 1,
              };
            });
          }

          lastPointRef.current = point;

          if (data.id) {
            try {
              await fetch(`/api/activities/${data.id}/points`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  lat: point.lat,
                  lng: point.lng,
                  elevation: point.elevation,
                  recordedAt: point.recordedAt.toISOString(),
                }),
              });
            } catch {
              await queueActivityPoint({
                activityId: data.id,
                ...point,
              });
            }
          }
        },
        (err) => setError(err.message),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    }
  };

  const stopRecording = async () => {
    stopWatch();
    if (!activityId) return;

    try {
      const response = await fetch(`/api/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endedAt: new Date().toISOString(),
          stats: {
            distanceMeters: stats.distanceMeters,
            elevationGainMeters: stats.elevationGainMeters,
            durationSeconds: stats.durationSeconds,
          },
        }),
      });

      if (!response.ok) throw new Error("Failed to save activity");
      setStatus("idle");
      onComplete?.(activityId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Distance" value={formatDistance(stats.distanceMeters)} />
          <Stat label="Elev gain" value={formatElevation(stats.elevationGainMeters)} />
          <Stat label="Duration" value={formatDuration(stats.durationSeconds)} />
          <Stat
            label="Pace"
            value={
              stats.distanceMeters > 0
                ? formatPace(
                    stats.durationSeconds / 60 / (stats.distanceMeters / 1000),
                  )
                : "—"
            }
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          {status === "idle" && (
            <Button onClick={startRecording} className="flex-1">
              <Play className="mr-2 h-4 w-4" />
              Start recording
            </Button>
          )}
          {status === "recording" && (
            <>
              <Button variant="secondary" onClick={() => setStatus("paused")}>
                <Pause className="mr-2 h-4 w-4" />
                Pause
              </Button>
              <Button variant="destructive" onClick={stopRecording} className="flex-1">
                <Square className="mr-2 h-4 w-4" />
                Stop & save
              </Button>
            </>
          )}
          {status === "paused" && (
            <Button onClick={() => setStatus("recording")} className="flex-1">
              <Play className="mr-2 h-4 w-4" />
              Resume
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
