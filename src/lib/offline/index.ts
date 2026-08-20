import { openDB, unwrap, type DBSchema, type IDBPDatabase } from "idb";
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
let dbPromise: Promise<IDBPDatabase<HikeDB>> | null = null;
let flushPromise: Promise<FlushResult> | null = null;

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

export async function queueActivityPoint(point: {
  activityId: string; lat: number; lng: number; elevation?: number; recordedAt: Date;
}) {
  const db = await getOfflineDb();
  if (!db) return;
  await db.put("pendingPoints", {
    id: crypto.randomUUID(), activityId: point.activityId, lat: point.lat, lng: point.lng,
    elevation: point.elevation, recordedAt: point.recordedAt.toISOString(), synced: 0,
  });
  notifyQueueChanged();
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
  return db.getAllFromIndex("pendingPoints", "by-synced", 0);
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
 * different owner. 400/413/422: the server rejected the payload itself.
 *
 * 401 is deliberately NOT here: a session is re-minted on the next document navigation,
 * so those points are still deliverable.
 */
const PERMANENT_STATUSES = new Set([400, 404, 410, 413, 422]);

async function deletePoints(ids: string[]) {
  const db = await getOfflineDb();
  if (!db || ids.length === 0) return;
  const transaction = db.transaction("pendingPoints", "readwrite");
  await Promise.all(ids.map((id) => transaction.store.delete(id)));
  await transaction.done;
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
      response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: batch.map(({ lat, lng, elevation, recordedAt }) => ({ lat, lng, elevation, recordedAt })) }),
      });
    } catch {
      break;
    }
    if (PERMANENT_STATUSES.has(response.status)) {
      await deletePoints(batch.map((point) => point.id));
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
  if (current) (await current).close();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("hike-offline");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export const resetOfflineDbForTests = __resetOfflineDbForTests;
