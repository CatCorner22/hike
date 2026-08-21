import { nearestPointOnTrail } from "@/lib/geo";
import type { CorridorFeatureLayer, CorridorFeatureSet } from "@/lib/offline/corridor-features";
import type { BailoutCandidate } from "@/lib/safety/bailout";

export const CORRIDOR_DECISION_DISCLAIMER =
  "OSM features near the prepared route, not guaranteed exits. No off-route path is stored.";

export const NEAR_ROUTE_POINT_METERS = 200;
export const NEAR_ROUTE_ROAD_METERS = 80;
export const NEAR_ROUTE_TRAIL_METERS = 60;
export const MAX_CORRIDOR_DECISIONS = 24;
const DEDUPE_ROUTE_METERS = 80;

const LAYER_LIMIT: Partial<Record<CorridorFeatureLayer, number>> = {
  shelters: NEAR_ROUTE_POINT_METERS,
  campsites: NEAR_ROUTE_POINT_METERS,
  landmarks: 150,
  roads: NEAR_ROUTE_ROAD_METERS,
  trails: NEAR_ROUTE_TRAIL_METERS,
};

function kindForLayer(layer: CorridorFeatureLayer): BailoutCandidate["kind"] | null {
  if (layer === "shelters") return "shelter";
  if (layer === "roads") return "road";
  if (layer === "campsites") return "developed";
  if (layer === "trails" || layer === "landmarks") return "custom";
  return null;
}

function layerLabel(layer: CorridorFeatureLayer): string {
  if (layer === "shelters") return "OSM shelter";
  if (layer === "roads") return "OSM road";
  if (layer === "campsites") return "OSM campsite";
  if (layer === "trails") return "OSM trail";
  if (layer === "landmarks") return "OSM landmark";
  return "OSM feature";
}

function sampleLine(coordinates: GeoJSON.Position[], max = 16): GeoJSON.Position[] {
  if (coordinates.length <= max) return coordinates;
  const last = max - 1;
  const step = (coordinates.length - 1) / last;
  const sampled: GeoJSON.Position[] = [];
  for (let index = 0; index < last; index += 1) {
    sampled.push(coordinates[Math.round(index * step)]);
  }
  sampled.push(coordinates[coordinates.length - 1]);
  return sampled;
}

function positionsForFeature(feature: GeoJSON.Feature<GeoJSON.Point | GeoJSON.LineString>): GeoJSON.Position[] {
  if (feature.geometry.type === "Point") return [feature.geometry.coordinates];
  return sampleLine(feature.geometry.coordinates);
}

export function deriveCorridorBailouts(input: {
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  features?: CorridorFeatureSet | null;
}): BailoutCandidate[] {
  if (!input.features?.features.features.length) return [];
  const found: BailoutCandidate[] = [];

  for (const feature of input.features.features.features) {
    const layer = feature.properties?.layer;
    if (!layer) continue;
    const limit = LAYER_LIMIT[layer];
    const kind = kindForLayer(layer);
    if (limit == null || !kind) continue;

    let best: { lat: number; lng: number; distanceMeters: number; alongMeters: number } | null = null;
    for (const position of positionsForFeature(feature)) {
      const snapped = nearestPointOnTrail({ lng: position[0], lat: position[1] }, input.geometry);
      if (!snapped || !Number.isFinite(snapped.distanceMeters) || !Number.isFinite(snapped.alongMeters)) continue;
      if (!best || snapped.distanceMeters < best.distanceMeters) best = snapped;
    }
    if (!best || best.distanceMeters > limit) continue;

    found.push({
      id: `osm-${layer}-${feature.properties?.osmId ?? found.length}`,
      name: feature.properties?.name || layerLabel(layer),
      kind,
      lat: best.lat,
      lng: best.lng,
      routeDistanceMeters: best.alongMeters,
      exitDistanceMeters: best.distanceMeters,
      note: `${layerLabel(layer)} comes within ${Math.round(best.distanceMeters)} m of the route. ${CORRIDOR_DECISION_DISCLAIMER}`,
    });
  }

  const unique: BailoutCandidate[] = [];
  for (const candidate of found.sort((a, b) => a.routeDistanceMeters - b.routeDistanceMeters)) {
    if (unique.some((existing) => Math.abs(existing.routeDistanceMeters - candidate.routeDistanceMeters) < DEDUPE_ROUTE_METERS)) {
      continue;
    }
    unique.push(candidate);
    if (unique.length >= MAX_CORRIDOR_DECISIONS) break;
  }
  return unique;
}
