import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PaceTerrain } from "@/lib/safety/landnav";
import { formatReport, reportField } from "@/lib/safety/report-field";

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
  const rounded = (value: number) => (Number.isFinite(value) ? String(Math.round(value)) : "UNKNOWN");
  return formatReport([
    "NAV LOG",
    ...legs.map((leg, i) => {
      const arrivedAtMs = leg.arrivedAt ? Date.parse(leg.arrivedAt) : Number.NaN;
      const eta = leg.arrivedAt
        ? Number.isFinite(arrivedAtMs) ? `arrived ${new Date(arrivedAtMs).toISOString()}` : "arrival time UNKNOWN"
        : "open";
      return `L${i + 1}  ${rounded(leg.azimuthTrue)}° / ${rounded(leg.distanceM)} m  ${reportField(leg.terrain, 40)}  ${reportField(eta, 60)}${leg.note ? `  ${reportField(leg.note)}` : ""}`;
    }),
  ]);
}
