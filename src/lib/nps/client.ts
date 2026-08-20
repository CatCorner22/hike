import { fetchWithTimeout } from "@/lib/api/outbound";
const NPS_BASE = "https://developer.nps.gov/api/v1";

function getApiKey() {
  const key = process.env.NPS_API_KEY;
  if (!key) return null;
  return key;
}

async function npsFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const url = new URL(`${NPS_BASE}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), {
    next: { revalidate: 86400 },
    }, 5_000);
  } catch {
    return null;
  }

  if (!response.ok) return null;
  return response.json();
}

export interface NpsCampground {
  id: string;
  name: string;
  parkCode: string;
  description: string;
  latitude: string;
  longitude: string;
  reservationInfo: string;
  regulationsurl: string;
  fees: Array<{ cost: string; description: string }>;
  campsites: Record<string, unknown>;
  amenities: Record<string, unknown>;
  url: string;
}

export interface NpsPark {
  fullName: string;
  parkCode: string;
  states: string;
  description: string;
  latitude: string;
  longitude: string;
}

export interface NpsAlert {
  title: string;
  description: string;
  category: string;
  url: string;
}

export interface NpsArticle {
  title: string;
  abstract: string;
  url: string;
  tags: string[];
}

export async function searchCampgrounds(params: {
  parkCode?: string;
  stateCode?: string;
  q?: string;
  limit?: number;
}): Promise<NpsCampground[]> {
  const data = await npsFetch<{ data: NpsCampground[] }>("/campgrounds", {
    limit: String(params.limit ?? 50),
    ...(params.parkCode ? { parkCode: params.parkCode } : {}),
    ...(params.stateCode ? { stateCode: params.stateCode } : {}),
    ...(params.q ? { q: params.q } : {}),
  });
  return data?.data ?? [];
}

export async function getPark(parkCode: string): Promise<NpsPark | null> {
  const data = await npsFetch<{ data: NpsPark[] }>("/parks", {
    parkCode,
    limit: "1",
  });
  return data?.data?.[0] ?? null;
}

export async function getParkAlerts(parkCode: string): Promise<NpsAlert[]> {
  const data = await npsFetch<{ data: NpsAlert[] }>("/alerts", {
    parkCode,
    limit: "20",
  });
  return data?.data ?? [];
}

export async function searchArticles(query: string, parkCode?: string): Promise<NpsArticle[]> {
  const data = await npsFetch<{ data: NpsArticle[] }>("/articles", {
    q: query,
    limit: "10",
    ...(parkCode ? { parkCode } : {}),
  });
  return data?.data ?? [];
}

export async function getResearchContext(trailName: string, parkCode?: string) {
  const [articles, alerts] = await Promise.all([
    searchArticles(trailName, parkCode),
    parkCode ? getParkAlerts(parkCode) : Promise.resolve([]),
  ]);

  return {
    articles: articles.map((a) => ({
      title: a.title,
      content: a.abstract,
      url: a.url,
    })),
    alerts: alerts.map((a) => ({
      title: a.title,
      content: a.description,
      url: a.url,
    })),
  };
}

export function npsCampgroundToRecord(camp: NpsCampground) {
  const lat = parseFloat(camp.latitude);
  const lng = parseFloat(camp.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  const amenities = camp.amenities || {};
  const hasTent = Object.keys(amenities).some((k) =>
    k.toLowerCase().includes("tent"),
  );

  return {
    externalId: `nps-${camp.id}`,
    name: camp.name,
    latitude: lat,
    longitude: lng,
    state: null as string | null,
    parkCode: camp.parkCode,
    parkName: null as string | null,
    source: "nps" as const,
    campingType: hasTent ? ("developed_tent" as const) : ("rv" as const),
    description: camp.description?.replace(/<[^>]+>/g, " ").slice(0, 2000),
    amenities,
    reservationUrl: camp.url,
    permitRequired: false,
    fees: camp.fees,
    metadata: {
      reservationInfo: camp.reservationInfo,
      regulationsurl: camp.regulationsurl,
      campsites: camp.campsites,
    },
  };
}
