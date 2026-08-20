import { toSouthWestNorthEast, type BboxLngLat } from "@/lib/geo/bbox";

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  members?: Array<{
    type: string;
    ref: number;
    role: string;
  }>;
  geometry?: Array<{ lat: number; lon: number }>;
}

export interface OverpassResponse {
  elements: OverpassElement[];
}

export interface TrailSearchResult {
  osmId: string;
  osmType: string;
  name: string;
  center: { lat: number; lng: number };
  lengthMeters?: number;
  difficulty?: string;
  sacScale?: string;
  network?: string;
  wikipediaUrl?: string;
  tags?: Record<string, string>;
}

export interface TrailDetail extends TrailSearchResult {
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox: [number, number, number, number];
  elevationGainMeters?: number;
}

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const OVERPASS_CACHE_TTL_MS = 60 * 60 * 1000;
const overpassCache = new Map<string, { expiresAt: number; data: OverpassResponse }>();

async function runOverpass(query: string): Promise<OverpassResponse> {
  const cached = overpassCache.get(query);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) overpassCache.delete(query);

  let lastError: Error | null = null;
  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "HikeApp/1.0 (bespoke hiking planner)",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) {
        lastError = new Error(`Overpass API error: ${response.status}`);
        continue;
      }
      const data = await response.json() as OverpassResponse;
      overpassCache.set(query, { expiresAt: Date.now() + OVERPASS_CACHE_TTL_MS, data });
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Overpass request failed");
    }
  }
  throw lastError ?? new Error("Overpass API unavailable");
}

/** Escapes an untrusted literal before embedding it in an Overpass regular expression. */
export function escapeOverpassRegex(value: string): string {
  return value
    .slice(0, 64)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[.^$*+?()[\]{}|]/g, "\\$&");
}

function getCenter(element: OverpassElement): { lat: number; lng: number } | null {
  if (element.lat != null && element.lon != null) {
    return { lat: element.lat, lng: element.lon };
  }
  if (element.center) {
    return { lat: element.center.lat, lng: element.center.lon };
  }
  if (element.geometry?.length) {
    const mid = element.geometry[Math.floor(element.geometry.length / 2)];
    return { lat: mid.lat, lng: mid.lon };
  }
  return null;
}

function parseLength(tags?: Record<string, string>): number | undefined {
  if (!tags?.distance) return undefined;
  const match = tags.distance.match(/([\d.]+)\s*(km|mi|m)?/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  const unit = (match[2] || "m").toLowerCase();
  if (unit === "km") return value * 1000;
  if (unit === "mi") return value * 1609.34;
  return value;
}

function toWikipediaUrl(tags?: Record<string, string>): string | undefined {
  const wiki = tags?.wikipedia || tags?.wikidata;
  if (!wiki) return undefined;
  if (wiki.startsWith("http")) return wiki;
  if (wiki.includes(":")) {
    const [lang, title] = wiki.split(":");
    return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  }
  return undefined;
}

export async function searchTrails(
  query: string,
  bbox?: BboxLngLat,
): Promise<TrailSearchResult[]> {
  const escaped = escapeOverpassRegex(query);
  const bboxFilter = bbox ? `(${toSouthWestNorthEast(bbox).join(",")})` : "";
  const overpassQuery = `
    [out:json][timeout:30];
    (
      relation["route"="hiking"]["name"~"${escaped}",i]${bboxFilter};
      relation["route"="foot"]["name"~"${escaped}",i]${bboxFilter};
    );
    out center tags;
  `;
  const data = await runOverpass(overpassQuery);
  const results: TrailSearchResult[] = [];
  for (const element of data.elements) {
    if (element.type !== "relation" || !element.tags?.name) continue;
    const center = getCenter(element);
    if (!center) continue;
    results.push({
      osmId: String(element.id), osmType: "relation", name: element.tags.name, center,
      lengthMeters: parseLength(element.tags), difficulty: element.tags.difficulty,
      sacScale: element.tags.sac_scale, network: element.tags.network,
      wikipediaUrl: toWikipediaUrl(element.tags), tags: element.tags,
    });
  }
  return results.slice(0, 25);
}

function endpointDistanceMeters(a: GeoJSON.Position, b: GeoJSON.Position): number {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const latA = toRadians(a[1]);
  const latB = toRadians(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function endpointsMatch(a: GeoJSON.Position, b: GeoJSON.Position): boolean {
  return endpointDistanceMeters(a, b) <= 25;
}

/** Greedily joins relation member ways at matching endpoints, reversing ways when needed. */
export function stitchRelationWays(lines: GeoJSON.Position[][]): GeoJSON.Position[][] {
  const remaining = lines.filter((line) => line.length >= 2).map((line) => [...line]);
  const chains: GeoJSON.Position[][] = [];
  while (remaining.length > 0) {
    let chain = remaining.shift()!;
    let joined = true;
    while (joined) {
      joined = false;
      for (let index = 0; index < remaining.length; index++) {
        const candidate = remaining[index];
        const first = chain[0];
        const last = chain[chain.length - 1];
        const candidateFirst = candidate[0];
        const candidateLast = candidate[candidate.length - 1];
        if (endpointsMatch(last, candidateFirst)) {
          chain = [...chain, ...candidate.slice(1)];
        } else if (endpointsMatch(last, candidateLast)) {
          chain = [...chain, ...candidate.slice(0, -1).reverse()];
        } else if (endpointsMatch(first, candidateLast)) {
          chain = [...candidate.slice(0, -1), ...chain];
        } else if (endpointsMatch(first, candidateFirst)) {
          chain = [...candidate.slice(1).reverse(), ...chain];
        } else {
          continue;
        }
        remaining.splice(index, 1);
        joined = true;
        break;
      }
    }
    const first = chain[0];
    const last = chain[chain.length - 1];
    if (first[0] > last[0] || (first[0] === last[0] && first[1] > last[1])) chain = [...chain].reverse();
    chains.push(chain);
  }
  return chains;
}

export function relationToLineString(elements: OverpassElement[]): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  const lines = elements
    .filter((element) => element.type === "way" && element.geometry && element.geometry.length >= 2)
    .map((way) => way.geometry!.map((point) => [point.lon, point.lat] as GeoJSON.Position));
  if (!lines.length) return null;
  const chains = stitchRelationWays(lines);
  return chains.length === 1
    ? { type: "LineString", coordinates: chains[0] }
    : { type: "MultiLineString", coordinates: chains };
}

function computeBbox(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): [number, number, number, number] {
  const coords =
    geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.coordinates.flat();

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLng, minLat, maxLng, maxLat];
}

export async function getTrailDetail(
  osmId: string,
  osmType: string = "relation",
): Promise<TrailDetail | null> {
  const overpassQuery = `
    [out:json][timeout:45];
    ${osmType}(${osmId});
    out body;
    >;
    out geom;
  `;

  const data = await runOverpass(overpassQuery);
  const relation = data.elements.find(
    (e) => e.type === osmType && String(e.id) === osmId,
  );

  if (!relation?.tags?.name) return null;

  const geometry = relationToLineString(data.elements);
  if (!geometry) return null;

  const center = getCenter(relation);
  if (!center) return null;

  return {
    osmId,
    osmType,
    name: relation.tags.name,
    center,
    geometry,
    bbox: computeBbox(geometry),
    lengthMeters: parseLength(relation.tags),
    difficulty: relation.tags.difficulty,
    sacScale: relation.tags.sac_scale,
    network: relation.tags.network,
    wikipediaUrl: toWikipediaUrl(relation.tags),
    tags: relation.tags,
  };
}

export async function searchBackcountryCamps(
  bbox: [number, number, number, number],
): Promise<
  Array<{
    osmId: string;
    name: string;
    lat: number;
    lng: number;
    backcountry: boolean;
    tags: Record<string, string>;
  }>
> {
  const [south, west, north, east] = bbox;
  const overpassQuery = `
    [out:json][timeout:30];
    (
      node["tourism"="camp_site"](${south},${west},${north},${east});
      node["tourism"="wilderness_hut"](${south},${west},${north},${east});
    );
    out body;
  `;

  const data = await runOverpass(overpassQuery);
  return data.elements
    .filter((e) => e.type === "node" && e.lat != null && e.lon != null)
    .map((e) => ({
      osmId: String(e.id),
      name: e.tags?.name || "Unnamed campsite",
      lat: e.lat!,
      lng: e.lon!,
      backcountry: e.tags?.backcountry === "yes" || e.tags?.access === "private",
      tags: e.tags || {},
    }));
}
