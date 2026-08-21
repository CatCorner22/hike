import { toSouthWestNorthEast, type BboxLngLat } from "@/lib/geo/bbox";
import { bboxFromGeometry } from "@/lib/geo";
import { fetchWithTimeout, readJsonCapped } from "@/lib/api/outbound";

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
  for (const [attempt, url] of OVERPASS_URLS.entries()) {
    // One bounded retry on an independent mirror. The short backoff avoids a
    // tight failure loop while retaining a firm ~5 s worst-case fetch budget.
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Klandagi/1.0 (wilderness navigation app)",
        },
        body: `data=${encodeURIComponent(query)}`,
      }, 2_500);
      if (!response.ok) {
        lastError = new Error(`Overpass API error: ${response.status}`);
        continue;
      }
      const data = await readJsonCapped<OverpassResponse>(response);
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
  const dLat = toRadians(Number(b[1]) - Number(a[1]));
  const dLng = toRadians(Number(b[0]) - Number(a[0]));
  const latA = toRadians(Number(a[1]));
  const latB = toRadians(Number(b[1]));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function wayPositions(way: OverpassElement): GeoJSON.Position[] {
  const positions = (way.geometry || []).map((point) => [point.lon, point.lat] as GeoJSON.Position);
  return positions.length >= 2 &&
    positions.every(
      (position) =>
        Number.isFinite(position[0]) &&
        Number.isFinite(position[1]) &&
        position[0] >= -180 &&
        position[0] <= 180 &&
        position[1] >= -90 &&
        position[1] <= 90,
    )
    ? positions
    : [];
}

function endpointsMatch(a: GeoJSON.Position, b: GeoJSON.Position): boolean {
  return endpointDistanceMeters(a, b) <= 25;
}

// 0.0002° is roughly 22m at the equator. Neighbour lookup plus the exact
// distance check handles latitude and tolerance boundaries without scanning all
// unjoined ways.
const ENDPOINT_CELL_DEGREES = 0.0002;
function endpointCell(position: GeoJSON.Position): [number, number] {
  return [Math.floor(Number(position[0]) / ENDPOINT_CELL_DEGREES), Math.floor(Number(position[1]) / ENDPOINT_CELL_DEGREES)];
}
function endpointCellKey(x: number, y: number): string { return `${x}:${y}`; }

/** Near-linear relation stitching with a tolerance-aware endpoint index. */
export function stitchRelationWays(lines: GeoJSON.Position[][]): GeoJSON.Position[][] {
  const ways = lines.filter((line) => line.length >= 2).map((line) => [...line]);
  const active = new Set(ways.map((_, index) => index));
  const endpointIndex = new Map<string, Set<number>>();
  const addEndpoint = (position: GeoJSON.Position, index: number) => {
    const [x, y] = endpointCell(position);
    const key = endpointCellKey(x, y);
    const entries = endpointIndex.get(key) ?? new Set<number>();
    entries.add(index);
    endpointIndex.set(key, entries);
  };
  const removeWay = (index: number) => {
    if (!active.delete(index)) return;
    const way = ways[index];
    for (const endpoint of [way[0], way[way.length - 1]]) {
      const [x, y] = endpointCell(endpoint);
      const entries = endpointIndex.get(endpointCellKey(x, y));
      entries?.delete(index);
      if (entries?.size === 0) endpointIndex.delete(endpointCellKey(x, y));
    }
  };
  ways.forEach((way, index) => { addEndpoint(way[0], index); addEndpoint(way[way.length - 1], index); });
  const findCandidate = (endpoint: GeoJSON.Position): number | null => {
    const [x, y] = endpointCell(endpoint);
    let found: number | null = null;
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      const entries = endpointIndex.get(endpointCellKey(x + dx, y + dy));
      if (!entries) continue;
      for (const index of entries) {
        const way = ways[index];
        if (endpointsMatch(endpoint, way[0]) || endpointsMatch(endpoint, way[way.length - 1])) {
          if (found == null || index < found) found = index;
        }
      }
    }
    return found;
  };

  const chains: GeoJSON.Position[][] = [];
  for (let seed = 0; seed < ways.length; seed += 1) {
    if (!active.has(seed)) continue;
    let chain = [...ways[seed]];
    removeWay(seed);
    for (;;) {
      const tail = findCandidate(chain[chain.length - 1]);
      if (tail != null) {
        const candidate = ways[tail];
        const last = chain[chain.length - 1];
        chain = endpointsMatch(last, candidate[0])
          ? [...chain, ...candidate.slice(1)]
          : [...chain, ...candidate.slice(0, -1).reverse()];
        removeWay(tail);
        continue;
      }
      const head = findCandidate(chain[0]);
      if (head != null) {
        const candidate = ways[head];
        const first = chain[0];
        chain = endpointsMatch(first, candidate[candidate.length - 1])
          ? [...candidate.slice(0, -1), ...chain]
          : [...candidate.slice(1).reverse(), ...chain];
        removeWay(head);
        continue;
      }
      break;
    }
    const first = chain[0];
    const last = chain[chain.length - 1];
    if (Number(first[0]) > Number(last[0]) || (first[0] === last[0] && Number(first[1]) > Number(last[1]))) chain.reverse();
    chains.push(chain);
  }
  return chains;
}

export function relationToLineString(elements: OverpassElement[]): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  const relation = elements.find((element) => element.type === "relation");
  const waysById = new Map(
    elements
      .filter((element) => element.type === "way")
      .map((way) => [way.id, way]),
  );
  const memberWays = relation?.members?.filter((member) => member.type === "way") ?? [];
  const lines = memberWays.length > 0
    ? memberWays.flatMap((member) => {
      const way = waysById.get(member.ref);
      if (!way) return [];
      const positions = wayPositions(way);
      if (positions.length < 2) return [];
      return [member.role === "backward" ? [...positions].reverse() : positions];
    })
    : [...waysById.values()].map(wayPositions).filter((positions) => positions.length >= 2);
  if (!lines.length) return null;
  const chains = stitchRelationWays(lines);
  return chains.length === 1
    ? { type: "LineString", coordinates: chains[0] }
    : { type: "MultiLineString", coordinates: chains };
}

function computeBbox(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): [number, number, number, number] {
  const bbox = bboxFromGeometry(geometry, 0);
  // The geometry has passed OSM position validation; do not persist Infinity
  // values if an upstream response nevertheless becomes malformed.
  return bbox ?? [0, 0, 0, 0];
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
