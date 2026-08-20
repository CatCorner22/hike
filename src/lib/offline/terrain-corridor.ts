import { bboxFromGeometry } from "@/lib/geo";

export interface TerrainCorridorSpec {
  routeId: string;
  bufferMeters: number;
  bbox: [number, number, number, number];
  layers: Array<"contours" | "hillshade" | "trails" | "roads" | "water" | "shelters" | "campsites" | "landmarks">;
  generatedAt: string;
}

export const DEFAULT_TERRAIN_CORRIDOR_METERS = 3218.688; // 2 miles
export const MAX_TERRAIN_CORRIDOR_METERS = 16093.44; // 10 miles

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
  const latPadding = bufferMeters / 111_320;
  const bbox = bboxFromGeometry(input.geometry, latPadding);
  if (!bbox) throw new Error("Route bounds are unavailable.");
  return {
    routeId: input.routeId,
    bufferMeters,
    bbox,
    layers: input.layers ?? ["contours", "hillshade", "trails", "roads", "water", "shelters", "campsites", "landmarks"],
    generatedAt: new Date().toISOString(),
  };
}

export function corridorCoverageLabel(spec: TerrainCorridorSpec): string {
  const miles = spec.bufferMeters / 1609.344;
  return `Full route + ${miles < 1 ? miles.toFixed(1) : miles.toFixed(0)} mi corridor`;
}
