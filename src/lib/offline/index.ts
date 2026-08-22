import { apiFetch } from "@/lib/api/client";
import { openDB, unwrap, type DBSchema, type IDBPDatabase } from "idb";
import { MAX_ACTIVITY_POINTS } from "@/lib/api/validate";
import type { LocalActivity } from "@/lib/offline/activity-sync";

interface PendingPoint {
  id: string;
  activityId: string;
  lat: number;
  lng: number;
  elevation?: number;
  recordedAt: string;
  synced: 0 | 1;
}

interface HikeDB extends DBSchema {
  pendingPoints: { key: string; value: PendingPoint; indexes: { "by-activity": string; "by-synced": number } };
  localActivities: { key: string; value: LocalActivity };
}

const OFFLINE_DB_VERSION = 2;
const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const ROUTE_PACK_STORAGE_RESERVE_BYTES = 16 * 1024 * 1024;
export const ESTIMATED_PENDING_POINT_BYTES = 512;
/**
 * Bound the all-points-in-memory flush without letting old unsynced activities stop a
 * new trip after only 2,000 points. The per-activity ceiling prevents an offline-only
 * recording from outrunning the API, while the larger device budget covers several
 * trips when quota estimates are absent. The server remains authoritative for mixed
 * online/offline recordings because IndexedDB cannot observe points accepted elsewhere.
 */
export const MAX_PENDING_POINTS_PER_ACTIVITY = MAX_ACTIVITY_POINTS;
export const MAX_PENDING_POINT_STORAGE_BYTES = 32 * 1024 * 1024;
export const MAX_PENDING_POINT_COUNT = Math.floor(
  MAX_PENDING_POINT_STORAGE_BYTES / ESTIMATED_PENDING_POINT_BYTES,
);
let dbPromise: Promise<IDBPDatabase<HikeDB>> | null = null;
let flushPromise: Promise<FlushResult> | null = null;
let pointWriteQueue: Promise<void> = Promise.resolve();

export class OfflinePointQueueFullError extends Error {
  readonly diagnostic?: string;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "OfflinePointQueueFullError";
    this.diagnostic = cause instanceof Error ? cause.message : undefined;
  }
}

export function getOfflineDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<HikeDB>("hike-offline", OFFLINE_DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const points = db.createObjectStore("pendingPoints", { keyPath: "id" });
          points.createIndex("by-activity", "activityId");
          points.createIndex("by-synced", "synced");
        }
        if (oldVersion < 2 && oldVersion >= 1) {
          const points = transaction.objectStore("pendingPoints");
          if (points.indexNames.contains("by-synced")) points.deleteIndex("by-synced");
          points.createIndex("by-synced", "synced");
          // Use native cursor callbacks inside the versionchange transaction.
          // Detached promises can finish after the upgrade commits, leaving legacy
          // boolean values outside the numeric by-synced index.
          const nativePoints = unwrap(points);
          const cursorRequest = nativePoints.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const value = cursor.value as PendingPoint & { synced: boolean | number };
            cursor.update({ ...value, synced: value.synced ? 1 : 0 });
            cursor.continue();
          };
        }
        if (!db.objectStoreNames.contains("localActivities")) {
          db.createObjectStore("localActivities", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

function notifyQueueChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("hike-points-queued"));
}

export function notifyPendingPointsChanged() {
  notifyQueueChanged();
}

function notifyQueueProblem(error: OfflinePointQueueFullError) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hike-points-queue-error", { detail: error }));
  }
}

function queueFull(message: string, cause?: unknown): OfflinePointQueueFullError {
  const error = new OfflinePointQueueFullError(message, cause);
  notifyQueueProblem(error);
  return error;
}

async function assertQueueCanAcceptPoint(db: IDBPDatabase<HikeDB>, activityId: string) {
  const activityPoints = await db.countFromIndex("pendingPoints", "by-activity", activityId);
  if (activityPoints >= MAX_PENDING_POINTS_PER_ACTIVITY) {
    throw queueFull(
      "GPS point was not saved because this activity reached its recording limit. Reconnect and finish the activity before continuing.",
    );
  }

  const pending = await db.countFromIndex("pendingPoints", "by-synced", 0);
  if (pending >= MAX_PENDING_POINT_COUNT) {
    throw queueFull(
      "GPS point was not saved because offline recording storage is full. Stop recording or reconnect and sync points before continuing.",
    );
  }

  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
  try {
    const estimate = await navigator.storage.estimate();
    if (
      Number.isFinite(estimate.usage) &&
      Number.isFinite(estimate.quota) &&
      estimate.quota! - estimate.usage! <
        ROUTE_PACK_STORAGE_RESERVE_BYTES + ESTIMATED_PENDING_POINT_BYTES
    ) {
      throw queueFull(
        "GPS point was not saved because offline storage must be reserved for route maps. Reconnect and sync recordings before continuing.",
      );
    }
  } catch (error) {
    if (error instanceof OfflinePointQueueFullError) throw error;
    // Storage estimates are advisory and can be unavailable. The fixed point
    // ceiling still prevents a long recording from consuming route-pack space.
  }
}

export async function queueActivityPoint(point: {
  id?: string; activityId: string; lat: number; lng: number; elevation?: number; recordedAt: Date;
}, options: { notify?: boolean } = {}) {
  const write = pointWriteQueue.then(async () => {
    const db = await getOfflineDb();
    if (!db) {
      throw queueFull(
        "GPS point was not saved because offline storage is unavailable. Reconnect before relying on this recording.",
      );
    }
    await assertQueueCanAcceptPoint(db, point.activityId);
    try {
      await db.put("pendingPoints", {
        id: point.id ?? crypto.randomUUID(), activityId: point.activityId, lat: point.lat, lng: point.lng,
        elevation: point.elevation, recordedAt: point.recordedAt.toISOString(), synced: 0,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        throw queueFull(
          "GPS point was not saved because offline storage is full. Stop recording or reconnect and sync points before continuing.",
          error,
        );
      }
      throw error;
    }
    if (options.notify !== false) notifyQueueChanged();
  });
  pointWriteQueue = write.catch(() => undefined);
  return write;
}

export async function getPendingPoints(activityId: string) {
  const db = await getOfflineDb();
  if (!db) return [];
  const points = await db.getAllFromIndex("pendingPoints", "by-activity", activityId);
  return points.filter((point) => point.synced === 0);
}

export async function getPendingPointCount() {
  const db = await getOfflineDb();
  if (!db) return 0;
  return db.countFromIndex("pendingPoints", "by-synced", 0);
}

async function getAllUnsyncedPoints() {
  const db = await getOfflineDb();
  if (!db) return [];
  const points = await db.getAllFromIndex("pendingPoints", "by-synced", 0);
  if (!db.objectStoreNames.contains("localActivities")) return points;

  const locals = await db.getAll("localActivities");
  const byLocalId = new Map(locals.map((activity) => [activity.id, activity]));
  const knownRemoteIds = new Set(
    locals.flatMap((activity) => activity.remoteId ? [activity.remoteId] : []),
  );
  const uploadable: PendingPoint[] = [];
  for (const point of points) {
    // A server ID can also be the key of a synthetic row left by the old finish bug.
    // Prefer a known remote mapping before interpreting the value as a local ID.
    if (knownRemoteIds.has(point.activityId)) {
      uploadable.push(point);
      continue;
    }
    const local = byLocalId.get(point.activityId);
    if (!local) {
      // Legacy callers queued directly against a server ID and have no local row.
      uploadable.push(point);
      continue;
    }
    if (!local.remoteId) {
      // Never POST a device-local UUID as though it were a server activity. The
      // activity queue will create the server row and migrate this point first.
      continue;
    }
    const migrated = { ...point, activityId: local.remoteId };
    await db.put("pendingPoints", migrated);
    uploadable.push(migrated);
  }
  return uploadable;
}

export async function markPointsSynced(ids: string[]) {
  const db = await getOfflineDb();
  if (!db || ids.length === 0) return;
  const transaction = db.transaction("pendingPoints", "readwrite");
  await Promise.all(ids.map(async (id) => {
    const point = await transaction.store.get(id);
    if (point) await transaction.store.put({ ...point, synced: 1 });
  }));
  await transaction.done;
}

export async function deleteSyncedPointsOlderThan(cutoff = new Date(Date.now() - SYNCED_RETENTION_MS)) {
  const db = await getOfflineDb();
  if (!db) return;
  const points = await db.getAllFromIndex("pendingPoints", "by-synced", 1);
  const transaction = db.transaction("pendingPoints", "readwrite");
  await Promise.all(points
    .filter((point) => new Date(point.recordedAt).getTime() < cutoff.getTime())
    .map((point) => transaction.store.delete(point.id)));
  await transaction.done;
}

export interface FlushResult { synced: number; pending: number; dropped: number; }

/**
 * Statuses that will never succeed on retry, however long we wait.
 *
 * 404/410: the activity does not exist for this owner — deleted, or created under a
 * different owner. 400/413/422: the server rejected the payload itself. 409 means the
 * activity is already finalized. The points API returns a successful idempotent replay
 * when a clientPointId was previously accepted, so a 409 is specifically a novel point
 * that the finalized activity can never accept.
 *
 * 401 is deliberately NOT here: a session is re-minted on the next document navigation,
 * so those points are still deliverable.
 */
const PERMANENT_STATUSES = new Set([400, 404, 409, 410, 413, 422]);

export async function discardPendingPoints(ids: string[]) {
  const db = await getOfflineDb();
  if (!db || ids.length === 0) return;
  const transaction = db.transaction("pendingPoints", "readwrite");
  await Promise.all(ids.map((id) => transaction.store.delete(id)));
  await transaction.done;
  notifyQueueChanged();
}

/**
 * Returns what was uploaded and what had to be abandoned.
 *
 * A permanently-rejected batch used to `break` and stay queued with `synced: 0` forever:
 * `deleteSyncedPointsOlderThan` only prunes `synced: 1`, so nothing ever removed them,
 * while the sync hook retried every 30 s, on every `online` event, and on every queue
 * event for the life of the app. That is battery and cellular burned where the app tells
 * people to conserve both, and unbounded growth in the same IndexedDB quota that holds
 * the offline route packs navigation depends on.
 */
async function flushActivityPoints(
  activityId: string,
  points: PendingPoint[],
): Promise<{ synced: number; dropped: number }> {
  let synced = 0;
  let dropped = 0;
  for (let index = 0; index < points.length; index += 100) {
    const batch = points.slice(index, index + 100);
    let response: Response;
    try {
      response = await apiFetch(`/api/activities/${encodeURIComponent(activityId)}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: batch.map(({ id: clientPointId, lat, lng, elevation, recordedAt }) => ({
            clientPointId,
            lat,
            lng,
            elevation,
            recordedAt,
          })),
        }),
      });
    } catch {
      break;
    }
    if (PERMANENT_STATUSES.has(response.status)) {
      await discardPendingPoints(batch.map((point) => point.id));
      dropped += batch.length;
      continue;
    }
    if (!response.ok) break;
    await markPointsSynced(batch.map((point) => point.id));
    synced += batch.length;
  }
  return { synced, dropped };
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<{ synced: number; dropped: number }>,
) {
  let next = 0;
  const total = { synced: 0, dropped: 0 };
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      const result = await task(item);
      total.synced += result.synced;
      total.dropped += result.dropped;
    }
  });
  await Promise.all(workers);
  return total;
}

export async function flushPendingPoints(): Promise<FlushResult> {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const points = await getAllUnsyncedPoints();
    const grouped = new Map<string, PendingPoint[]>();
    for (const point of points) grouped.set(point.activityId, [...(grouped.get(point.activityId) ?? []), point]);
    const { synced, dropped } = await runWithConcurrency(
      [...grouped.entries()],
      2,
      ([activityId, activityPoints]) => flushActivityPoints(activityId, activityPoints),
    );
    await deleteSyncedPointsOlderThan();
    return { synced, dropped, pending: await getPendingPointCount() };
  })();
  try {
    return await flushPromise;
  } finally {
    flushPromise = null;
    notifyQueueChanged();
  }
}

/** Test-only reset for fake-indexeddb; not used by the application. */
export async function __resetOfflineDbForTests() {
  const current = dbPromise;
  dbPromise = null;
  flushPromise = null;
  pointWriteQueue = Promise.resolve();
  if (current) (await current).close();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("hike-offline");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export const resetOfflineDbForTests = __resetOfflineDbForTests;
