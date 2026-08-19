import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface IceProfile {
  name: string;
  iceName: string;
  icePhone: string;
  medical: string;
  partySize: number;
}

export interface SafetyWaypoint {
  id: string;
  packId: string;
  kind: "water" | "junction" | "camp" | "note" | "lkp" | "rp" | "orp";
  lat: number;
  lng: number;
  note?: string;
  recordedAt: string;
}

export interface OverdueAlarm {
  returnAt: string;
}

interface SafetyDB extends DBSchema {
  profile: { key: string; value: IceProfile & { id: string } };
  waypoints: { key: string; value: SafetyWaypoint; indexes: { "by-pack": string } };
  overdue: { key: string; value: OverdueAlarm & { id: string } };
}

let dbPromise: Promise<IDBPDatabase<SafetyDB>> | null = null;

function getDb() {
  if (typeof window === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<SafetyDB>("hike-safety", 1, {
      upgrade(db) {
        db.createObjectStore("profile", { keyPath: "id" });
        const waypoints = db.createObjectStore("waypoints", { keyPath: "id" });
        waypoints.createIndex("by-pack", "packId");
        db.createObjectStore("overdue", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

const EMPTY_PROFILE: IceProfile = {
  name: "",
  iceName: "",
  icePhone: "",
  medical: "",
  partySize: 1,
};

export async function getIceProfile(): Promise<IceProfile> {
  const db = await getDb();
  if (!db) return EMPTY_PROFILE;
  return (await db.get("profile", "me")) ?? EMPTY_PROFILE;
}

export async function saveIceProfile(profile: IceProfile) {
  const db = await getDb();
  if (!db) return;
  await db.put("profile", { ...profile, id: "me" });
}

export async function dropWaypoint(
  packId: string,
  kind: SafetyWaypoint["kind"],
  lat: number,
  lng: number,
  note?: string,
): Promise<SafetyWaypoint> {
  const point: SafetyWaypoint = {
    id: crypto.randomUUID(),
    packId,
    kind,
    lat,
    lng,
    note,
    recordedAt: new Date().toISOString(),
  };
  const db = await getDb();
  if (db) await db.put("waypoints", point);
  return point;
}

export async function listWaypoints(packId: string): Promise<SafetyWaypoint[]> {
  const db = await getDb();
  if (!db) return [];
  return db.getAllFromIndex("waypoints", "by-pack", packId);
}

export async function setOverdueAlarm(returnAt: Date | null) {
  const db = await getDb();
  if (!db) return;
  if (!returnAt) {
    await db.delete("overdue", "current");
    return;
  }
  await db.put("overdue", { id: "current", returnAt: returnAt.toISOString() });
}

export async function getOverdueAlarm(): Promise<OverdueAlarm | null> {
  const db = await getDb();
  if (!db) return null;
  const row = await db.get("overdue", "current");
  return row ? { returnAt: row.returnAt } : null;
}

export function overdueStatus(returnAt: string, now = Date.now()) {
  const remainingMin = Math.round((Date.parse(returnAt) - now) / 60000);
  if (remainingMin <= 0) {
    return {
      overdue: true,
      remainingMin,
      label: `OVERDUE by ${Math.abs(remainingMin)} min — check in or send SOS`,
    };
  }
  return {
    overdue: false,
    remainingMin,
    label: `Return in ${remainingMin} min`,
  };
}
