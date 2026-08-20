import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { bboxFromGeometry, gpxFromLineString } from "@/lib/geo";
import { isValidGeometry, trailLengthMeters } from "@/lib/geo/navigation";

export const ROUTE_PACK_VERSION = 2;

export interface RoutePack {
  id: string;
  aliases: string[];
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox: [number, number, number, number];
  elevationProfile: Array<{ distanceMeters: number; elevation: number }>;
  gpx: string;
  lengthMeters: number;
  cachedAt: string;
  version: number;
}

interface RoutePackDB extends DBSchema {
  routePacks: {
    key: string;
    value: RoutePack;
    indexes: { "by-alias": string };
  };
  lastFix: {
    key: string;
    value: {
      id: string;
      lat: number;
      lng: number;
      accuracy?: number;
      heading?: number;
      altitude?: number;
      recordedAt: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<RoutePackDB>> | null = null;

function getDb() {
  if (typeof window === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<RoutePackDB>("hike-nav-packs", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("routePacks")) {
          const packs = db.createObjectStore("routePacks", { keyPath: "id" });
          packs.createIndex("by-alias", "aliases", { multiEntry: true });
        }
        if (!db.objectStoreNames.contains("lastFix")) {
          db.createObjectStore("lastFix", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export function buildRoutePack(input: {
  id: string;
  aliases?: string[];
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox?: [number, number, number, number];
  elevationProfile?: Array<{ distanceMeters: number; elevation: number }>;
}): RoutePack {
  const aliases = Array.from(new Set([input.id, ...(input.aliases ?? [])]));
  return {
    id: input.id,
    aliases,
    name: input.name,
    geometry: input.geometry,
    bbox: input.bbox ?? bboxFromGeometry(input.geometry, 0.004),
    elevationProfile: input.elevationProfile ?? [],
    gpx: gpxFromLineString(input.name, input.geometry),
    lengthMeters: trailLengthMeters(input.geometry),
    cachedAt: new Date().toISOString(),
    version: ROUTE_PACK_VERSION,
  };
}

export async function saveRoutePack(pack: RoutePack) {
  const db = await getDb();
  if (!db) return;
  const aliases = Array.from(new Set([pack.id, ...pack.aliases]));
  const stored: RoutePack = { ...pack, aliases, version: ROUTE_PACK_VERSION };
  await db.put("routePacks", stored);

  for (const alias of aliases) {
    if (alias === pack.id) continue;
    const existing = await db.get("routePacks", alias);
    if (!existing) {
      await db.put("routePacks", { ...stored, id: alias });
    } else {
      await db.put("routePacks", {
        ...stored,
        id: alias,
        aliases: Array.from(new Set([...existing.aliases, ...aliases])),
      });
    }
  }
}

export async function getRoutePack(id: string): Promise<RoutePack | null> {
  const db = await getDb();
  if (!db) return null;

  const direct = await db.get("routePacks", id);
  if (direct && isValidGeometry(direct.geometry)) return direct;

  const aliased = await db.getAllFromIndex("routePacks", "by-alias", id);
  const match = aliased.find((pack) => isValidGeometry(pack.geometry));
  return match ?? null;
}

export async function listRoutePacks(): Promise<RoutePack[]> {
  const db = await getDb();
  if (!db) return [];
  const packs = await db.getAll("routePacks");
  const seen = new Set<string>();
  return packs.filter((pack) => {
    const key = pack.aliases[0] || pack.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return isValidGeometry(pack.geometry);
  });
}

export async function hasRoutePack(id: string): Promise<boolean> {
  return Boolean(await getRoutePack(id));
}

let lastFixWrite: Promise<void> = Promise.resolve();

export async function saveLastFix(fix: {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  altitude?: number;
  recordedAt?: number;
}) {
  lastFixWrite = lastFixWrite
    .catch(() => undefined)
    .then(async () => {
      const db = await getDb();
      if (!db) return;
      await db.put("lastFix", {
        id: "current",
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        heading: fix.heading,
        altitude: fix.altitude,
        recordedAt: new Date(fix.recordedAt ?? Date.now()).toISOString(),
      });
    });
  return lastFixWrite;
}

export async function getLastFix() {
  const db = await getDb();
  if (!db) return null;
  return db.get("lastFix", "current");
}

export function packCandidateIds(navId: string): string[] {
  const ids = [navId];
  if (navId.startsWith("trail-")) ids.push(navId.slice("trail-".length));
  if (navId.startsWith("plan-")) ids.push(navId.slice("plan-".length));
  return Array.from(new Set(ids));
}
