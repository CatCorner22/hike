"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDistance, formatDuration, formatElevation, formatPace } from "@/lib/geo";
import { queueActivityPoint } from "@/lib/offline";
import { usePointSync } from "@/hooks/use-point-sync";
import { Pause, Play, Square } from "lucide-react";

interface ActivityRecorderProps { trailId?: string; planId?: string; onComplete?: (activityId: string) => void; }
interface LiveStats { distanceMeters: number; elevationGainMeters: number; durationSeconds: number; pointCount: number; }
type RecordedPoint = { lat: number; lng: number; elevation?: number; recordedAt: Date };
const EMPTY_STATS: LiveStats = { distanceMeters: 0, elevationGainMeters: 0, durationSeconds: 0, pointCount: 0 };

export function ActivityRecorder({ trailId, planId, onComplete }: ActivityRecorderProps) {
  const [status, setStatus] = useState<"idle" | "recording" | "paused">("idle");
  const [stats, setStats] = useState<LiveStats>(EMPTY_STATS);
  const [error, setError] = useState<string | null>(null);
  const pointSync = usePointSync();
  const watchIdRef = useRef<number | null>(null);
  const activityIdRef = useRef<string | null>(null);
  const statusRef = useRef<"idle" | "recording" | "paused">("idle");
  const activeStartedAtRef = useRef<number | null>(null);
  const accumulatedMovingMsRef = useRef(0);
  const lastPointRef = useRef<RecordedPoint | null>(null);
  const pointsRef = useRef<RecordedPoint[]>([]);
  const uploadQueueRef = useRef<RecordedPoint[]>([]);
  const uploadTimerRef = useRef<number | null>(null);
  const uploadingRef = useRef(false);
  const statsRef = useRef<LiveStats>(EMPTY_STATS);

  const updateStats = useCallback((update: (previous: LiveStats) => LiveStats) => {
    const next = update(statsRef.current);
    statsRef.current = next;
    setStats(next);
  }, []);
  const setRecorderStatus = useCallback((next: "idle" | "recording" | "paused") => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);
  const currentDurationSeconds = useCallback(() => {
    const activeMs = activeStartedAtRef.current ? Date.now() - activeStartedAtRef.current : 0;
    return (accumulatedMovingMsRef.current + activeMs) / 1000;
  }, []);

  const flushUploadQueue = useCallback(async () => {
    const id = activityIdRef.current;
    if (!id || uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      while (uploadQueueRef.current.length > 0) {
        const batch = uploadQueueRef.current.splice(0, 100);
        try {
          const response = await fetch(`/api/activities/${encodeURIComponent(id)}/points`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ points: batch.map((point) => ({
              lat: point.lat, lng: point.lng, elevation: point.elevation, recordedAt: point.recordedAt.toISOString(),
            })) }),
          });
          if (!response.ok) throw new Error("Point upload failed");
        } catch {
          await Promise.all(batch.map((point) => queueActivityPoint({ activityId: id, ...point })));
        }
      }
    } finally { uploadingRef.current = false; }
  }, []);

  const scheduleUpload = useCallback(() => {
    if (uploadTimerRef.current != null) return;
    uploadTimerRef.current = window.setTimeout(() => {
      uploadTimerRef.current = null;
      void flushUploadQueue();
    }, 5_000);
  }, [flushUploadQueue]);

  const recordFix = useCallback((position: GeolocationPosition) => {
    if (statusRef.current !== "recording") return;
    if (Number.isFinite(position.coords.accuracy) && position.coords.accuracy > 50) return;
    const point: RecordedPoint = {
      lat: position.coords.latitude, lng: position.coords.longitude,
      elevation: position.coords.altitude ?? undefined, recordedAt: new Date(),
    };
    const previous = lastPointRef.current;
    if (previous) {
      const distance = haversineMeters(previous.lat, previous.lng, point.lat, point.lng);
      const elapsedMs = point.recordedAt.getTime() - previous.recordedAt.getTime();
      if (distance < 10 && elapsedMs < 30_000) return;
      updateStats((current) => ({
        distanceMeters: current.distanceMeters + distance,
        elevationGainMeters: current.elevationGainMeters + (
          point.elevation != null && previous.elevation != null && point.elevation > previous.elevation
            ? point.elevation - previous.elevation : 0),
        durationSeconds: currentDurationSeconds(), pointCount: current.pointCount + 1,
      }));
    } else {
      updateStats((current) => ({ ...current, durationSeconds: currentDurationSeconds(), pointCount: current.pointCount + 1 }));
    }
    lastPointRef.current = point;
    pointsRef.current.push(point);
    uploadQueueRef.current.push(point);
    scheduleUpload();
  }, [currentDurationSeconds, scheduleUpload, updateStats]);

  const startWatch = useCallback(() => {
    if (!("geolocation" in navigator)) { setError("This device has no GPS."); return; }
    stopWatch();
    watchIdRef.current = navigator.geolocation.watchPosition(recordFix, (gpsError) => setError(gpsError.message), {
      enableHighAccuracy: true, maximumAge: 2_000, timeout: 10_000,
    });
  }, [recordFix, stopWatch]);

  useEffect(() => {
    if (status !== "recording") return;
    const interval = window.setInterval(() => {
      updateStats((current) => ({ ...current, durationSeconds: currentDurationSeconds() }));
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [currentDurationSeconds, status, updateStats]);

  useEffect(() => () => {
    stopWatch();
    if (uploadTimerRef.current != null) window.clearTimeout(uploadTimerRef.current);
    void flushUploadQueue();
    const id = activityIdRef.current;
    if (id && statusRef.current !== "idle") {
      void fetch(`/api/activities/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endedAt: new Date().toISOString(), stats: { ...statsRef.current, durationSeconds: currentDurationSeconds() } }),
      });
    }
  }, [currentDurationSeconds, flushUploadQueue, stopWatch]);

  const startRecording = async () => {
    setError(null);
    try {
      const response = await fetch("/api/activities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trailId, planId, startedAt: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error("Failed to start activity");
      const data = await response.json();
      activityIdRef.current = data.id;
      pointsRef.current = []; uploadQueueRef.current = []; lastPointRef.current = null;
      statsRef.current = EMPTY_STATS; setStats(EMPTY_STATS);
      accumulatedMovingMsRef.current = 0; activeStartedAtRef.current = Date.now();
      setRecorderStatus("recording");
      startWatch();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to start"); }
  };

  const pauseRecording = () => {
    if (statusRef.current !== "recording") return;
    if (activeStartedAtRef.current) accumulatedMovingMsRef.current += Date.now() - activeStartedAtRef.current;
    activeStartedAtRef.current = null;
    updateStats((current) => ({ ...current, durationSeconds: currentDurationSeconds() }));
    stopWatch();
    setRecorderStatus("paused");
    void flushUploadQueue();
  };

  const resumeRecording = () => {
    if (statusRef.current !== "paused") return;
    activeStartedAtRef.current = Date.now();
    setRecorderStatus("recording");
    startWatch();
  };

  const stopRecording = async () => {
    if (statusRef.current === "recording") pauseRecording();
    stopWatch();
    if (!activityIdRef.current) return;
    await flushUploadQueue();
    const id = activityIdRef.current;
    const finalStats = { ...statsRef.current, durationSeconds: currentDurationSeconds() };
    updateStats(() => finalStats);
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endedAt: new Date().toISOString(), stats: finalStats }),
      });
      if (!response.ok) throw new Error("Failed to save activity");
      setRecorderStatus("idle"); activityIdRef.current = null;
      onComplete?.(id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to stop"); }
  };

  return <Card><CardContent className="space-y-4 pt-6">
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="Distance" value={formatDistance(stats.distanceMeters)} />
      <Stat label="Elev gain" value={formatElevation(stats.elevationGainMeters)} />
      <Stat label="Duration" value={formatDuration(stats.durationSeconds)} />
      <Stat label="Pace" value={stats.distanceMeters > 0 ? formatPace(stats.durationSeconds / 60 / (stats.distanceMeters / 1000)) : "—"} />
    </div>
    {error && <p className="text-sm text-destructive">{error}</p>}
    {pointSync.pending > 0 && <p className="text-sm text-muted-foreground">{pointSync.syncing ? "Syncing" : `${pointSync.pending} point${pointSync.pending === 1 ? "" : "s"} waiting to sync`}{pointSync.lastError ? `: ${pointSync.lastError}` : ""}</p>}
    <div className="flex gap-2">
      {status === "idle" && <Button onClick={startRecording} className="flex-1"><Play className="mr-2 h-4 w-4" />Start recording</Button>}
      {status === "recording" && <><Button variant="secondary" onClick={pauseRecording}><Pause className="mr-2 h-4 w-4" />Pause</Button><Button variant="destructive" onClick={stopRecording} className="flex-1"><Square className="mr-2 h-4 w-4" />Stop & save</Button></>}
      {status === "paused" && <><Button onClick={resumeRecording} className="flex-1"><Play className="mr-2 h-4 w-4" />Resume</Button><Button variant="destructive" onClick={stopRecording}><Square className="mr-2 h-4 w-4" />Stop & save</Button></>}
    </div>
  </CardContent></Card>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p></div>; }
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(lat2 - lat1); const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
