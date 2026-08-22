"use client";
import { apiFetch } from "@/lib/api/client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatPace,
} from "@/lib/geo";
import { createGainTracker, type GainTracker } from "@/lib/geo/elevation-gain";
import {
  beginActivity,
  finishActivity,
  flushActivityQueue,
  saveActivityPoint,
} from "@/lib/offline/activity-sync";
import { usePointSync } from "@/hooks/use-point-sync";
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

type RecordedPoint = { lat: number; lng: number; elevation?: number; recordedAt: Date };

const EMPTY_STATS: LiveStats = {
  distanceMeters: 0,
  elevationGainMeters: 0,
  durationSeconds: 0,
  pointCount: 0,
};

export function ActivityRecorder({
  trailId,
  planId,
  onComplete,
}: ActivityRecorderProps) {
  const [status, setStatus] = useState<"idle" | "recording" | "paused">("idle");
  const [activityId, setActivityId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [stats, setStats] = useState<LiveStats>(EMPTY_STATS);
  const [error, setError] = useState<string | null>(null);
  const pointSync = usePointSync();

  const watchIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pauseAccumRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const lastPointRef = useRef<RecordedPoint | null>(null);
  const statusRef = useRef(status);
  const activityIdRef = useRef<string | null>(null);
  const statsRef = useRef(stats);
  const gainTrackerRef = useRef<GainTracker>(createGainTracker());

  useEffect(() => {
    statusRef.current = status;
    activityIdRef.current = activityId;
    statsRef.current = stats;
  }, [status, activityId, stats]);

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

  const persistSnapshot = useCallback(async (keepalive = false) => {
    const id = activityIdRef.current;
    if (!id || statusRef.current === "idle") return;
    const current = { ...statsRef.current, durationSeconds: activeDurationSec() };
    try {
      await apiFetch(`/api/activities/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stats: current }),
        keepalive,
      });
    } catch {
      /* offline — local queue still holds the points */
    }
  }, [activeDurationSec]);

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
        if (Number.isFinite(position.coords.accuracy) && position.coords.accuracy > 50) return;

        const point: RecordedPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          elevation: position.coords.altitude ?? undefined,
          recordedAt: new Date(),
        };
        const previous = lastPointRef.current;

        if (previous) {
          const distance = haversineMeters(previous.lat, previous.lng, point.lat, point.lng);
          const elapsedMs = point.recordedAt.getTime() - previous.recordedAt.getTime();
          if (distance < 10 && elapsedMs < 30_000) return;

          // Two-stage filter (≥8 m hysteresis): never a raw positive-delta sum.
          const elevationGainMeters = gainTrackerRef.current.add(point.elevation);
          setStats((prev) => ({
            distanceMeters: prev.distanceMeters + distance,
            elevationGainMeters,
            durationSeconds: activeDurationSec(),
            pointCount: prev.pointCount + 1,
          }));
        } else {
          gainTrackerRef.current.add(point.elevation);
          setStats((prev) => ({
            ...prev,
            durationSeconds: activeDurationSec(),
            pointCount: prev.pointCount + 1,
          }));
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

  /**
   * Surfaces a queue write that could not be stored.
   *
   * A QuotaExceededError while queueing a GPS point used to be swallowed, so the
   * recorder kept showing a healthy recording while fixes were being dropped --
   * the hiker believed their track was being saved when it was not. This is
   * sticky on purpose: a transient banner is no use to someone who is walking.
   */
  const [queueProblem, setQueueProblem] = useState<string | null>(null);
  useEffect(() => {
    const onQueueError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setQueueProblem(
        detail?.message ??
          "This device is out of storage, so some GPS points were not saved. Free space or stop and sync when you have signal.",
      );
    };
    window.addEventListener("hike-points-queue-error", onQueueError);
    return () => window.removeEventListener("hike-points-queue-error", onQueueError);
  }, []);

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
    const onKeepalive = () => {
      void flushActivityQueue();
      void persistSnapshot(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onKeepalive);
    document.addEventListener("visibilitychange", onKeepalive);
    void flushActivityQueue();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onKeepalive);
      document.removeEventListener("visibilitychange", onKeepalive);
    };
  }, [persistSnapshot]);

  const startRecording = async () => {
    setError(null);
    const started = await beginActivity({ trailId, planId });
    setActivityId(started.id);
    setOffline(started.offline);
    if (started.offline) {
      setError("Started offline on this phone. Points queue locally and replay when you are back online.");
    }
    startTimeRef.current = Date.now();
    pauseAccumRef.current = 0;
    pausedAtRef.current = null;
    lastPointRef.current = null;
    gainTrackerRef.current = createGainTracker();
    setStats(EMPTY_STATS);
    setStatus("recording");
    startWatch();
  };

  const pauseRecording = () => {
    if (statusRef.current !== "recording") return;
    stopWatch();
    pausedAtRef.current = Date.now();
    setStats((prev) => ({ ...prev, durationSeconds: activeDurationSec() }));
    setStatus("paused");
    void flushActivityQueue();
  };

  const resumeRecording = () => {
    if (statusRef.current !== "paused") return;
    if (pausedAtRef.current != null) {
      pauseAccumRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
    // Movement while paused must not become hiking distance on the first fix after
    // resume — the hiker may have walked to a new spot before tapping Resume.
    lastPointRef.current = null;
    setStatus("recording");
    startWatch();
    void flushActivityQueue();
  };

  const stopRecording = async () => {
    if (statusRef.current === "recording") {
      pausedAtRef.current = Date.now();
    }
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
                ? formatPace(stats.durationSeconds / 60 / (stats.distanceMeters / 1000))
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
        {queueProblem && (
          <p
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-2 text-sm font-medium text-destructive"
          >
            {queueProblem}
          </p>
        )}
        {pointSync.pending > 0 && (
          <p className="text-sm text-muted-foreground">
            {pointSync.syncing
              ? "Syncing"
              : `${pointSync.pending} point${pointSync.pending === 1 ? "" : "s"} waiting to sync`}
            {pointSync.lastError ? `: ${pointSync.lastError}` : ""}
          </p>
        )}
        {pointSync.dropped > 0 && (
          <p className="text-sm text-destructive">
            {pointSync.dropped} recorded point{pointSync.dropped === 1 ? "" : "s"} could not be saved
            and {pointSync.dropped === 1 ? "was" : "were"} discarded — the activity they belong to
            no longer exists on the server.
          </p>
        )}

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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
