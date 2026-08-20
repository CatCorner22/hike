import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { LocalActivity } from "@/lib/offline/activity-sync";

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
  localActivities: {
    key: string;
    value: LocalActivity;
  };
}

let dbPromise: Promise<IDBPDatabase<HikeDB>> | null = null;

export function getOfflineDb() {
  if (typeof window === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<HikeDB>("hike-offline", 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("pendingPoints")) {
          const points = db.createObjectStore("pendingPoints", { keyPath: "id" });
          points.createIndex("by-activity", "activityId");
          points.createIndex("by-synced", "synced");
        }
        if (!db.objectStoreNames.contains("localActivities")) {
          db.createObjectStore("localActivities", { keyPath: "id" });
        }
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
