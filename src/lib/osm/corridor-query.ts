import type { CorridorLine, CorridorPoint } from "@/lib/offline/corridor";
import type { OverpassElement, OverpassResponse } from "@/lib/osm/overpass";

/**
 * Overpass query and parser for offline corridor context.
 *
 * Kept separate from trail search because the intent is different: search finds a
 * route the hiker chose, this finds the things that matter when the chosen route
 * stops working -- a road to walk out on, water, a structure to shelter in.
 */

/**
 * Buildings are queried by shelter tag, not en masse.
 *
 * Measured against Yosemite Valley, a plain `way["building"]` clause returned
 * 1,193 of 1,881 features -- 63% of the corridor -- for a 5 km box. Generic
 * buildings are the lowest-value features here and would crowd roads, water and
 * huts out of the storage caps in exactly the developed areas where a hiker has
 * other options anyway. Structures that actually matter when it gets dark are
 * tagged as shelters, huts or campsites, and those are requested as both nodes
 * and ways so a hut mapped as a polygon is not missed.
 */

/** Bounded so a mistyped bbox cannot ask Overpass for a continent. */
export const MAX_CORRIDOR_QUERY_DEGREES = 2;

export function corridorQuery(bbox: [number, number, number, number]): string {
  const [west, south, east, north] = bbox;
  // Overpass takes south,west,north,east.
  const area = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
  // Timeout and maxsize are declared to Overpass so it refuses a runaway query
  // server-side rather than us waiting on one.
  return `[out:json][timeout:25][maxsize:67108864];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service)$"](${area});
  way["highway"~"^(track|path|footway|bridleway|cycleway)$"](${area});
  way["waterway"~"^(river|stream|canal)$"](${area});
  way["natural"="water"](${area});
  node["amenity"="shelter"](${area});
  node["tourism"~"^(alpine_hut|wilderness_hut|camp_site|caravan_site)$"](${area});
  node["amenity"="drinking_water"](${area});
  node["natural"="spring"](${area});
  node["man_made"="water_well"](${area});
  way["amenity"="shelter"](${area});
  way["tourism"~"^(alpine_hut|wilderness_hut|camp_site)$"](${area});
);
out geom qt;`;
}

export function corridorBboxDegreesExceeded(bbox: [number, number, number, number]): boolean {
  return (
    Math.abs(bbox[2] - bbox[0]) > MAX_CORRIDOR_QUERY_DEGREES ||
    Math.abs(bbox[3] - bbox[1]) > MAX_CORRIDOR_QUERY_DEGREES
  );
}

function tagOf(element: OverpassElement, key: string): string | undefined {
  const tags = element.tags as Record<string, string> | undefined;
  const value = tags?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Classifies an OSM way into the corridor's escape-value ordering.
 *
 * Roads and tracks are separated from trails because their usefulness differs
 * when things go wrong: a road may carry vehicles and phone coverage, a trail
 * usually carries neither.
 */
function lineKindFor(element: OverpassElement): CorridorLine["kind"] | null {
  const highway = tagOf(element, "highway");
  if (highway) {
    if (/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service)$/.test(highway)) return "road";
    if (highway === "track") return "track";
    return "trail";
  }
  if (tagOf(element, "waterway") || tagOf(element, "natural") === "water") return "water";
  if (tagOf(element, "barrier")) return "barrier";
  if (tagOf(element, "building")) return null; // handled as a point
  return null;
}

function pointKindFor(element: OverpassElement): CorridorPoint["kind"] | null {
  const amenity = tagOf(element, "amenity");
  const tourism = tagOf(element, "tourism");
  if (amenity === "shelter" || tourism === "alpine_hut" || tourism === "wilderness_hut") return "shelter";
  if (tourism === "camp_site" || tourism === "caravan_site") return "campsite";
  if (amenity === "drinking_water" || tagOf(element, "natural") === "spring" || tagOf(element, "man_made") === "water_well") {
    return "water";
  }
  if (tagOf(element, "building")) return "building";
  return null;
}

function geometryPositions(element: OverpassElement): GeoJSON.Position[] {
  const geometry = (element as { geometry?: Array<{ lat?: unknown; lon?: unknown }> }).geometry;
  if (!Array.isArray(geometry)) return [];
  const positions: GeoJSON.Position[] = [];
  for (const node of geometry) {
    // Overpass omits nodes outside the query area rather than nulling them, so a
    // gap here is expected and must not be interpolated across.
    if (Number.isFinite(node?.lat) && Number.isFinite(node?.lon)) {
      positions.push([Number(node.lon), Number(node.lat)]);
    }
  }
  return positions;
}

function centroid(positions: GeoJSON.Position[]): { lat: number; lng: number } | null {
  if (positions.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const position of positions) {
    lng += Number(position[0]);
    lat += Number(position[1]);
  }
  const count = positions.length;
  const result = { lat: lat / count, lng: lng / count };
  return Number.isFinite(result.lat) && Number.isFinite(result.lng) ? result : null;
}

export function parseCorridorResponse(response: OverpassResponse | null | undefined): {
  lines: CorridorLine[];
  points: CorridorPoint[];
} {
  const elements = Array.isArray(response?.elements) ? response.elements : [];
  const lines: CorridorLine[] = [];
  const points: CorridorPoint[] = [];

  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const name = tagOf(element, "name");

    if (element.type === "node") {
      const kind = pointKindFor(element);
      if (!kind) continue;
      if (!Number.isFinite(element.lat) || !Number.isFinite(element.lon)) continue;
      points.push({ kind, name, lat: Number(element.lat), lng: Number(element.lon) });
      continue;
    }

    if (element.type !== "way") continue;
    const positions = geometryPositions(element);

    // A building is stored as a single point. Its footprint is not navigational
    // detail, but "there is a structure here" is exactly what matters at night.
    if (tagOf(element, "building")) {
      const center = centroid(positions);
      if (center) points.push({ kind: "building", name, lat: center.lat, lng: center.lng });
      continue;
    }

    const kind = lineKindFor(element);
    if (!kind || positions.length < 2) continue;
    lines.push({ kind, name, positions });
  }

  return { lines, points };
}
