import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface NavTrackDB extends DBSchema {
  sessions: {
    key: string;
    value: {
      id: string;
      packId: string;
      name: string;
      startedAt: string;
      points: Array<{
        lat: number;
        lng: number;
        accuracy?: number;
        altitude?: number;
        recordedAt: string;
      }>;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<NavTrackDB>> | null = null;

function getDb() {
  if (typeof window === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<NavTrackDB>("hike-nav-tracks", 1, {
      upgrade(db) {
        db.createObjectStore("sessions", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export async function startNavSession(packId: string, name: string): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  if (!db) return id;

  await db.put("sessions", {
    id,
    packId,
    name,
    startedAt: new Date().toISOString(),
    points: [],
  });
  return id;
}

export async function appendNavPoint(
  sessionId: string,
  point: {
    lat: number;
    lng: number;
    accuracy?: number;
    altitude?: number;
    recordedAt?: number;
  },
) {
  const db = await getDb();
  if (!db) return;

  const session = await db.get("sessions", sessionId);
  if (!session) return;

  session.points.push({
    lat: point.lat,
    lng: point.lng,
    accuracy: point.accuracy,
    altitude: point.altitude,
    recordedAt: new Date(point.recordedAt ?? Date.now()).toISOString(),
  });

  if (session.points.length > 8000) {
    session.points = session.points.slice(-6000);
  }

  await db.put("sessions", session);
}

export async function getNavSession(sessionId: string) {
  const db = await getDb();
  if (!db) return null;
  return db.get("sessions", sessionId);
}
