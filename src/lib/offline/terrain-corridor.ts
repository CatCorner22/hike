import { bboxFromGeometry } from "@/lib/geo";
import type { BboxLngLat } from "@/lib/geo/bbox";

export const CORRIDOR_LAYER_NAMES = [
  "contours",
  "hillshade",
  "trails",
  "roads",
  "water",
  "shelters",
  "campsites",
  "landmarks",
] as const;

export type CorridorLayer = (typeof CORRIDOR_LAYER_NAMES)[number];

export interface TerrainCorridorSpec {
  routeId: string;
  bufferMeters: number;
  /** One ordinary bbox, or two non-wrapping bboxes when the route crosses the antimeridian. */
  bboxes: BboxLngLat[];
  layers: CorridorLayer[];
  generatedAt: string;
}

export const DEFAULT_TERRAIN_CORRIDOR_METERS = 3218.688; // 2 miles
export const MAX_TERRAIN_CORRIDOR_METERS = 16093.44; // 10 miles

/**
 * Planning densities for a bbox-area estimate. Raster layers dominate.
 * This is not a measured tile download — provider tiles are not shipped yet.
 */
export const CORRIDOR_BYTES_PER_KM2: Record<CorridorLayer, number> = {
  hillshade: 180_000,
  contours: 90_000,
  trails: 8_000,
  roads: 12_000,
  water: 10_000,
  shelters: 400,
  campsites: 400,
  landmarks: 800,
};

const LAYER_SET = new Set<string>(CORRIDOR_LAYER_NAMES);

function validBbox(value: unknown): value is BboxLngLat {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) return false;
  const [minLng, minLat, maxLng, maxLat] = value;
  return minLng >= -180 && maxLng <= 180 && minLat >= -90 && maxLat <= 90 && minLng <= maxLng && minLat <= maxLat;
}

/** Convert the local unwrapped longitude interval into one or two ordinary GeoJSON bboxes. */
function splitCorridorBbox(bbox: [number, number, number, number]): BboxLngLat[] {
  let [minLng, minLat, maxLng, maxLat] = bbox;
  minLat = Math.max(-90, Math.min(90, minLat));
  maxLat = Math.max(-90, Math.min(90, maxLat));
  if (minLat > maxLat || ![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
    throw new Error("Route bounds are unavailable.");
  }

  const width = maxLng - minLng;
  if (width < 0) throw new Error("Route bounds are unavailable.");
  if (width >= 360) return [[-180, minLat, 180, maxLat]];

  while (minLng < -180) {
    minLng += 360;
    maxLng += 360;
  }
  while (minLng > 180) {
    minLng -= 360;
    maxLng -= 360;
  }

  const bboxes: BboxLngLat[] = maxLng <= 180
    ? [[minLng, minLat, maxLng, maxLat]]
    : [
      [minLng, minLat, 180, maxLat],
      [-180, minLat, maxLng - 360, maxLat],
    ];
  if (!bboxes.every(validBbox)) throw new Error("Route bounds are unavailable.");
  return bboxes;
}

export function terrainCorridorBboxesForGeometry(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  bufferMeters: number,
): BboxLngLat[] {
  const latPadding = bufferMeters / 111_320;
  const routeBbox = bboxFromGeometry(geometry, 0);
  if (!routeBbox) throw new Error("Route bounds are unavailable.");
  const maxBufferedLatitude = Math.min(89.9, Math.max(Math.abs(routeBbox[1]), Math.abs(routeBbox[3])) + latPadding);
  const longitudeScale = Math.max(0.001, Math.cos((maxBufferedLatitude * Math.PI) / 180));
  const longitudePadding = bufferMeters / (111_320 * longitudeScale);
  const bbox: [number, number, number, number] = [
    routeBbox[0] - longitudePadding,
    routeBbox[1] - latPadding,
    routeBbox[2] + longitudePadding,
    routeBbox[3] + latPadding,
  ];
  return splitCorridorBbox(bbox);
}

export function buildTerrainCorridorSpec(input: {
  routeId: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bufferMeters?: number;
  layers?: TerrainCorridorSpec["layers"];
}): TerrainCorridorSpec {
  const bufferMeters = input.bufferMeters ?? DEFAULT_TERRAIN_CORRIDOR_METERS;
  if (!Number.isFinite(bufferMeters) || bufferMeters <= 0 || bufferMeters > MAX_TERRAIN_CORRIDOR_METERS) {
    throw new Error("Offline terrain corridor must be greater than 0 and no more than 10 miles.");
  }
  if (typeof input.routeId !== "string" || input.routeId.length === 0 || input.routeId.length > 256) {
    throw new Error("Offline terrain corridor route id is invalid.");
  }
  const layers = input.layers ?? [...CORRIDOR_LAYER_NAMES];
  if (!validCorridorLayers(layers)) {
    throw new Error("Offline terrain corridor layers are invalid.");
  }
  return {
    routeId: input.routeId,
    bufferMeters,
    bboxes: terrainCorridorBboxesForGeometry(input.geometry, bufferMeters),
    layers,
    generatedAt: new Date().toISOString(),
  };
}

export function corridorCoverageLabel(spec: TerrainCorridorSpec): string {
  const miles = spec.bufferMeters / 1609.344;
  return `Full route + ${miles < 1 ? miles.toFixed(1) : miles.toFixed(0)} mi corridor`;
}

function validCorridorLayers(layers: unknown): layers is CorridorLayer[] {
  if (!Array.isArray(layers) || layers.length === 0 || layers.length > CORRIDOR_LAYER_NAMES.length) return false;
  if (new Set(layers).size !== layers.length) return false;
  return layers.every((layer) => LAYER_SET.has(layer));
}

function sameBboxes(actual: BboxLngLat[], expected: BboxLngLat[], epsilon = 1e-9): boolean {
  return actual.length === expected.length && actual.every((bbox, index) =>
    bbox.every((value, coordinate) => Math.abs(value - expected[index][coordinate]) <= epsilon));
}

export function validTerrainCorridor(
  value: unknown,
  expectedRouteId?: string,
  expectedGeometry?: GeoJSON.LineString | GeoJSON.MultiLineString,
): value is TerrainCorridorSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as TerrainCorridorSpec;
  if (typeof spec.routeId !== "string" || spec.routeId.length === 0 || spec.routeId.length > 256) return false;
  if (expectedRouteId !== undefined && spec.routeId !== expectedRouteId) return false;
  if (!Number.isFinite(spec.bufferMeters) || spec.bufferMeters <= 0 || spec.bufferMeters > MAX_TERRAIN_CORRIDOR_METERS) {
    return false;
  }
  if (!Array.isArray(spec.bboxes) || spec.bboxes.length < 1 || spec.bboxes.length > 2 || !spec.bboxes.every(validBbox)) return false;
  if (expectedGeometry) {
    try {
      if (!sameBboxes(spec.bboxes, terrainCorridorBboxesForGeometry(expectedGeometry, spec.bufferMeters))) return false;
    } catch {
      return false;
    }
  }
  if (!validCorridorLayers(spec.layers)) return false;
  if (typeof spec.generatedAt !== "string") return false;
  const generatedAt = Date.parse(spec.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt < Date.UTC(2020, 0, 1) || generatedAt > Date.now() + 5 * 60_000) {
    return false;
  }
  return true;
}

/** Equirectangular bbox area. Overestimates a tight trail buffer — that is intentional. */
export function corridorBboxAreaKm2(bbox: BboxLngLat): number {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((midLat * Math.PI) / 180);
  if (!Number.isFinite(kmPerDegLng) || kmPerDegLng <= 0) return 0;
  const widthKm = Math.max(0, (maxLng - minLng) * kmPerDegLng);
  const heightKm = Math.max(0, (maxLat - minLat) * kmPerDegLat);
  const area = widthKm * heightKm;
  return Number.isFinite(area) ? area : 0;
}

export function estimateCorridorBytes(spec: TerrainCorridorSpec): number {
  const areaKm2 = spec.bboxes.reduce((total, bbox) => total + corridorBboxAreaKm2(bbox), 0);
  if (areaKm2 <= 0) return 0;
  let total = 0;
  for (const layer of spec.layers) {
    total += areaKm2 * CORRIDOR_BYTES_PER_KM2[layer];
  }
  return Number.isFinite(total) ? Math.round(total) : 0;
}

export function formatCorridorBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function corridorSizeLabel(spec: TerrainCorridorSpec): string {
  return `~${formatCorridorBytes(estimateCorridorBytes(spec))} planned`;
}

export function describePersistedCorridor(spec: TerrainCorridorSpec): string {
  return `${corridorCoverageLabel(spec)} (${corridorSizeLabel(spec)}; bbox estimate; terrain tiles not downloaded yet)`;
}
