import { fetchWithTimeout, readJsonCapped } from "@/lib/api/outbound";
import { isUsCoverageCoordinate } from "@/lib/camping/us-coverage";
import type { BboxLngLat } from "@/lib/geo/bbox";

const DEFAULT_GEOCODER = "https://nominatim.openstreetmap.org";
const PUBLIC_GEOCODER_INTERVAL_MS = 1_100;

interface NominatimResult {
  place_id?: number;
  display_name?: string;
  lat?: string;
  lon?: string;
  boundingbox?: [string, string, string, string];
  type?: string;
}

export interface PlaceSearchResult {
  id: string;
  name: string;
  center: { lat: number; lng: number };
  bbox: BboxLngLat;
  type?: string;
  provider: "openstreetmap-nominatim";
}

let geocoderQueue: Promise<void> = Promise.resolve();
let nextPublicRequestAt = 0;

function configuredBaseUrl(): URL | null {
  try {
    const url = new URL(process.env.GEOCODER_BASE_URL || DEFAULT_GEOCODER);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

async function waitForPublicSlot(): Promise<void> {
  const prior = geocoderQueue;
  let release!: () => void;
  geocoderQueue = new Promise<void>((resolve) => { release = resolve; });
  await prior;
  const delay = Math.max(0, nextPublicRequestAt - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  nextPublicRequestAt = Date.now() + PUBLIC_GEOCODER_INTERVAL_MS;
  release();
}

/**
 * Converts Nominatim's [south,north,west,east] box into a bounded trail-search
 * window. Large administrative regions are centered and capped so one place
 * lookup cannot create a continent-scale Overpass query.
 */
export function boundedPlaceBbox(
  raw: NominatimResult["boundingbox"],
  lat: number,
  lng: number,
): BboxLngLat | null {
  if (!isUsCoverageCoordinate(lat, lng)) return null;
  const parsed = raw?.map(Number);
  const [rawSouth, rawNorth, rawWest, rawEast] = parsed?.length === 4 && parsed.every(Number.isFinite)
    ? parsed
    : [lat - 0.35, lat + 0.35, lng - 0.35, lng + 0.35];
  if (rawSouth >= rawNorth || rawWest >= rawEast) return null;
  const halfLat = Math.min(0.75, Math.max(0.1, (rawNorth - rawSouth) / 2));
  const halfLng = Math.min(1, Math.max(0.1, (rawEast - rawWest) / 2));
  const west = Math.max(-180, lng - halfLng);
  const east = Math.min(180, lng + halfLng);
  const south = Math.max(-90, lat - halfLat);
  const north = Math.min(90, lat + halfLat);
  return west < east && south < north ? [west, south, east, north] : null;
}

export async function searchUsPlaces(query: string): Promise<PlaceSearchResult[]> {
  const normalized = query.trim();
  if (normalized.length < 2 || normalized.length > 96) return [];
  const base = configuredBaseUrl();
  if (!base) return [];
  const baseWithSlash = new URL(base.toString());
  if (!baseWithSlash.pathname.endsWith("/")) baseWithSlash.pathname += "/";
  const url = new URL("search", baseWithSlash);
  url.searchParams.set("q", normalized);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "3");
  url.searchParams.set("countrycodes", "us,pr,vi,gu,as,mp");
  url.searchParams.set("addressdetails", "0");
  await waitForPublicSlot();
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.8",
      "User-Agent": "Klandagi-Hiking-App/1.0 (+https://github.com/CatCorner22/hike)",
      Referer: "https://github.com/CatCorner22/hike",
    },
    next: { revalidate: 60 * 60 * 24 * 30 },
  }, 6_000);
  if (!response.ok) return [];
  const rows = await readJsonCapped<NominatimResult[]>(response, 256 * 1024);
  return rows.flatMap((row) => {
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    const bbox = boundedPlaceBbox(row.boundingbox, lat, lng);
    if (!bbox || !row.display_name) return [];
    return [{
      id: String(row.place_id ?? `${lat},${lng}`),
      name: row.display_name.slice(0, 240),
      center: { lat, lng },
      bbox,
      type: row.type,
      provider: "openstreetmap-nominatim" as const,
    }];
  });
}

export function __resetGeocoderQueueForTests(): void {
  geocoderQueue = Promise.resolve();
  nextPublicRequestAt = 0;
}
