import { toSouthWestNorthEast, type BboxLngLat } from "@/lib/geo/bbox";
import {
  CORRIDOR_FEATURE_DISCLAIMER,
  CORRIDOR_FEATURES_SOURCE,
  MAX_CORRIDOR_FEATURES,
  MAX_CORRIDOR_LINE_POINTS,
  VECTOR_CORRIDOR_LAYERS,
  corridorQueryAllowed,
  type CorridorFeatureLayer,
  type CorridorFeatureProperties,
  type CorridorFeatureSet,
} from "@/lib/offline/corridor-features";
import { runOverpass, type OverpassElement } from "@/lib/osm/overpass";

const PER_LAYER_CAP: Record<CorridorFeatureLayer, number> = {
  trails: 80,
  roads: 80,
  water: 40,
  shelters: 40,
  campsites: 40,
  landmarks: 40,
};

function classifyLayer(tags: Record<string, string> | undefined, type: OverpassElement["type"]): CorridorFeatureLayer | null {
  if (!tags) return null;
  if (type === "way") {
    if (/^(path|footway|steps|bridleway)$/.test(tags.highway ?? "")) return "trails";
    if (/^(track|unclassified|residential|service|tertiary)$/.test(tags.highway ?? "")) return "roads";
    if (/^(river|stream|canal)$/.test(tags.waterway ?? "") || tags.natural === "water") return "water";
    return null;
  }
  if (type === "node") {
    if (tags.amenity === "shelter" || tags.tourism === "wilderness_hut" || tags.tourism === "alpine_hut") {
      return "shelters";
    }
    if (tags.tourism === "camp_site") return "campsites";
    if (tags.natural === "peak" || tags.information === "guidepost" || tags.tourism === "viewpoint") {
      return "landmarks";
    }
  }
  return null;
}

function safeName(tags?: Record<string, string>): string | undefined {
  const raw = tags?.name;
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || undefined;
}

function finitePosition(lng: number, lat: number): GeoJSON.Position | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return null;
  }
  return [lng, lat];
}

function simplifyLine(coordinates: GeoJSON.Position[]): GeoJSON.Position[] {
  if (coordinates.length <= MAX_CORRIDOR_LINE_POINTS) return coordinates;
  const last = MAX_CORRIDOR_LINE_POINTS - 1;
  const step = (coordinates.length - 1) / last;
  const sampled: GeoJSON.Position[] = [];
  for (let index = 0; index < last; index += 1) {
    sampled.push(coordinates[Math.round(index * step)]);
  }
  sampled.push(coordinates[coordinates.length - 1]);
  return sampled;
}

export function buildCorridorOverpassQuery(bboxes: BboxLngLat[]): string {
  const clauses = bboxes.flatMap((bbox) => {
    const [south, west, north, east] = toSouthWestNorthEast(bbox).map((value) => value.toFixed(5));
    const box = `${south},${west},${north},${east}`;
    return [
      `way["highway"~"^(path|footway|steps|bridleway)$"](${box});`,
      `way["highway"~"^(track|unclassified|residential|service|tertiary)$"](${box});`,
      `way["waterway"~"^(river|stream|canal)$"](${box});`,
      `way["natural"="water"](${box});`,
      `node["amenity"="shelter"](${box});`,
      `node["tourism"~"^(wilderness_hut|alpine_hut|camp_site)$"](${box});`,
      `node["natural"="peak"](${box});`,
      `node["information"="guidepost"](${box});`,
      `node["tourism"="viewpoint"](${box});`,
    ];
  });
  return `[out:json][timeout:20];
(
  ${clauses.join("\n  ")}
);
out geom;`;
}

export function parseCorridorOverpassResponse(input: {
  routeId: string;
  bboxes: BboxLngLat[];
  elements: OverpassElement[];
  fetchedAt?: string;
}): CorridorFeatureSet {
  const counts = Object.fromEntries(VECTOR_CORRIDOR_LAYERS.map((layer) => [layer, 0])) as Record<
    CorridorFeatureLayer,
    number
  >;
  const features: GeoJSON.Feature<GeoJSON.Point | GeoJSON.LineString, CorridorFeatureProperties>[] = [];

  for (const element of input.elements) {
    const layer = classifyLayer(element.tags, element.type);
    if (!layer || features.length >= MAX_CORRIDOR_FEATURES || counts[layer] >= PER_LAYER_CAP[layer]) continue;

    let geometry: GeoJSON.Point | GeoJSON.LineString | null = null;
    if (element.type === "node" && element.lat != null && element.lon != null) {
      const position = finitePosition(element.lon, element.lat);
      if (position) geometry = { type: "Point", coordinates: position };
    } else if (element.type === "way" && element.geometry?.length) {
      const coordinates = element.geometry
        .map((point) => finitePosition(point.lon, point.lat))
        .filter((position): position is GeoJSON.Position => position !== null);
      if (coordinates.length >= 2) {
        geometry = { type: "LineString", coordinates: simplifyLine(coordinates) };
      }
    }
    if (!geometry) continue;

    features.push({
      type: "Feature",
      geometry,
      properties: {
        layer,
        name: safeName(element.tags),
        osmId: String(element.id),
        osmType: element.type === "relation" ? undefined : element.type,
      },
    });
    counts[layer] += 1;
  }

  const layersIncluded = VECTOR_CORRIDOR_LAYERS.filter((layer) => counts[layer] > 0);
  return {
    routeId: input.routeId,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    source: CORRIDOR_FEATURES_SOURCE,
    bboxes: input.bboxes,
    layersIncluded,
    featureCount: features.length,
    disclaimer: CORRIDOR_FEATURE_DISCLAIMER,
    features: { type: "FeatureCollection", features },
  };
}

export async function fetchCorridorFeatureSet(
  routeId: string,
  bboxes: BboxLngLat[],
): Promise<{ features: CorridorFeatureSet | null; reason?: string }> {
  const allowed = corridorQueryAllowed(bboxes);
  if (!allowed.ok) return { features: null, reason: allowed.reason };
  try {
    const data = await runOverpass(buildCorridorOverpassQuery(bboxes), 8_000);
    return { features: parseCorridorOverpassResponse({ routeId, bboxes, elements: data.elements ?? [] }) };
  } catch (error) {
    return {
      features: null,
      reason: error instanceof Error ? error.message : "OpenStreetMap corridor lookup failed.",
    };
  }
}
