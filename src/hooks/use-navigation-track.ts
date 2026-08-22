"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendNavPoint,
  finishNavSession,
  formatNavTrackStorageError,
  getNavSession,
  resumeOrStartNavSession,
  type NavTrackPoint,
  type NavTrackPointInput,
} from "@/lib/offline/nav-track";

export type VisibleTrackPoint = Pick<NavTrackPoint, "lat" | "lng" | "recordedAt"> &
  Partial<Pick<NavTrackPoint, "pointId" | "sessionId" | "sequence" | "accuracy" | "altitude">>;

type QueuedTrackPoint = NavTrackPointInput & { pointId: string };

export type TrackPersistenceState =
  | { status: "opening" }
  | { status: "pending"; queued: number }
  | { status: "finishing" }
  | { status: "saved"; pointCount: number; resumed: boolean }
  | { status: "error"; message: string };

export interface NavigationTrackFix {
  lat: number;
  lng: number;
  accuracy?: number;
  altitude?: number;
  recordedAt: number;
}

function pendingTrackPoint(point: QueuedTrackPoint): VisibleTrackPoint {
  return {
    pointId: point.pointId,
    lat: point.lat,
    lng: point.lng,
    accuracy: point.accuracy,
    altitude: point.altitude,
    recordedAt: new Date(point.recordedAt ?? Date.now()).toISOString(),
  };
}

function mergePersistedTrackPoints(
  persisted: NavTrackPoint[],
  visible: VisibleTrackPoint[],
): VisibleTrackPoint[] {
  const persistedIds = new Set(persisted.map((point) => point.pointId));
  const retainedIds = new Set<string>();
  const retained = visible.filter((point) => {
    if (!point.pointId) return true;
    if (persistedIds.has(point.pointId) || retainedIds.has(point.pointId)) return false;
    retainedIds.add(point.pointId);
    return true;
  });
  return [...persisted, ...retained];
}

function mergeSavedTrackPoint(
  visible: VisibleTrackPoint[],
  saved: NavTrackPoint,
  pendingPointId = saved.pointId,
): VisibleTrackPoint[] {
  const next: VisibleTrackPoint[] = [];
  let inserted = false;
  for (const point of visible) {
    if (point.pointId === pendingPointId || point.pointId === saved.pointId) {
      if (!inserted) next.push(saved);
      inserted = true;
    } else {
      next.push(point);
    }
  }
  if (!inserted) next.push(saved);
  return next;
}

function gpsFixSourceKey(point: NavigationTrackFix): string {
  return [
    "gps",
    point.recordedAt,
    point.lat,
    point.lng,
    point.accuracy ?? "",
    point.altitude ?? "",
  ].join(":");
}

/**
 * Owns the append-only breadcrumb lifecycle for the navigation screen.
 *
 * Every trusted GPS fix is retained in memory immediately. IndexedDB writes
 * are drained in captured order without sampling; if a write fails, later
 * fixes queue behind it until the user explicitly retries.
 */
export function useNavigationTrack(options: {
  packId: string | null;
  name: string | null;
  fix: NavigationTrackFix | null;
}) {
  const { packId, name, fix } = options;
  const [points, setPoints] = useState<VisibleTrackPoint[]>([]);
  const [persistence, setPersistence] = useState<TrackPersistenceState>({
    status: "opening",
  });
  const [retryToken, setRetryToken] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const sessionResumedRef = useRef(false);
  const packIdRef = useRef<string | null>(null);
  const drainRunningRef = useRef(false);
  const saveBlockedRef = useRef(false);
  const finishingRef = useRef(false);
  const pendingRef = useRef<QueuedTrackPoint[]>([]);

  const drain = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || drainRunningRef.current || saveBlockedRef.current) return;

    drainRunningRef.current = true;
    void (async () => {
      while (sessionIdRef.current === sessionId && pendingRef.current.length > 0) {
        const point = pendingRef.current[0];
        setPersistence({ status: "pending", queued: pendingRef.current.length });
        try {
          const saved = await appendNavPoint(sessionId, point);
          if (pendingRef.current[0]?.pointId === point.pointId) {
            pendingRef.current.shift();
          } else {
            pendingRef.current = pendingRef.current.filter(
              (candidate) => candidate.pointId !== point.pointId,
            );
          }
          setPoints((current) => mergeSavedTrackPoint(current, saved, point.pointId));
        } catch (error) {
          saveBlockedRef.current = true;
          setPersistence({
            status: "error",
            message: formatNavTrackStorageError(error),
          });
          return;
        }
      }

      if (sessionIdRef.current === sessionId) {
        const session = await getNavSession(sessionId);
        if (session) {
          setPoints((current) => mergePersistedTrackPoints(session.points, current));
          setPersistence({
            status: "saved",
            pointCount: session.pointCount,
            resumed: sessionResumedRef.current,
          });
        }
      }
    })()
      .catch((error) => {
        saveBlockedRef.current = true;
        setPersistence({
          status: "error",
          message: formatNavTrackStorageError(error),
        });
      })
      .finally(() => {
        drainRunningRef.current = false;
      });
  }, []);

  useEffect(() => {
    if (!packId || !name) return;
    let cancelled = false;

    if (packIdRef.current !== packId) {
      packIdRef.current = packId;
      pendingRef.current = [];
      queueMicrotask(() => setPoints([]));
    }
    sessionIdRef.current = null;
    saveBlockedRef.current = false;
    finishingRef.current = false;
    queueMicrotask(() => setPersistence({ status: "opening" }));
    void resumeOrStartNavSession(packId, name)
      .then(async ({ sessionId, resumed }) => {
        if (cancelled) return;
        sessionIdRef.current = sessionId;
        sessionResumedRef.current = resumed;
        const session = await getNavSession(sessionId);
        if (cancelled) return;
        if (!session) throw new Error("The active breadcrumb session could not be read.");
        setPoints((current) => mergePersistedTrackPoints(session.points, current));
        setPersistence(
          pendingRef.current.length > 0
            ? { status: "pending", queued: pendingRef.current.length }
            : { status: "saved", pointCount: session.pointCount, resumed },
        );
        drain();
      })
      .catch((error) => {
        if (cancelled) return;
        saveBlockedRef.current = true;
        setPersistence({
          status: "error",
          message: formatNavTrackStorageError(error),
        });
      });

    return () => {
      cancelled = true;
      sessionIdRef.current = null;
    };
  }, [packId, name, retryToken, drain]);

  useEffect(() => {
    if (!fix || !packId || finishingRef.current) return;
    const point: QueuedTrackPoint = {
      ...fix,
      pointId: crypto.randomUUID(),
      sourceKey: gpsFixSourceKey(fix),
    };
    pendingRef.current.push(point);
    queueMicrotask(() => {
      setPoints((current) => [...current, pendingTrackPoint(point)]);
      setPersistence({ status: "pending", queued: pendingRef.current.length });
      drain();
    });
  }, [fix, packId, drain]);

  const retry = useCallback(() => {
    saveBlockedRef.current = false;
    setPersistence({ status: "pending", queued: pendingRef.current.length });
    if (sessionIdRef.current) drain();
    else setRetryToken((value) => value + 1);
  }, [drain]);

  const finish = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      const error = new Error("The active breadcrumb session could not be found.");
      setPersistence({ status: "error", message: formatNavTrackStorageError(error) });
      throw error;
    }
    finishingRef.current = true;
    saveBlockedRef.current = true;
    setPersistence({ status: "finishing" });
    try {
      await finishNavSession(sessionId);
    } catch (error) {
      finishingRef.current = false;
      setPersistence({ status: "error", message: formatNavTrackStorageError(error) });
      throw error;
    }
  }, []);

  return { points, persistence, retry, finish };
}
