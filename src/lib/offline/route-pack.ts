import { openDB, unwrap, type DBSchema, type IDBPDatabase } from "idb";
import { bboxFromGeometry } from "@/lib/geo";

/**
 * Offline packs have an intentionally conservative ceiling.  A route above this
 * count is not saved: silently simplifying a safety route would be worse than a
 * clear request to prepare a smaller route while online.
 */
export const MAX_ROUTE_PACK_COORDINATES = 100_000;
export const MAX_ROUTE_PACK_BYTES = 16 * 1024 * 1024;
export const MAX_ROUTE_PACK_GPX_BYTES = 2 * 1024 * 1024;
export const MAX_ELEVATION_PROFILE_POINTS = 2_048;
export const ROUTE_PACK_VERSION = 4;
export const ROUTE_PACK_DB_VERSION = 4;

export interface RoutePack {
  /** Canonical record key. Never infer it from an alias. */
  id: string;
  /** Redundant immutable payload identity used to detect poisoned pointers. */
  canonicalId: string;
  aliases: string[];
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox: [number, number, number, number];
  elevationProfile: Array<{ distanceMeters: number; elevation: number }>;
  /**
   * Legacy packs may contain GPX. New packs deliberately omit it; export is
   * generated from validated geometry on demand.
   */
  gpx?: string;
  lengthMeters: number;
  /** Cumulative distance at each stored coordinate, precomputed once. */
  cumulativeDistancesMeters: number[];
  cachedAt: string;
  version: number;
}

interface RoutePackAlias {
  alias: string;
  canonicalId: string;
}

interface RoutePackDB extends DBSchema {
  routePacks: { key: string; value: RoutePack };
  aliases: { key: string; value: RoutePackAlias; indexes: { "by-canonical": string } };
  lastFix: {
    key: string;
<<<<<<< HEAD
    value: {
      id: string;
      lat: number;
      lng: number;
      accuracy?: number;
      heading?: number;
      altitude?: number;
      recordedAt: string;
    };
=======
    value: { id: string; lat: number; lng: number; accuracy?: number; heading?: number; recordedAt: string };
>>>>>>> origin/main
  };
}

export type RoutePackStatus = "ready" | "stale" | "invalid" | "missing";
export interface RoutePackLookup {
  pack: RoutePack | null;
  status: RoutePackStatus;
  /** Safe, user-facing reason when an untrusted cache record was rejected. */
  error?: string;
}

let dbPromise: Promise<IDBPDatabase<RoutePackDB>> | null = null;

function canonicalIdForLegacyPack(pack: RoutePack): string {
  return pack.canonicalId || pack.aliases?.[0] || pack.id;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function uniqueAliases(canonicalId: string, aliases: string[] = []): string[] {
  return Array.from(new Set([canonicalId, ...aliases.filter(validId)]));
}

function positionCount(geometry: unknown): number {
  if (!geometry || typeof geometry !== "object") return 0;
  const candidate = geometry as { type?: string; coordinates?: unknown };
  if (candidate.type === "LineString") return Array.isArray(candidate.coordinates) ? candidate.coordinates.length : 0;
  if (candidate.type === "MultiLineString") return Array.isArray(candidate.coordinates)
    ? candidate.coordinates.reduce<number>((count, line) => count + (Array.isArray(line) ? line.length : 0), 0)
    : 0;
  return 0;
}

function coordinateLines(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): GeoJSON.Position[][] {
  return geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
}

function finitePosition(position: unknown): position is GeoJSON.Position {
  return Array.isArray(position) &&
    position.length === 2 &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    Number(position[0]) >= -180 && Number(position[0]) <= 180 &&
    Number(position[1]) >= -90 && Number(position[1]) <= 90;
}

function validGeometry(geometry: unknown): geometry is GeoJSON.LineString | GeoJSON.MultiLineString {
  if (!geometry || typeof geometry !== "object") return false;
  const candidate = geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
  if (candidate.type !== "LineString" && candidate.type !== "MultiLineString" || !Array.isArray(candidate.coordinates)) return false;
  const lines = candidate.type === "LineString"
    ? [candidate.coordinates]
    : candidate.coordinates;
  if (!Array.isArray(lines) || lines.length === 0 || positionCount(candidate) > MAX_ROUTE_PACK_COORDINATES) return false;
  return lines.every((line) => Array.isArray(line) && line.length >= 2 && line.every(finitePosition));
}

function distanceMeters(a: GeoJSON.Position, b: GeoJSON.Position): number {
  const radians = Math.PI / 180;
  const dLat = (Number(b[1]) - Number(a[1])) * radians;
  const dLng = (Number(b[0]) - Number(a[0])) * radians;
  const latA = Number(a[1]) * radians;
  const latB = Number(b[1]) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function cumulativeDistancesForGeometry(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): number[] {
  const cumulative: number[] = [];
  let total = 0;
  for (const line of coordinateLines(geometry)) {
    for (let index = 0; index < line.length; index += 1) {
      if (index > 0) total += distanceMeters(line[index - 1], line[index]);
      cumulative.push(total);
    }
  }
  return cumulative;
}

function validationError(pack: RoutePack | null | undefined): string | null {
  if (!pack || typeof pack !== "object") return "Saved route pack is missing.";
  if (!validId(pack.id) || pack.canonicalId !== pack.id) return "Saved route identity is invalid.";
  if (!Array.isArray(pack.aliases) || pack.aliases.length === 0 || pack.aliases.some((alias) => !validId(alias))) {
    return "Saved route aliases are invalid.";
  }
  const aliases = new Set(pack.aliases);
  if (aliases.size !== pack.aliases.length || !aliases.has(pack.id)) return "Saved route aliases do not prove route ownership.";
  if (typeof pack.name !== "string" || pack.name.length > 512) return "Saved route name is invalid.";
  if (!validGeometry(pack.geometry)) {
    return positionCount(pack.geometry) > MAX_ROUTE_PACK_COORDINATES
      ? `Route has more than ${MAX_ROUTE_PACK_COORDINATES.toLocaleString()} coordinates and cannot be navigated safely offline.`
      : "Route geometry is invalid.";
  }
  if (!Array.isArray(pack.bbox) || pack.bbox.length !== 4 || !pack.bbox.every(Number.isFinite) ||
    pack.bbox[0] < -180 || pack.bbox[2] > 180 || pack.bbox[1] < -90 || pack.bbox[3] > 90 ||
    pack.bbox[0] > pack.bbox[2] || pack.bbox[1] > pack.bbox[3]) return "Saved route bounds are invalid.";
  if (!Number.isFinite(pack.lengthMeters) || pack.lengthMeters < 0) return "Saved route length is invalid.";
  if (!Array.isArray(pack.cumulativeDistancesMeters) || pack.cumulativeDistancesMeters.length !== positionCount(pack.geometry) ||
    pack.cumulativeDistancesMeters.some((value) => !Number.isFinite(value) || value < 0) ||
    pack.cumulativeDistancesMeters.some((value, index, values) => index > 0 && value < values[index - 1])) {
    return "Saved route distance index is invalid.";
  }
  if (!Array.isArray(pack.elevationProfile) || pack.elevationProfile.length > MAX_ELEVATION_PROFILE_POINTS ||
    pack.elevationProfile.some((point) => !Number.isFinite(point.distanceMeters) || !Number.isFinite(point.elevation) || point.distanceMeters < 0) ||
    pack.elevationProfile.some((point, index, profile) => index > 0 && point.distanceMeters <= profile[index - 1].distanceMeters)) {
    return "Saved route elevation profile is invalid.";
  }
  if (pack.gpx !== undefined && (typeof pack.gpx !== "string" || new TextEncoder().encode(pack.gpx).byteLength > MAX_ROUTE_PACK_GPX_BYTES)) {
    return "Saved route export data is too large.";
  }
  const cachedAt = Date.parse(pack.cachedAt);
  if (!Number.isFinite(cachedAt) || cachedAt < Date.UTC(2020, 0, 1) || cachedAt > Date.now() + 5 * 60_000) {
    return "Saved route timestamp is invalid or the device clock is incorrect.";
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(pack)).byteLength > MAX_ROUTE_PACK_BYTES) return "Saved route pack is too large.";
  } catch {
    return "Saved route pack cannot be read.";
  }
  return null;
}

/** Exported for direct persistence-boundary tests. */
export function validateRoutePack(pack: RoutePack | null | undefined): string | null {
  return validationError(pack);
}

export function packOwnsAlias(pack: RoutePack, id: string): boolean {
  return pack.id === id || (pack.canonicalId === pack.id && new Set(pack.aliases).has(id));
}

/** Converts v1 duplicated records into one canonical payload plus alias pointers. */
export function collapseLegacyRoutePacks(records: RoutePack[]): { packs: RoutePack[]; aliases: RoutePackAlias[] } {
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
    const source = group.find((record) => record.id === canonicalId) ?? [...group].sort((a, b) => b.cachedAt.localeCompare(a.cachedAt))[0];
    const aliasesForPack = uniqueAliases(canonicalId, group.flatMap((record) => [...(record.aliases ?? []), record.id]));
    const pack: RoutePack = { ...source, id: canonicalId, canonicalId, aliases: aliasesForPack };
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
        if (!db.objectStoreNames.contains("routePacks")) db.createObjectStore("routePacks", { keyPath: "id" });
        if (!db.objectStoreNames.contains("aliases")) {
          const aliases = db.createObjectStore("aliases", { keyPath: "alias" });
          aliases.createIndex("by-canonical", "canonicalId");
        }
        if (!db.objectStoreNames.contains("lastFix")) db.createObjectStore("lastFix", { keyPath: "id" });
        if (oldVersion <= 0) return;

        const nativeTransaction = unwrap(transaction);
        const packStore = nativeTransaction.objectStore("routePacks");
        const aliasStore = nativeTransaction.objectStore("aliases");
        const request = packStore.getAll();
        request.onsuccess = () => {
          const records = request.result as RoutePack[];
          if (oldVersion === 1) {
            const { packs, aliases } = collapseLegacyRoutePacks(records);
            packStore.clear();
            packs.forEach((pack) => packStore.put(pack));
            aliases.forEach((alias) => aliasStore.put(alias));
            return;
          }
          // v2/v3 already have one canonical record. Add the explicit identity
          // field during the same versionchange transaction; older versions are
          // deliberately stale and must be prepared again before use.
          records.forEach((record) => packStore.put({ ...record, canonicalId: record.id }));
        };
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
  if (!validId(input.id)) throw new Error("Route id is invalid.");
  if (!validGeometry(input.geometry)) {
    const count = positionCount(input.geometry);
    throw new Error(count > MAX_ROUTE_PACK_COORDINATES
      ? `This route has ${count.toLocaleString()} coordinates. Offline navigation supports up to ${MAX_ROUTE_PACK_COORDINATES.toLocaleString()} coordinates; split or simplify it while online.`
      : "Route geometry is invalid — cannot navigate safely.");
  }
  const aliases = uniqueAliases(input.id, input.aliases);
  const pack: RoutePack = {
    id: input.id,
    canonicalId: input.id,
    aliases,
    name: input.name,
    geometry: input.geometry,
    bbox: input.bbox ?? bboxFromGeometry(input.geometry, 0.004) ?? [0, 0, 0, 0],
    elevationProfile: input.elevationProfile ?? [],
    lengthMeters: 0,
    cumulativeDistancesMeters: cumulativeDistancesForGeometry(input.geometry),
    cachedAt: new Date().toISOString(),
    version: ROUTE_PACK_VERSION,
  };
  pack.lengthMeters = pack.cumulativeDistancesMeters.at(-1) ?? 0;
  const error = validationError(pack);
  if (error) throw new Error(error);
  return pack;
}

export function routePackStatus(pack: RoutePack | null | undefined): RoutePackStatus {
  if (!pack) return "missing";
  if (pack.version !== ROUTE_PACK_VERSION) return "stale";
  return validationError(pack) ? "invalid" : "ready";
}

export async function saveRoutePack(pack: RoutePack) {
  const validation = validationError(pack);
  if (validation) throw new Error(validation);
  const db = await getDb();
  if (!db) throw new Error("Offline route storage is unavailable in this browser.");

  const tx = db.transaction(["routePacks", "aliases"], "readwrite");
  try {
    const aliasesStore = tx.objectStore("aliases");
    const packStore = tx.objectStore("routePacks");
    const aliases = uniqueAliases(pack.id, pack.aliases);
    const pointers = await Promise.all(aliases.map((alias) => aliasesStore.get(alias)));
    const conflict = pointers.find((pointer) => pointer && pointer.canonicalId !== pack.id);
    if (conflict) throw new Error(`Route alias ${conflict.alias} is owned by a different saved route. Re-download the matching trail while online.`);

    // Remove aliases dropped by an update in this exact transaction, so a stale
    // pointer can never resolve to a payload that no longer claims it.
    const oldPointers = await aliasesStore.index("by-canonical").getAll(pack.id);
    const stored: RoutePack = { ...pack, id: pack.id, canonicalId: pack.id, aliases, version: ROUTE_PACK_VERSION };
    await packStore.put(stored);
    await Promise.all(aliases.map((alias) => aliasesStore.put({ alias, canonicalId: stored.id })));
    await Promise.all(oldPointers.filter((pointer) => !aliases.includes(pointer.alias)).map((pointer) => aliasesStore.delete(pointer.alias)));
    await tx.done;
  } catch (error) {
    // IDB request methods can throw synchronously (for example, a quota adapter
    // throwing from aliases.put). Explicitly abort so a queued payload write
    // cannot commit on its own.
    try { tx.abort(); } catch { /* already completed/aborted */ }
    try { await tx.done; } catch { /* preserve original error */ }
    throw error;
  }
}

async function findRoutePack(db: IDBPDatabase<RoutePackDB>, id: string): Promise<{ pack: RoutePack | null; error?: string }> {
  const tx = db.transaction(["routePacks", "aliases"], "readonly");
  const pointer = await tx.objectStore("aliases").get(id);
  const pack = await tx.objectStore("routePacks").get(pointer?.canonicalId ?? id);
  await tx.done;
  if (!pack) return { pack: null };
  if (pointer && !packOwnsAlias(pack, id)) {
    return { pack: null, error: "Saved route does not match this trail — re-download while you have signal." };
  }
  if (!pointer && pack.id !== id) {
    return { pack: null, error: "Saved route identity is inconsistent — re-download while you have signal." };
  }
  return { pack };
}

export async function getRoutePackStatus(id: string): Promise<RoutePackLookup> {
  const db = await getDb();
  if (!db) return { pack: null, status: "missing" };
  const found = await findRoutePack(db, id);
  if (found.error) return { pack: null, status: "invalid", error: found.error };
  const status = routePackStatus(found.pack);
  return {
    pack: status === "ready" || status === "stale" ? found.pack : null,
    status,
    error: status === "invalid" ? validationError(found.pack) ?? "Saved route pack is invalid." : undefined,
  };
}

export async function getRoutePack(id: string): Promise<RoutePack | null> {
  const lookup = await getRoutePackStatus(id);
  return lookup.status === "ready" ? lookup.pack : null;
}

export async function listRoutePacks(): Promise<RoutePack[]> {
  const db = await getDb();
  if (!db) return [];
  return (await db.getAll("routePacks")).filter((pack) => routePackStatus(pack) !== "invalid");
}

export async function hasRoutePack(id: string): Promise<boolean> {
  return (await getRoutePackStatus(id)).status === "ready";
}

<<<<<<< HEAD
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
=======
export async function saveLastFix(fix: { lat: number; lng: number; accuracy?: number; heading?: number; recordedAt?: number }) {
  const db = await getDb();
  if (!db) return;
  const recordedAt = fix.recordedAt ?? Date.now();
  // Never persist a future or epoch fix as if it were a fresh position.
  if (!Number.isFinite(recordedAt) || recordedAt < Date.UTC(2020, 0, 1) || recordedAt > Date.now() + 5 * 60_000) return;
  await db.put("lastFix", { ...fix, id: "current", recordedAt: new Date(recordedAt).toISOString() });
>>>>>>> origin/main
}

export async function getLastFix() {
  const db = await getDb();
  if (!db) return null;
  const fix = await db.get("lastFix", "current");
  const recordedAt = fix ? Date.parse(fix.recordedAt) : NaN;
  return fix && Number.isFinite(recordedAt) && recordedAt >= Date.UTC(2020, 0, 1) && recordedAt <= Date.now() + 5 * 60_000 ? fix : null;
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
