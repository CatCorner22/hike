import { openDB, type DBSchema, type IDBPDatabase } from "idb";

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
  offlineTrails: { key: string; value: { id: string; name: string; geometry: GeoJSON.LineString | GeoJSON.MultiLineString; gpx: string; cachedAt: string } };
  offlinePlans: { key: string; value: { id: string; plan: Record<string, unknown>; cachedAt: string } };
}

const OFFLINE_DB_VERSION = 2;
const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
let dbPromise: Promise<IDBPDatabase<HikeDB>> | null = null;
let flushPromise: Promise<FlushResult> | null = null;

export function getOfflineDb() {
  if (typeof window === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<HikeDB>("hike-offline", OFFLINE_DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const points = db.createObjectStore("pendingPoints", { keyPath: "id" });
          points.createIndex("by-activity", "activityId");
          points.createIndex("by-synced", "synced");
          db.createObjectStore("offlineTrails", { keyPath: "id" });
          db.createObjectStore("offlinePlans", { keyPath: "id" });
          return;
        }
        if (oldVersion < 2) {
          const points = transaction.objectStore("pendingPoints");
          if (points.indexNames.contains("by-synced")) points.deleteIndex("by-synced");
          points.createIndex("by-synced", "synced");
          void points.openCursor().then(function rewrite(cursor): Promise<void> | void {
            if (!cursor) return;
            const value = cursor.value as PendingPoint & { synced: boolean | number };
            void cursor.update({ ...value, synced: value.synced ? 1 : 0 });
            return cursor.continue().then(rewrite);
          });
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

export interface FlushResult { synced: number; pending: number; }

async function flushActivityPoints(activityId: string, points: PendingPoint[]): Promise<number> {
  let synced = 0;
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
    if (!response.ok) break;
    await markPointsSynced(batch.map((point) => point.id));
    synced += batch.length;
  }
  return synced;
}

async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<number>) {
  let next = 0;
  let total = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      total += await task(item);
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
    const synced = await runWithConcurrency([...grouped.entries()], 2, ([activityId, activityPoints]) =>
      flushActivityPoints(activityId, activityPoints));
    await deleteSyncedPointsOlderThan();
    return { synced, pending: await getPendingPointCount() };
  })();
  try {
    return await flushPromise;
  } finally {
    flushPromise = null;
    notifyQueueChanged();
  }
}

export async function cacheTrailOffline(trail: { id: string; name: string; geometry: GeoJSON.LineString | GeoJSON.MultiLineString; gpx: string }) {
  const db = await getOfflineDb(); if (!db) return;
  await db.put("offlineTrails", { ...trail, cachedAt: new Date().toISOString() });
}
export async function getOfflineTrail(id: string) { const db = await getOfflineDb(); return db ? db.get("offlineTrails", id) : null; }
export async function cachePlanOffline(plan: { id: string; plan: Record<string, unknown> }) { const db = await getOfflineDb(); if (db) await db.put("offlinePlans", { ...plan, cachedAt: new Date().toISOString() }); }
export async function getOfflinePlan(id: string) { const db = await getOfflineDb(); return db ? db.get("offlinePlans", id) : null; }
