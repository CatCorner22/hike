import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface IceProfile {
  name: string;
  iceName: string;
  icePhone: string;
  medical: string;
  partySize: number;
  bloodType?: string;
  challenge?: string;
  password?: string;
}

export interface SafetyWaypoint {
  id: string;
  packId: string;
  kind: "water" | "junction" | "camp" | "note" | "lkp" | "rp" | "orp" | "ap" | "cf" | "hr";
  lat: number;
  lng: number;
  note?: string;
  recordedAt: string;
}

export interface OverdueAlarm {
  returnAt: string;
}

export interface CheckinEntry {
  id: string;
  packId: string;
  recordedAt: string;
  lat?: number;
  lng?: number;
  note?: string;
}

export interface CheckinSettings {
  intervalMin: number;
  enabled: boolean;
}

interface SafetyDB extends DBSchema {
  profile: { key: string; value: IceProfile & { id: string } };
  waypoints: { key: string; value: SafetyWaypoint; indexes: { "by-pack": string } };
  overdue: { key: string; value: OverdueAlarm & { id: string } };
  checkins: { key: string; value: CheckinEntry; indexes: { "by-pack": string } };
  checkinSettings: { key: string; value: CheckinSettings & { id: string } };
}

let dbPromise: Promise<IDBPDatabase<SafetyDB>> | null = null;

export function getSafetyDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<SafetyDB>("hike-safety", 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("profile", { keyPath: "id" });
          const waypoints = db.createObjectStore("waypoints", { keyPath: "id" });
          waypoints.createIndex("by-pack", "packId");
          db.createObjectStore("overdue", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          const checkins = db.createObjectStore("checkins", { keyPath: "id" });
          checkins.createIndex("by-pack", "packId");
          db.createObjectStore("checkinSettings", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

function getDb() {
  return getSafetyDb();
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

/**
 * Returns null for an unparseable time. An invalid stored value used to fall through
 * to `NaN <= 0 === false`, which silently disabled the overdue alarm and rendered
 * "Return in NaN min" — the alarm looked armed while doing nothing.
 */
export function overdueStatus(returnAt: string, now = Date.now()) {
  const returnMs = Date.parse(returnAt);
  if (!Number.isFinite(returnMs)) return null;
  const remainingMin = Math.round((returnMs - now) / 60000);
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
