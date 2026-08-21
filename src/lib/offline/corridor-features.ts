import type { BboxLngLat } from "@/lib/geo/bbox";
import { corridorBboxAreaKm2 } from "@/lib/offline/terrain-corridor";

export const VECTOR_CORRIDOR_LAYERS = [
  "trails",
  "roads",
  "water",
  "shelters",
  "campsites",
  "landmarks",
] as const;

export type CorridorFeatureLayer = (typeof VECTOR_CORRIDOR_LAYERS)[number];

export const CORRIDOR_FEATURE_DISCLAIMER =
  "OpenStreetMap community data, snapshot at prepare time. Verify on the ground. Not a surveyed map.";

export const MAX_CORRIDOR_FEATURES = 400;
export const MAX_CORRIDOR_LINE_POINTS = 48;
export const MAX_CORRIDOR_FEATURE_BYTES = 512 * 1024;
export const MAX_CORRIDOR_QUERY_KM2 = 400;
export const CORRIDOR_FEATURES_SOURCE = "openstreetmap-overpass" as const;

export interface CorridorFeatureProperties {
  layer: CorridorFeatureLayer;
  name?: string;
  osmId?: string;
  osmType?: "node" | "way";
}

export interface CorridorFeatureSet {
  routeId: string;
  fetchedAt: string;
  source: typeof CORRIDOR_FEATURES_SOURCE;
  /** The exact non-wrapping request bounds, including both halves of a dateline corridor. */
  bboxes: BboxLngLat[];
  layersIncluded: CorridorFeatureLayer[];
  featureCount: number;
  disclaimer: string;
  features: GeoJSON.FeatureCollection<GeoJSON.Point | GeoJSON.LineString, CorridorFeatureProperties>;
}

const LAYER_SET = new Set<string>(VECTOR_CORRIDOR_LAYERS);

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function validBbox(value: unknown): value is BboxLngLat {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return false;
  }
  const [minLng, minLat, maxLng, maxLat] = value;
  return minLng >= -180 && maxLng <= 180 && minLat >= -90 && maxLat <= 90 && minLng <= maxLng && minLat <= maxLat;
}

function bboxWithin(inner: BboxLngLat, outer: BboxLngLat, epsilon = 0.0001): boolean {
  return (
    inner[0] >= outer[0] - epsilon &&
    inner[1] >= outer[1] - epsilon &&
    inner[2] <= outer[2] + epsilon &&
    inner[3] <= outer[3] + epsilon
  );
}

function sameBboxes(actual: BboxLngLat[], expected: BboxLngLat[], epsilon = 0.0001): boolean {
  return actual.length === expected.length && actual.every((bbox, index) => bboxWithin(bbox, expected[index], epsilon) &&
    bboxWithin(expected[index], bbox, epsilon));
}

function finitePosition(position: unknown): position is GeoJSON.Position {
  return (
    Array.isArray(position) &&
    position.length >= 2 &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    Number(position[0]) >= -180 &&
    Number(position[0]) <= 180 &&
    Number(position[1]) >= -90 &&
    Number(position[1]) <= 90
  );
}

function validName(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  return typeof value === "string" && value.length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validFeature(feature: unknown): feature is GeoJSON.Feature<GeoJSON.Point | GeoJSON.LineString, CorridorFeatureProperties> {
  if (!feature || typeof feature !== "object") return false;
  const candidate = feature as GeoJSON.Feature;
  if (candidate.type !== "Feature" || !candidate.geometry || typeof candidate.properties !== "object" || !candidate.properties) {
    return false;
  }
  const layer = (candidate.properties as CorridorFeatureProperties).layer;
  if (!LAYER_SET.has(layer)) return false;
  if (!validName((candidate.properties as CorridorFeatureProperties).name)) return false;
  const osmId = (candidate.properties as CorridorFeatureProperties).osmId;
  if (osmId !== undefined && (typeof osmId !== "string" || osmId.length === 0 || osmId.length > 32)) return false;
  const osmType = (candidate.properties as CorridorFeatureProperties).osmType;
  if (osmType !== undefined && osmType !== "node" && osmType !== "way") return false;
  if (candidate.geometry.type === "Point") {
    return finitePosition(candidate.geometry.coordinates);
  }
  if (candidate.geometry.type === "LineString") {
    const coords = candidate.geometry.coordinates;
    return (
      Array.isArray(coords) &&
      coords.length >= 2 &&
      coords.length <= MAX_CORRIDOR_LINE_POINTS &&
      coords.every(finitePosition)
    );
  }
  return false;
}

export function corridorQueryAllowed(bboxes: BboxLngLat[]): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(bboxes) || bboxes.length < 1 || bboxes.length > 2 || !bboxes.every(validBbox)) {
    return { ok: false, reason: "Corridor bounds are invalid." };
  }
  const area = bboxes.reduce((total, bbox) => total + corridorBboxAreaKm2(bbox), 0);
  if (area <= 0) return { ok: false, reason: "Corridor bounds are empty." };
  if (area > MAX_CORRIDOR_QUERY_KM2) {
    return {
      ok: false,
      reason: "Corridor bounding box is too large for one OpenStreetMap snapshot.",
    };
  }
  return { ok: true };
}

export function validCorridorFeatures(
  value: unknown,
  expectedRouteId?: string,
  corridorBboxes?: BboxLngLat[],
): value is CorridorFeatureSet {
  if (!value || typeof value !== "object") return false;
  const set = value as CorridorFeatureSet;
  if (!validId(set.routeId)) return false;
  if (expectedRouteId !== undefined && set.routeId !== expectedRouteId) return false;
  if (set.source !== CORRIDOR_FEATURES_SOURCE) return false;
  if (set.disclaimer !== CORRIDOR_FEATURE_DISCLAIMER) return false;
  if (typeof set.fetchedAt !== "string") return false;
  const fetchedAt = Date.parse(set.fetchedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt < Date.UTC(2020, 0, 1) || fetchedAt > Date.now() + 5 * 60_000) {
    return false;
  }
  if (!Array.isArray(set.bboxes) || set.bboxes.length < 1 || set.bboxes.length > 2 || !set.bboxes.every(validBbox)) return false;
  if (corridorBboxes && !sameBboxes(set.bboxes, corridorBboxes)) return false;
  if (!Array.isArray(set.layersIncluded)) return false;
  if (new Set(set.layersIncluded).size !== set.layersIncluded.length) return false;
  if (set.layersIncluded.some((layer) => !LAYER_SET.has(layer))) return false;
  if (!set.features || set.features.type !== "FeatureCollection" || !Array.isArray(set.features.features)) {
    return false;
  }
  if (set.featureCount !== set.features.features.length) return false;
  if (set.featureCount > MAX_CORRIDOR_FEATURES) return false;
  if (set.featureCount === 0 && set.layersIncluded.length !== 0) return false;
  if (set.featureCount > 0 && set.layersIncluded.length === 0) return false;
  if (!set.features.features.every(validFeature)) return false;
  try {
    if (new TextEncoder().encode(JSON.stringify(set)).byteLength > MAX_CORRIDOR_FEATURE_BYTES) return false;
  } catch {
    return false;
  }
  return true;
}

export function corridorFeatureCounts(set: CorridorFeatureSet): Record<CorridorFeatureLayer, number> {
  const counts = Object.fromEntries(VECTOR_CORRIDOR_LAYERS.map((layer) => [layer, 0])) as Record<
    CorridorFeatureLayer,
    number
  >;
  for (const feature of set.features.features) {
    const layer = feature.properties?.layer;
    if (layer && layer in counts) counts[layer] += 1;
  }
  return counts;
}

export function describeCorridorFeatures(set: CorridorFeatureSet): string {
  const counts = corridorFeatureCounts(set);
  const parts = VECTOR_CORRIDOR_LAYERS.filter((layer) => counts[layer] > 0).map(
    (layer) => `${counts[layer]} ${layer}`,
  );
  return `${set.featureCount} OSM features stored (${parts.join(", ") || "none"}). ${CORRIDOR_FEATURE_DISCLAIMER} Terrain tiles are not downloaded.`;
}
