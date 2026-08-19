import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PaceTerrain } from "@/lib/safety/landnav";

export interface NavLeg {
  id: string;
  packId: string;
  azimuthTrue: number;
  distanceM: number;
  paces?: number;
  terrain: PaceTerrain;
  note?: string;
  startedAt: string;
  arrivedAt?: string;
  fromLat?: number;
  fromLng?: number;
}

interface NavLogDB extends DBSchema {
  legs: { key: string; value: NavLeg; indexes: { "by-pack": string } };
}

let dbPromise: Promise<IDBPDatabase<NavLogDB>> | null = null;

function getDb() {
  if (typeof window === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<NavLogDB>("hike-navlog", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("legs")) {
          const legs = db.createObjectStore("legs", { keyPath: "id" });
          legs.createIndex("by-pack", "packId");
        }
      },
    });
  }
  return dbPromise;
}

export async function startNavLeg(
  packId: string,
  input: Omit<NavLeg, "id" | "packId" | "startedAt" | "arrivedAt">,
): Promise<NavLeg> {
  const leg: NavLeg = {
    id: crypto.randomUUID(),
    packId,
    startedAt: new Date().toISOString(),
    ...input,
  };
  const db = await getDb();
  if (db) await db.put("legs", leg);
  return leg;
}

export async function closeNavLeg(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const row = await db.get("legs", id);
  if (!row || row.arrivedAt) return;
  await db.put("legs", { ...row, arrivedAt: new Date().toISOString() });
}

export async function listNavLegs(packId: string): Promise<NavLeg[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllFromIndex("legs", "by-pack", packId);
  return rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function formatNavLog(legs: NavLeg[]): string {
  if (legs.length === 0) return "NAV LOG empty";
  return [
    "NAV LOG",
    ...legs.map((leg, i) => {
      const eta = leg.arrivedAt
        ? `arrived ${new Date(leg.arrivedAt).toISOString()}`
        : "open";
      return `L${i + 1}  ${Math.round(leg.azimuthTrue)}° / ${Math.round(leg.distanceM)} m  ${leg.terrain}  ${eta}${leg.note ? `  ${leg.note}` : ""}`;
    }),
  ].join("\n");
}
