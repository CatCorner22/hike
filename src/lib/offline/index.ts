import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface HikeDB extends DBSchema {
  pendingPoints: {
    key: string;
    value: {
      id: string;
      activityId: string;
      lat: number;
      lng: number;
      elevation?: number;
      recordedAt: string;
      synced: boolean;
    };
    indexes: { "by-activity": string; "by-synced": number };
  };
  offlineTrails: {
    key: string;
    value: {
      id: string;
      name: string;
      geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
      gpx: string;
      cachedAt: string;
    };
  };
  offlinePlans: {
    key: string;
    value: {
      id: string;
      plan: Record<string, unknown>;
      cachedAt: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<HikeDB>> | null = null;

export function getOfflineDb() {
  if (typeof window === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<HikeDB>("hike-offline", 1, {
      upgrade(db) {
        const points = db.createObjectStore("pendingPoints", { keyPath: "id" });
        points.createIndex("by-activity", "activityId");
        points.createIndex("by-synced", "synced");
        db.createObjectStore("offlineTrails", { keyPath: "id" });
        db.createObjectStore("offlinePlans", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export async function queueActivityPoint(point: {
  activityId: string;
  lat: number;
  lng: number;
  elevation?: number;
  recordedAt: Date;
}) {
  const db = await getOfflineDb();
  if (!db) return;

  await db.put("pendingPoints", {
    id: crypto.randomUUID(),
    activityId: point.activityId,
    lat: point.lat,
    lng: point.lng,
    elevation: point.elevation,
    recordedAt: point.recordedAt.toISOString(),
    synced: false,
  });
}

export async function getPendingPoints(activityId: string) {
  const db = await getOfflineDb();
  if (!db) return [];
  return db.getAllFromIndex("pendingPoints", "by-activity", activityId);
}

export async function markPointsSynced(ids: string[]) {
  const db = await getOfflineDb();
  if (!db) return;
  for (const id of ids) {
    const point = await db.get("pendingPoints", id);
    if (point) await db.put("pendingPoints", { ...point, synced: true });
  }
}

export async function cacheTrailOffline(trail: {
  id: string;
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  gpx: string;
}) {
  const db = await getOfflineDb();
  if (!db) return;
  await db.put("offlineTrails", {
    ...trail,
    cachedAt: new Date().toISOString(),
  });
}

export async function getOfflineTrail(id: string) {
  const db = await getOfflineDb();
  if (!db) return null;
  return db.get("offlineTrails", id);
}

export async function cachePlanOffline(plan: {
  id: string;
  plan: Record<string, unknown>;
}) {
  const db = await getOfflineDb();
  if (!db) return;
  await db.put("offlinePlans", {
    ...plan,
    cachedAt: new Date().toISOString(),
  });
}

export async function getOfflinePlan(id: string) {
  const db = await getOfflineDb();
  if (!db) return null;
  return db.get("offlinePlans", id);
}
