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
  loadOpenActivityRecovery,
  saveLocalActivitySnapshot,
  saveActivityPoint,
} from "@/lib/offline/activity-sync";
import { PointSaveBarrier } from "@/components/activities/point-save-barrier";
import { getPendingPointCount } from "@/lib/offline";
import { usePointSync } from "@/hooks/use-point-sync";
import { Pause, Play, Square } from "lucide-react";
import { subscribeNetworkStatus } from "@/lib/platform/network";
import { startGeoWatch } from "@/lib/platform/geolocation";
import { getPlatformAdapters } from "@/lib/platform/adapters";

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

type RecorderRecoveryUi =
  | { state: "checking" }
  | { state: "none" }
  | { state: "recovered"; message: string; serverVerified: boolean }
  | { state: "blocked"; message: string; candidateCount: number };

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
  const [status, setStatus] = useState<"idle" | "recording" | "paused" | "stopping">("idle");
  const [activityId, setActivityId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [stats, setStats] = useState<LiveStats>(EMPTY_STATS);
  const [error, setError] = useState<string | null>(null);
  const [queueProblem, setQueueProblem] = useState<string | null>(null);
  const [recoveryUi, setRecoveryUi] = useState<RecorderRecoveryUi>({ state: "checking" });
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const pointSync = usePointSync();

  const stopWatchRef = useRef<(() => void) | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pauseAccumRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const lastPointRef = useRef<RecordedPoint | null>(null);
  const statusRef = useRef(status);
  const activityIdRef = useRef<string | null>(null);
  const statsRef = useRef(stats);
  const gainTrackerRef = useRef<GainTracker>(createGainTracker());
  const recoveredGainBaseRef = useRef(0);
  const pointSavesRef = useRef(new PointSaveBarrier());
  const stoppingRef = useRef(false);
  const startingRef = useRef(false);

  const updateStats = useCallback((update: LiveStats | ((current: LiveStats) => LiveStats)) => {
    const next = typeof update === "function" ? update(statsRef.current) : update;
    // Persistence and Stop read the ref because React may not commit state before a
    // navigation cleanup or a same-turn button action. Keep it current synchronously.
    statsRef.current = next;
    setStats(next);
  }, []);

  useEffect(() => {
    statusRef.current = status;
    activityIdRef.current = activityId;
  }, [status, activityId]);

  const stopWatch = useCallback(() => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
  }, []);

  const activeDurationSec = useCallback(() => {
    if (startTimeRef.current == null) return 0;
    const frozen = pausedAtRef.current ?? Date.now();
    return Math.max(0, (frozen - startTimeRef.current - pauseAccumRef.current) / 1000);
  }, []);

  const persistSnapshot = useCallback(async (keepalive = false) => {
    const id = activityIdRef.current;
    if (!id || statusRef.current === "idle" || statusRef.current === "stopping") return;
    const current = { ...statsRef.current, durationSeconds: activeDurationSec() };
    try {
      const remoteId = await saveLocalActivitySnapshot(id, current);
      if (!remoteId) return;
      await apiFetch(`/api/activities/${encodeURIComponent(remoteId)}`, {
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
    if (!getPlatformAdapters().geolocation && !navigator.geolocation) {
      setError("Geolocation is not available on this device.");
      return;
    }
    stopWatch();
    // background: true — recording is the one flow that must keep appending
    // points with the screen locked; the shell's native watcher delivers that,
    // and the web fallback stays foreground-only exactly as before.
    stopWatchRef.current = startGeoWatch(
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
          const elevationGainMeters =
            recoveredGainBaseRef.current + gainTrackerRef.current.add(point.elevation);
          updateStats((prev) => ({
            distanceMeters: prev.distanceMeters + distance,
            elevationGainMeters,
            durationSeconds: activeDurationSec(),
            pointCount: prev.pointCount + 1,
          }));
        } else {
          gainTrackerRef.current.add(point.elevation);
          updateStats((prev) => ({
            ...prev,
            durationSeconds: activeDurationSec(),
            pointCount: prev.pointCount + 1,
          }));
        }

        lastPointRef.current = point;
        const save = pointSavesRef.current.track(saveActivityPoint(id, point));
        void save
          .then((result) => {
            if (result === "queued") setOffline(true);
            if (result === "rejected-finalized") {
              setQueueProblem(
                "A GPS point was not saved because this activity was already finalized on the server.",
              );
            }
          })
          .catch((saveError) => {
            setQueueProblem(
              saveError instanceof Error
                ? saveError.message
                : "A GPS point could not be saved on this device.",
            );
          });
      },
      (err) => setError(err.message),
      { background: true, enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    );
  }, [activeDurationSec, stopWatch, updateStats]);

  useEffect(() => () => stopWatch(), [stopWatch]);

  /**
   * Surfaces a queue write that could not be stored.
   *
   * A QuotaExceededError while queueing a GPS point used to be swallowed, so the
   * recorder kept showing a healthy recording while fixes were being dropped --
   * the hiker believed their track was being saved when it was not. This is
   * sticky on purpose: a transient banner is no use to someone who is walking.
   */
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
      updateStats((prev) => ({ ...prev, durationSeconds: activeDurationSec() }));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [status, activeDurationSec, updateStats]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setRecoveryUi({ state: "checking" });
    });
    void loadOpenActivityRecovery({ trailId, planId })
      .then((recovery) => {
        if (cancelled) return;
        if (recovery.status === "none") {
          setRecoveryUi({ state: "none" });
          return;
        }
        if (recovery.status === "blocked") {
          statusRef.current = "idle";
          activityIdRef.current = null;
          setStatus("idle");
          setActivityId(null);
          setRecoveryUi({
            state: "blocked",
            message: recovery.message,
            candidateCount: recovery.candidateCount,
          });
          return;
        }

        const recoveredStats: LiveStats = {
          distanceMeters: recovery.activity.stats?.distanceMeters ?? 0,
          elevationGainMeters: recovery.activity.stats?.elevationGainMeters ?? 0,
          durationSeconds: recovery.activity.stats?.durationSeconds ?? 0,
          pointCount: recovery.activity.stats?.pointCount ?? 0,
        };
        const recoveredAt = Date.now();
        pointSavesRef.current = new PointSaveBarrier();
        stoppingRef.current = false;
        activityIdRef.current = recovery.activity.id;
        statusRef.current = "paused";
        startTimeRef.current = recoveredAt - recoveredStats.durationSeconds * 1000;
        pauseAccumRef.current = 0;
        pausedAtRef.current = recoveredAt;
        lastPointRef.current = null;
        recoveredGainBaseRef.current = recoveredStats.elevationGainMeters;
        gainTrackerRef.current = createGainTracker();
        setActivityId(recovery.activity.id);
        updateStats(recoveredStats);
        setOffline(!recovery.activity.remoteId);
        setStatus("paused");
        setRecoveryUi({
          state: "recovered",
          message: recovery.message,
          serverVerified: recovery.serverVerified,
        });
      })
      .catch((recoveryError) => {
        if (cancelled) return;
        statusRef.current = "idle";
        setStatus("idle");
        setRecoveryUi({
          state: "blocked",
          candidateCount: 0,
          message: recoveryError instanceof Error
            ? `Could not safely check unfinished recordings: ${recoveryError.message}`
            : "Could not safely check unfinished recordings. GPS remains off.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [planId, recoveryAttempt, trailId, updateStats]);

  useEffect(() => {
    if (recoveryUi.state === "checking" || recoveryUi.state === "blocked") return;
    const onOnline = () => {
      // Clear the offline-recording banner only when the flush actually drained the
      // queue: a radio blip fired 'online', the flush delivered nothing, and the
      // banner still vanished while every point stayed queued.
      void flushActivityQueue().then(async () => {
        if ((await getPendingPointCount()) === 0) setOffline(false);
      });
    };
    const onKeepalive = () => {
      void flushActivityQueue();
      void persistSnapshot(true);
    };
    const unsubscribeNetwork = subscribeNetworkStatus((online) => {
      if (online) onOnline();
    });
    window.addEventListener("pagehide", onKeepalive);
    document.addEventListener("visibilitychange", onKeepalive);
    void flushActivityQueue();
    return () => {
      unsubscribeNetwork();
      window.removeEventListener("pagehide", onKeepalive);
      document.removeEventListener("visibilitychange", onKeepalive);
      // Next.js client navigation does not fire pagehide or visibilitychange.
      // Start the durable snapshot before the replacement recorder can recover
      // this activity; activity-sync's recovery gate waits for this write.
      void persistSnapshot(true);
    };
  }, [persistSnapshot, recoveryUi.state]);

  const startRecording = async () => {
    if (recoveryUi.state !== "none") return;
    // Single-flight: beginActivity is async, and a double tap on Start used to create
    // TWO open local activities — which the recovery gate then refused to reconcile,
    // permanently blocking recording on the device. The ref guards re-entry during the
    // await; the status check guards a tap that lands after recording began.
    if (startingRef.current || statusRef.current !== "idle") return;
    startingRef.current = true;
    setError(null);
    setQueueProblem(null);
    let started: Awaited<ReturnType<typeof beginActivity>>;
    try {
      started = await beginActivity({ trailId, planId });
    } finally {
      startingRef.current = false;
    }
    pointSavesRef.current = new PointSaveBarrier();
    stoppingRef.current = false;
    activityIdRef.current = started.id;
    statusRef.current = "recording";
    setActivityId(started.id);
    setOffline(started.offline);
    if (started.offline) {
      setError("Started offline on this phone. Points queue locally and replay when you are back online.");
    }
    startTimeRef.current = Date.now();
    pauseAccumRef.current = 0;
    pausedAtRef.current = null;
    lastPointRef.current = null;
    recoveredGainBaseRef.current = 0;
    gainTrackerRef.current = createGainTracker();
    updateStats(EMPTY_STATS);
    setStatus("recording");
    startWatch();
  };

  const pauseRecording = () => {
    if (statusRef.current !== "recording") return;
    statusRef.current = "paused";
    stopWatch();
    pausedAtRef.current = Date.now();
    updateStats((prev) => ({ ...prev, durationSeconds: activeDurationSec() }));
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
    if (recoveryUi.state === "recovered") setRecoveryUi({ state: "none" });
    statusRef.current = "recording";
    setStatus("recording");
    startWatch();
    void flushActivityQueue();
  };

  const stopRecording = async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (statusRef.current === "recording") {
      pausedAtRef.current = Date.now();
    }
    // Reject any geolocation callback already queued by the browser before waiting for
    // saves that have passed the recording-state check.
    statusRef.current = "stopping";
    setStatus("stopping");
    stopWatch();
    try {
      await pointSavesRef.current.drain();
      const id = activityIdRef.current;
      if (!id) {
        statusRef.current = "idle";
        setStatus("idle");
        return;
      }
      const current = {
        ...statsRef.current,
        durationSeconds: activeDurationSec(),
      };
      updateStats(current);
      const result = await finishActivity(id, current);
      setOffline(!result.synced);
      statusRef.current = "idle";
      activityIdRef.current = null;
      setStatus("idle");
      setActivityId(null);
      setRecoveryUi({ state: "none" });
      onComplete?.(id);
      if (result.rejectedPoints > 0) {
        setQueueProblem(
          `${result.rejectedPoints} GPS point${result.rejectedPoints === 1 ? " was" : "s were"} not saved because this activity was already finalized on the server.`,
        );
      }
      if (!result.synced) {
        setError("Saved on this device. Will sync when you are back online.");
      }
    } catch (stopError) {
      statusRef.current = "paused";
      setStatus("paused");
      setError(
        stopError instanceof Error
          ? `Could not finish this activity: ${stopError.message}`
          : "Could not finish this activity. Try Stop again.",
      );
    } finally {
      stoppingRef.current = false;
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
        {recoveryUi.state === "checking" && (
          <p role="status" className="text-sm text-muted-foreground">
            Checking this device for an unfinished recording…
          </p>
        )}
        {recoveryUi.state === "recovered" && (
          <p role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
            <strong>Unfinished recording recovered.</strong> {recoveryUi.message} Resume continues
            from the saved totals; Stop finishes it without turning GPS on.
            {recoveryUi.serverVerified
              ? " The server still reports this activity open."
              : " Server status is unverified, so review the saved totals before resuming."}
          </p>
        )}
        {recoveryUi.state === "blocked" && (
          <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-2 text-sm text-destructive">
            <strong>Recording recovery needs attention.</strong> {recoveryUi.message} Do not start
            another recording until the unfinished activities are reconciled.
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
          {status === "idle" && recoveryUi.state === "none" && (
            <Button onClick={() => void startRecording()} className="flex-1">
              <Play className="mr-2 h-4 w-4" />
              Start recording
            </Button>
          )}
          {status === "idle" && recoveryUi.state === "checking" && (
            <Button disabled className="flex-1">
              Checking unfinished recordings…
            </Button>
          )}
          {status === "idle" && recoveryUi.state === "blocked" && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setRecoveryAttempt((attempt) => attempt + 1)}
            >
              Retry unfinished activity recovery
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
          {status === "stopping" && (
            <Button disabled className="flex-1">
              Saving final point…
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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
