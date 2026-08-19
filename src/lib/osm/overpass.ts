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

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

async function runOverpass(query: string): Promise<OverpassResponse> {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "HikeApp/1.0 (bespoke hiking planner)",
    },
    body: `data=${encodeURIComponent(query)}`,
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  return response.json();
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
  bbox?: [number, number, number, number],
): Promise<TrailSearchResult[]> {
  const escaped = query.replace(/"/g, '\\"');
  const bboxFilter = bbox
    ? `(${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]})`
    : "";

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
      osmId: String(element.id),
      osmType: "relation",
      name: element.tags.name,
      center,
      lengthMeters: parseLength(element.tags),
      difficulty: element.tags.difficulty,
      sacScale: element.tags.sac_scale,
      network: element.tags.network,
      wikipediaUrl: toWikipediaUrl(element.tags),
      tags: element.tags,
    });
  }

  return results.slice(0, 25);
}

export async function searchTrailsByBbox(
  bbox: [number, number, number, number],
): Promise<TrailSearchResult[]> {
  const [south, west, north, east] = bbox;
  const overpassQuery = `
    [out:json][timeout:30];
    (
      relation["route"="hiking"](${south},${west},${north},${east});
      relation["route"="foot"](${south},${west},${north},${east});
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
      osmId: String(element.id),
      osmType: "relation",
      name: element.tags.name,
      center,
      lengthMeters: parseLength(element.tags),
      difficulty: element.tags.difficulty,
      sacScale: element.tags.sac_scale,
      network: element.tags.network,
      wikipediaUrl: toWikipediaUrl(element.tags),
      tags: element.tags,
    });
  }

  return results;
}

function relationToLineString(elements: OverpassElement[]): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  const relation = elements.find((e) => e.type === "relation");
  const ways = elements.filter((e) => e.type === "way" && e.geometry?.length);

  if (!ways.length) return null;

  const lines: GeoJSON.Position[][] = ways.map((way) =>
    (way.geometry || []).map((p) => [p.lon, p.lat]),
  );

  if (lines.length === 1) {
    return { type: "LineString", coordinates: lines[0] };
  }

  return { type: "MultiLineString", coordinates: lines };
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
