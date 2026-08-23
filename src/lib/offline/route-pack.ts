import { openDB, unwrap, type DBSchema, type IDBPDatabase } from "idb";
import { bboxFromGeometry } from "@/lib/geo";
import type { PackWeather } from "@/lib/offline/pack-weather";
import { isUsableTerrainGrid, type TerrainGrid } from "@/lib/offline/terrain-grid";
import {
  validCorridorFeatures,
  type CorridorFeatureSet,
} from "@/lib/offline/corridor-features";
import {
  validHazardBrief,
  type RouteHazardBrief,
} from "@/lib/offline/hazard-brief";
import {
  validOfficialAlertSnapshot,
  type RouteOfficialAlertSnapshot,
} from "@/lib/offline/official-alerts";
import {
  validBailoutRoutes,
  type PreparedBailoutRoute,
} from "@/lib/offline/bailout-routes";
import {
  buildTerrainCorridorSpec,
  validTerrainCorridor,
  type TerrainCorridorSpec,
} from "@/lib/offline/terrain-corridor";

/**
 * Offline packs have an intentionally conservative ceiling.  A route above this
 * count is not saved: silently simplifying a safety route would be worse than a
 * clear request to prepare a smaller route while online.
 */
export const MAX_ROUTE_PACK_COORDINATES = 100_000;
export const MAX_ROUTE_PACK_BYTES = 16 * 1024 * 1024;
export const MAX_ROUTE_PACK_GPX_BYTES = 2 * 1024 * 1024;
export const MAX_ELEVATION_PROFILE_POINTS = 2_048;
export const ROUTE_PACK_VERSION = 3;
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
  weather?: PackWeather;
  /**
   * Planned offline terrain corridor. Optional on legacy packs so they stay
   * navigable; prepare-offline writes it on every new save.
   */
  corridor?: TerrainCorridorSpec;
  /**
   * OSM vector context for the planned corridor. Optional — prepare stores it
   * when Overpass answers; legacy packs and failed fetches stay navigable.
   */
  corridorFeatures?: CorridorFeatureSet;
  /**
   * Along-route forecast snapshot at prepare time. Optional — prepare stores it
   * when Open-Meteo answers; legacy packs and failed fetches stay navigable.
   */
  hazardBrief?: RouteHazardBrief;
  /**
   * Point-sampled NWS alerts and, when an exact unit code is verified, NPS
   * notices. Absence means the sources were not checked, never "all clear."
   */
  officialAlerts?: RouteOfficialAlertSnapshot;
  /**
   * User-supplied bailout tracks that already meet this route. Optional —
   * visiting the plan page must not invent connectors or drop a navigable pack.
   */
  bailoutRoutes?: PreparedBailoutRoute[];
  /**
   * Coarse elevation samples over the corridor, for relief shading on the
   * offline map. Optional: a pack without it is navigable, it just draws the
   * route on blank ground the way every pack did before this existed.
   */
  terrain?: TerrainGrid;
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

export type RoutePackStatus = "ready" | "stale" | "invalid" | "missing";
export type RoutePackExtraField =
  | "weather"
  | "corridor"
  | "corridorFeatures"
  | "hazardBrief"
  | "officialAlerts"
  | "bailoutRoutes"
  | "terrain"
  | "bbox";
export interface RoutePackLookup {
  pack: RoutePack | null;
  status: RoutePackStatus;
  /** Safe, user-facing reason when an untrusted cache record was rejected. */
  error?: string;
  /** Optional extras dropped so a prepared route stays navigable. */
  strippedExtras?: RoutePackExtraField[];
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

/**
 * Pack bboxes use the compact unwrapped interval from `bboxFromGeometry`.
 * A dateline walk is stored as e.g. [179.8, -16.5, 180.2, -16.5] — not a
 * world-spanning [-180, 180] box and not a wrapping min>max GeoJSON box.
 */
function validStoredRouteBbox(bbox: unknown): bbox is [number, number, number, number] {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return false;
  }
  const [minLng, minLat, maxLng, maxLat] = bbox;
  if (minLat < -90 || maxLat > 90 || minLat > maxLat || minLng > maxLng) return false;
  if (maxLng - minLng >= 180) return false;
  if (minLng < -181 || maxLng > 540) return false;
  return true;
}

function finitePosition(position: unknown): position is GeoJSON.Position {
  return Array.isArray(position) &&
    position.length >= 2 &&
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

export function validPackWeather(weather: unknown): weather is PackWeather {
  if (!weather || typeof weather !== "object") return false;
  const candidate = weather as PackWeather;
  if (candidate.source !== "open-meteo" && candidate.source !== "manual") return false;
  if (typeof candidate.cachedAt !== "string") return false;
  const cachedAt = Date.parse(candidate.cachedAt);
  if (!Number.isFinite(cachedAt)) return false;
  if (candidate.tempC !== undefined && !Number.isFinite(candidate.tempC)) return false;
  if (candidate.windKph !== undefined && !Number.isFinite(candidate.windKph)) return false;
  if (candidate.rhPct !== undefined && !Number.isFinite(candidate.rhPct)) return false;
  if (candidate.note !== undefined && typeof candidate.note !== "string") return false;
  return true;
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
  if (!validStoredRouteBbox(pack.bbox)) return "Saved route bounds are invalid.";
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
  if (pack.weather !== undefined && !validPackWeather(pack.weather)) {
    return "Saved route weather snapshot is invalid.";
  }
  if (pack.corridor !== undefined && !validTerrainCorridor(pack.corridor, pack.id, pack.geometry)) {
    return "Saved route terrain corridor is invalid.";
  }
  if (pack.corridorFeatures !== undefined) {
    if (!pack.corridor) return "Saved route corridor features are missing a corridor record.";
    if (!validCorridorFeatures(pack.corridorFeatures, pack.id, pack.corridor.bboxes)) {
      return "Saved route corridor features are invalid.";
    }
  }
  if (pack.hazardBrief !== undefined && !validHazardBrief(pack.hazardBrief, pack.id, pack.bbox)) {
    return "Saved route hazard briefing is invalid.";
  }
  if (pack.officialAlerts !== undefined && !validOfficialAlertSnapshot(pack.officialAlerts, pack.id)) {
    return "Saved route official alert snapshot is invalid.";
  }
  if (pack.bailoutRoutes !== undefined && !validBailoutRoutes(pack.bailoutRoutes, pack.id, pack.geometry)) {
    return "Saved route bailout tracks are invalid.";
  }
  if (pack.terrain !== undefined && !validPackTerrain(pack.terrain, pack.bbox)) {
    return "Saved route terrain grid is invalid.";
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

/**
 * A terrain grid belongs to the route it was stored with.
 *
 * Structural validity is `isUsableTerrainGrid`'s job; this adds the one thing
 * that module cannot know — that the grid actually covers this pack's own
 * corridor. A grid from a different route would shade the wrong hillside under
 * the right line, which is worse than shading nothing.
 */
function validPackTerrain(
  terrain: unknown,
  packBbox: [number, number, number, number] | undefined,
): terrain is TerrainGrid {
  if (!isUsableTerrainGrid(terrain)) return false;
  if (!packBbox || !validStoredRouteBbox(packBbox)) return false;
  const [minLng, minLat, maxLng, maxLat] = packBbox;
  const [gMinLng, gMinLat, gMaxLng, gMaxLat] = terrain.bbox;
  // A little slack for the rounding either side did on the way in and out.
  const slack = 0.01;
  return (
    gMinLng <= minLng + slack
    && gMinLat <= minLat + slack
    && gMaxLng >= maxLng - slack
    && gMaxLat >= maxLat - slack
  );
}

/** Exported for direct persistence-boundary tests. */
export function validateRoutePack(pack: RoutePack | null | undefined): string | null {
  return validationError(pack);
}

/**
 * Optional extras must never take down a prepared Safety Map. Prepare still
 * refuses to *write* a poisoned extra; load/list/import drop that extra and
 * keep the route. Combined failures (offline + bit-flipped forecast + bad
 * OSM + a distant bailout file) are the field case this exists for.
 */
export function sanitizeRoutePackForUse(pack: RoutePack): {
  pack: RoutePack;
  stripped: RoutePackExtraField[];
} {
  const next: RoutePack = { ...pack };
  const stripped: RoutePackExtraField[] = [];

  if (!validStoredRouteBbox(next.bbox)) {
    const computed = bboxFromGeometry(next.geometry, 0.004);
    if (computed && validStoredRouteBbox(computed)) {
      next.bbox = computed;
      stripped.push("bbox");
    }
  }

  if (next.weather !== undefined && !validPackWeather(next.weather)) {
    delete next.weather;
    stripped.push("weather");
  }

  if (next.corridor !== undefined && !validTerrainCorridor(next.corridor, next.id, next.geometry)) {
    delete next.corridor;
    stripped.push("corridor");
    if (next.corridorFeatures !== undefined) {
      delete next.corridorFeatures;
      stripped.push("corridorFeatures");
    }
  } else if (next.corridorFeatures !== undefined) {
    const featuresOk = Boolean(next.corridor) &&
      validCorridorFeatures(next.corridorFeatures, next.id, next.corridor!.bboxes);
    if (!featuresOk) {
      delete next.corridorFeatures;
      stripped.push("corridorFeatures");
    }
  }

  if (next.hazardBrief !== undefined && !validHazardBrief(next.hazardBrief, next.id, next.bbox)) {
    delete next.hazardBrief;
    stripped.push("hazardBrief");
  }

  if (next.officialAlerts !== undefined && !validOfficialAlertSnapshot(next.officialAlerts, next.id)) {
    delete next.officialAlerts;
    stripped.push("officialAlerts");
  }

  if (next.terrain !== undefined && !validPackTerrain(next.terrain, next.bbox)) {
    delete next.terrain;
    stripped.push("terrain");
  }

  if (next.bailoutRoutes !== undefined && !validBailoutRoutes(next.bailoutRoutes, next.id, next.geometry)) {
    delete next.bailoutRoutes;
    stripped.push("bailoutRoutes");
  }

  return { pack: next, stripped };
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
  weather?: PackWeather;
  corridor?: TerrainCorridorSpec;
  corridorFeatures?: CorridorFeatureSet;
  hazardBrief?: RouteHazardBrief;
  officialAlerts?: RouteOfficialAlertSnapshot;
  bailoutRoutes?: PreparedBailoutRoute[];
  terrain?: TerrainGrid;
}): RoutePack {
  if (!validId(input.id)) throw new Error("Route id is invalid.");
  if (!validGeometry(input.geometry)) {
    const count = positionCount(input.geometry);
    throw new Error(count > MAX_ROUTE_PACK_COORDINATES
      ? `This route has ${count.toLocaleString()} coordinates. Offline navigation supports up to ${MAX_ROUTE_PACK_COORDINATES.toLocaleString()} coordinates; split or simplify it while online.`
      : "Route geometry is invalid — cannot navigate safely.");
  }
  const aliases = uniqueAliases(input.id, input.aliases);
  const computedBbox = bboxFromGeometry(input.geometry, 0.004);
  const pack: RoutePack = {
    id: input.id,
    canonicalId: input.id,
    aliases,
    name: input.name,
    geometry: input.geometry,
    bbox: input.bbox && validStoredRouteBbox(input.bbox) ? input.bbox : computedBbox ?? [0, 0, 0, 0],
    elevationProfile: input.elevationProfile ?? [],
    lengthMeters: 0,
    cumulativeDistancesMeters: cumulativeDistancesForGeometry(input.geometry),
    cachedAt: new Date().toISOString(),
    version: ROUTE_PACK_VERSION,
    weather: input.weather,
    corridor: input.corridor ?? buildTerrainCorridorSpec({ routeId: input.id, geometry: input.geometry }),
    corridorFeatures: input.corridorFeatures,
    hazardBrief: input.hazardBrief,
    officialAlerts: input.officialAlerts,
    bailoutRoutes: input.bailoutRoutes,
    terrain: input.terrain,
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
  if (!found.pack) return { pack: null, status: "missing" };
  if (found.pack.version !== ROUTE_PACK_VERSION) {
    return { pack: found.pack, status: "stale" };
  }
  const { pack, stripped } = sanitizeRoutePackForUse(found.pack);
  const error = validationError(pack);
  if (error) {
    return { pack: null, status: "invalid", error };
  }
  return {
    pack,
    status: "ready",
    strippedExtras: stripped.length ? stripped : undefined,
  };
}

export async function getRoutePack(id: string): Promise<RoutePack | null> {
  const lookup = await getRoutePackStatus(id);
  return lookup.status === "ready" ? lookup.pack : null;
}

export async function listRoutePacks(): Promise<RoutePack[]> {
  const db = await getDb();
  if (!db) return [];
  return (await db.getAll("routePacks")).flatMap((pack) => {
    if (pack.version !== ROUTE_PACK_VERSION) {
      return routePackStatus(pack) !== "invalid" ? [pack] : [];
    }
    const sanitized = sanitizeRoutePackForUse(pack).pack;
    return validationError(sanitized) ? [] : [sanitized];
  });
}

export async function hasRoutePack(id: string): Promise<boolean> {
  return (await getRoutePackStatus(id)).status === "ready";
}

/** Deletes one canonical payload and every alias pointer in one transaction. */
export async function deleteRoutePack(id: string): Promise<boolean> {
  if (!validId(id)) return false;
  const db = await getDb();
  if (!db) throw new Error("Offline route storage is unavailable in this browser.");
  const tx = db.transaction(["routePacks", "aliases"], "readwrite");
  try {
    const aliasesStore = tx.objectStore("aliases");
    const packStore = tx.objectStore("routePacks");
    const pointer = await aliasesStore.get(id);
    const canonicalId = pointer?.canonicalId ?? id;
    const pack = await packStore.get(canonicalId);
    if (!pack) {
      if (pointer) await aliasesStore.delete(id);
      await tx.done;
      return false;
    }
    if ((pointer && !packOwnsAlias(pack, id)) || (!pointer && pack.id !== id)) {
      throw new Error("Saved route identity is inconsistent. Nothing was deleted.");
    }
    const pointers = await aliasesStore.index("by-canonical").getAll(canonicalId);
    await packStore.delete(canonicalId);
    await Promise.all(pointers.map((alias) => aliasesStore.delete(alias.alias)));
    await tx.done;
    return true;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed/aborted */ }
    try { await tx.done; } catch { /* preserve original error */ }
    throw error;
  }
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
  const recordedAt = fix.recordedAt ?? Date.now();
  // Never persist a future or epoch fix as if it were a fresh position.
  if (!Number.isFinite(recordedAt) || recordedAt < Date.UTC(2020, 0, 1) || recordedAt > Date.now() + 5 * 60_000) return;
  lastFixWrite = lastFixWrite
    .catch(() => undefined)
    .then(async () => {
      const db = await getDb();
      if (!db) return;
      const recordedAt = fix.recordedAt ?? Date.now();
      // Never persist a future or epoch fix as if it were a fresh position.
      if (!Number.isFinite(recordedAt) || recordedAt < Date.UTC(2020, 0, 1) || recordedAt > Date.now() + 5 * 60_000) return;
      await db.put("lastFix", {
        id: "current",
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        heading: fix.heading,
        altitude: fix.altitude,
        recordedAt: new Date(recordedAt).toISOString(),
      });
    });
  return lastFixWrite;
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
