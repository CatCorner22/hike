import { openDB, unwrap, type DBSchema, type IDBPDatabase } from "idb";
import { bboxFromGeometry, gpxFromLineString } from "@/lib/geo";
import { isValidGeometry, trailLengthMeters } from "@/lib/geo/navigation";

/**
 * Keep the payload shape and IndexedDB schema in lockstep. A route pack from
 * an older schema is retained, but is not considered safe enough to load.
 */
export const ROUTE_PACK_VERSION = 3;
export const ROUTE_PACK_DB_VERSION = 3;

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

interface RoutePackAlias {
  alias: string;
  canonicalId: string;
}

interface RoutePackDB extends DBSchema {
  routePacks: {
    key: string;
    value: RoutePack;
  };
  aliases: {
    key: string;
    value: RoutePackAlias;
    indexes: { "by-canonical": string };
  };
  lastFix: {
    key: string;
    value: {
      id: string;
      lat: number;
      lng: number;
      accuracy?: number;
      heading?: number;
      recordedAt: string;
    };
  };
}

export type RoutePackStatus = "ready" | "stale" | "invalid" | "missing";

export interface RoutePackLookup {
  pack: RoutePack | null;
  status: RoutePackStatus;
}

let dbPromise: Promise<IDBPDatabase<RoutePackDB>> | null = null;

function canonicalIdForLegacyPack(pack: RoutePack): string {
  return pack.aliases?.[0] || pack.id;
}

function uniqueAliases(canonicalId: string, aliases: string[] = []): string[] {
  return Array.from(new Set([canonicalId, ...aliases.filter(Boolean)]));
}

/**
 * Converts the schema-v1 duplicated records into a canonical payload plus
 * tiny alias pointers. Exported for a direct migration regression test.
 */
export function collapseLegacyRoutePacks(records: RoutePack[]): {
  packs: RoutePack[];
  aliases: RoutePackAlias[];
} {
  const groups = new Map<string, RoutePack[]>();

  for (const record of records) {
    const canonicalId = canonicalIdForLegacyPack(record);
    const group = groups.get(canonicalId) ?? [];
    group.push(record);
    groups.set(canonicalId, group);
  }

  const packs: RoutePack[] = [];
  const aliases: RoutePackAlias[] = [];
  for (const [canonicalId, group] of groups) {
    const source =
      group.find((record) => record.id === canonicalId) ??
      [...group].sort((a, b) => b.cachedAt.localeCompare(a.cachedAt))[0];
    const aliasesForPack = uniqueAliases(
      canonicalId,
      group.flatMap((record) => [...(record.aliases ?? []), record.id]),
    );
    const pack: RoutePack = {
      ...source,
      id: canonicalId,
      aliases: aliasesForPack,
    };
    packs.push(pack);
    aliasesForPack.forEach((alias) => aliases.push({ alias, canonicalId }));
  }

  return { packs, aliases };
}

function getDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<RoutePackDB>("hike-nav-packs", ROUTE_PACK_DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains("routePacks")) {
          db.createObjectStore("routePacks", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("aliases")) {
          const aliases = db.createObjectStore("aliases", { keyPath: "alias" });
          aliases.createIndex("by-canonical", "canonicalId");
        }
        if (!db.objectStoreNames.contains("lastFix")) {
          db.createObjectStore("lastFix", { keyPath: "id" });
        }

        // Version 1 stored a complete payload under every alias. Use native
        // IDB requests so the versionchange transaction stays alive while
        // the read completes.
        if (oldVersion > 0 && oldVersion < ROUTE_PACK_DB_VERSION) {
          const nativeTransaction = unwrap(transaction);
          const legacyStore = nativeTransaction.objectStore("routePacks");
          const aliasStore = nativeTransaction.objectStore("aliases");
          const request = legacyStore.getAll();
          request.onsuccess = () => {
            const { packs, aliases } = collapseLegacyRoutePacks(
              request.result as RoutePack[],
            );
            legacyStore.clear();
            packs.forEach((pack) => legacyStore.put(pack));
            aliases.forEach((alias) => aliasStore.put(alias));
          };
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
  const aliases = uniqueAliases(input.id, input.aliases);
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

export function routePackStatus(pack: RoutePack | null | undefined): RoutePackStatus {
  if (!pack) return "missing";
  if (!isValidGeometry(pack.geometry)) return "invalid";
  return pack.version === ROUTE_PACK_VERSION ? "ready" : "stale";
}

export async function saveRoutePack(pack: RoutePack) {
  const db = await getDb();
  if (!db) return;

  const tx = db.transaction(["routePacks", "aliases"], "readwrite");
  const aliasesStore = tx.objectStore("aliases");
  const packStore = tx.objectStore("routePacks");
  const initialAliases = uniqueAliases(pack.id, pack.aliases);
  const existingPointers = await Promise.all(
    initialAliases.map((alias) => aliasesStore.get(alias)),
  );
  const replacedCanonicalIds = Array.from(
    new Set(
      existingPointers
        .flatMap((pointer) => (pointer ? [pointer.canonicalId] : []))
        .filter((id) => id !== pack.id),
    ),
  );

  // If aliases previously pointed at an older canonical record, fold all of
  // those pointers into this one and remove the now-duplicated full payload.
  const inheritedAliases = await Promise.all(
    replacedCanonicalIds.map((canonicalId) =>
      aliasesStore.index("by-canonical").getAll(canonicalId),
    ),
  );
  const aliases = uniqueAliases(
    pack.id,
    [...initialAliases, ...inheritedAliases.flat().map((pointer) => pointer.alias)],
  );
  const stored: RoutePack = {
    ...pack,
    id: pack.id,
    aliases,
    version: ROUTE_PACK_VERSION,
  };

  await packStore.put(stored);
  await Promise.all(
    aliases.map((alias) => aliasesStore.put({ alias, canonicalId: stored.id })),
  );
  await Promise.all(replacedCanonicalIds.map((canonicalId) => packStore.delete(canonicalId)));
  await tx.done;
}

async function findRoutePack(db: IDBPDatabase<RoutePackDB>, id: string) {
  const pointer = await db.get("aliases", id);
  if (pointer) return db.get("routePacks", pointer.canonicalId);
  return db.get("routePacks", id);
}

export async function getRoutePackStatus(id: string): Promise<RoutePackLookup> {
  const db = await getDb();
  if (!db) return { pack: null, status: "missing" };
  const pack = await findRoutePack(db, id);
  return { pack: pack ?? null, status: routePackStatus(pack) };
}

export async function getRoutePack(id: string): Promise<RoutePack | null> {
  const lookup = await getRoutePackStatus(id);
  return lookup.status === "ready" ? lookup.pack : null;
}

export async function listRoutePacks(): Promise<RoutePack[]> {
  const db = await getDb();
  if (!db) return [];
  // Only canonical payload records live in this store as of schema v3. Keep
  // stale-but-valid records visible so an offline user can still see what is
  // on their device and refresh them once online.
  return (await db.getAll("routePacks")).filter((pack) => isValidGeometry(pack.geometry));
}

export async function hasRoutePack(id: string): Promise<boolean> {
  return (await getRoutePackStatus(id)).status === "ready";
}

export async function saveLastFix(fix: {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  recordedAt?: number;
}) {
  const db = await getDb();
  if (!db) return;
  await db.put("lastFix", {
    id: "current",
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy,
    heading: fix.heading,
    recordedAt: new Date(fix.recordedAt ?? Date.now()).toISOString(),
  });
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

/** Test-only reset for fake-indexeddb; not used by the application. */
export async function resetRoutePackDbForTests() {
  const current = dbPromise;
  dbPromise = null;
  if (current) (await current).close();
}
