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
import {
  beginActivity,
  finishActivity,
  flushActivityQueue,
  saveActivityPoint,
} from "@/lib/offline/activity-sync";
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
  const [offline, setOffline] = useState(false);
  const [stats, setStats] = useState<LiveStats>({
    distanceMeters: 0,
    elevationGainMeters: 0,
    durationSeconds: 0,
    pointCount: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pauseAccumRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const lastPointRef = useRef<{ lat: number; lng: number; elevation?: number } | null>(null);
  const statusRef = useRef(status);
  const activityIdRef = useRef<string | null>(null);
  const statsRef = useRef(stats);

  statusRef.current = status;
  activityIdRef.current = activityId;
  statsRef.current = stats;

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const activeDurationSec = useCallback(() => {
    if (startTimeRef.current == null) return 0;
    const frozen = pausedAtRef.current ?? Date.now();
    return Math.max(0, (frozen - startTimeRef.current - pauseAccumRef.current) / 1000);
  }, []);

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not available on this device.");
      return;
    }
    stopWatch();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (statusRef.current !== "recording") return;
        const id = activityIdRef.current;
        if (!id) return;
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          elevation: position.coords.altitude ?? undefined,
          recordedAt: new Date(),
        };

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
            return {
              distanceMeters: prev.distanceMeters + dist,
              elevationGainMeters: elevGain,
              durationSeconds: activeDurationSec(),
              pointCount: prev.pointCount + 1,
            };
          });
        }

        lastPointRef.current = point;
        void saveActivityPoint(id, point).then((ok) => {
          if (!ok) setOffline(true);
        });
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    );
  }, [activeDurationSec, stopWatch]);

  useEffect(() => () => stopWatch(), [stopWatch]);

  useEffect(() => {
    if (status !== "recording") return;
    const tick = window.setInterval(() => {
      setStats((prev) => ({ ...prev, durationSeconds: activeDurationSec() }));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [status, activeDurationSec]);

  useEffect(() => {
    const onOnline = () => {
      void flushActivityQueue().then(() => setOffline(false));
    };
    window.addEventListener("online", onOnline);
    void flushActivityQueue();
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const startRecording = async () => {
    setError(null);
    const started = await beginActivity({ trailId, planId });
    setActivityId(started.id);
    setOffline(started.offline);
    startTimeRef.current = Date.now();
    pauseAccumRef.current = 0;
    pausedAtRef.current = null;
    lastPointRef.current = null;
    setStats({
      distanceMeters: 0,
      elevationGainMeters: 0,
      durationSeconds: 0,
      pointCount: 0,
    });
    setStatus("recording");
    startWatch();
  };

  const pauseRecording = () => {
    stopWatch();
    pausedAtRef.current = Date.now();
    setStats((prev) => ({ ...prev, durationSeconds: activeDurationSec() }));
    setStatus("paused");
  };

  const resumeRecording = () => {
    if (pausedAtRef.current != null) {
      pauseAccumRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
    setStatus("recording");
    startWatch();
    void flushActivityQueue();
  };

  const stopRecording = async () => {
    stopWatch();
    const id = activityIdRef.current;
    if (!id) return;
    const current = {
      ...statsRef.current,
      durationSeconds: activeDurationSec(),
    };
    setStats(current);
    const result = await finishActivity(id, current);
    setOffline(!result.synced);
    setStatus("idle");
    setActivityId(null);
    onComplete?.(id);
    if (!result.synced) {
      setError("Saved on this device. Will sync when you are back online.");
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

        {offline && (
          <p className="text-xs text-muted-foreground">
            Recording offline — points stay on this phone until they sync.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          {status === "idle" && (
            <Button onClick={() => void startRecording()} className="flex-1">
              <Play className="mr-2 h-4 w-4" />
              Start recording
            </Button>
          )}
          {status === "recording" && (
            <>
              <Button variant="secondary" onClick={pauseRecording}>
                <Pause className="mr-2 h-4 w-4" />
                Pause
              </Button>
              <Button variant="destructive" onClick={() => void stopRecording()} className="flex-1">
                <Square className="mr-2 h-4 w-4" />
                Stop & save
              </Button>
            </>
          )}
          {status === "paused" && (
            <>
              <Button onClick={resumeRecording} className="flex-1">
                <Play className="mr-2 h-4 w-4" />
                Resume
              </Button>
              <Button variant="destructive" onClick={() => void stopRecording()}>
                <Square className="mr-2 h-4 w-4" />
                Stop
              </Button>
            </>
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
