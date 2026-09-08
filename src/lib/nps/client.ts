import { fetchWithTimeout, readJsonCapped } from "@/lib/api/outbound";
import { permitRequiredCompatibility } from "@/lib/camping/evidence";
import { normalizeNpsParkCode } from "@/lib/nps/park-code";
export { normalizeNpsParkCode, npsParkCodeFromTags } from "@/lib/nps/park-code";
const NPS_BASE = "https://developer.nps.gov/api/v1";

type NpsFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_configured" | "unavailable" };

function getApiKey() {
  const key = process.env.NPS_API_KEY;
  if (!key) return null;
  return key;
}

async function npsFetchResult<T>(path: string, params: Record<string, string> = {}): Promise<NpsFetchResult<T>> {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, reason: "not_configured" };

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
    return { ok: false, reason: "unavailable" };
  }

  if (!response.ok) return { ok: false, reason: "unavailable" };
  try {
    return { ok: true, data: await readJsonCapped<T>(response) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

async function npsFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const result = await npsFetchResult<T>(path, params);
  return result.ok ? result.data : null;
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

export type VerifiedParkAlertSnapshot =
  | {
      status: "checked";
      detail: string;
      parkCode: string;
      parkName: string;
      alerts: NpsAlert[];
    }
  | {
      status: "not_applicable" | "not_configured" | "unavailable";
      detail: string;
      parkCode?: string;
      parkName?: string;
      alerts: [];
    };

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

/**
 * Fetches park notices only after the NPS parks endpoint proves that an exact,
 * explicitly supplied unit code exists. It keeps "no alerts" separate from
 * "the source could not be checked" so an outage cannot look like an all-clear.
 */
export async function getVerifiedParkAlertSnapshot(
  parkCode: string | null | undefined,
): Promise<VerifiedParkAlertSnapshot> {
  const proposedCode = normalizeNpsParkCode(parkCode);
  if (!proposedCode) {
    return {
      status: "not_applicable",
      detail: "NPS notices were not checked because this route has no verified NPS unit code.",
      alerts: [],
    };
  }
  const parkResult = await npsFetchResult<{ data: NpsPark[] }>("/parks", {
    parkCode: proposedCode,
    limit: "1",
  });
  if (!parkResult.ok) {
    return {
      status: parkResult.reason,
      detail: parkResult.reason === "not_configured"
        ? "NPS notices were not checked because NPS_API_KEY is not configured."
        : "NPS could not verify the supplied unit code.",
      parkCode: proposedCode,
      alerts: [],
    };
  }
  const park = parkResult.data.data?.[0];
  if (normalizeNpsParkCode(park?.parkCode) !== proposedCode) {
    return {
      status: "unavailable",
      detail: "NPS did not verify the supplied unit code, so park notices were not requested.",
      parkCode: proposedCode,
      alerts: [],
    };
  }
  const alertResult = await npsFetchResult<{ data: NpsAlert[] }>("/alerts", {
    parkCode: proposedCode,
    limit: "20",
  });
  if (!alertResult.ok) {
    return {
      status: alertResult.reason,
      detail: alertResult.reason === "not_configured"
        ? "NPS notices were not checked because NPS_API_KEY is not configured."
        : `NPS verified ${park.fullName}, but its notice feed could not be checked.`,
      parkCode: proposedCode,
      parkName: park.fullName,
      alerts: [],
    };
  }
  return {
    status: "checked",
    detail: `NPS notices checked for ${park.fullName} (${proposedCode}).`,
    parkCode: proposedCode,
    parkName: park.fullName,
    alerts: Array.isArray(alertResult.data.data) ? alertResult.data.data.slice(0, 20) : [],
  };
}

export async function getResearchContext(trailName: string, parkCode?: string) {
  const proposedCode = normalizeNpsParkCode(parkCode);
  const proposedPark = proposedCode ? await getPark(proposedCode) : null;
  const returnedCode = normalizeNpsParkCode(proposedPark?.parkCode);
  const verifiedCode: string | undefined = proposedCode && returnedCode === proposedCode
    ? proposedCode
    : undefined;
  const verifiedPark = verifiedCode ? proposedPark : null;

  const [articles, alerts] = await Promise.all([
    searchArticles(trailName, verifiedCode),
    verifiedCode ? getParkAlerts(verifiedCode) : Promise.resolve([]),
  ]);

  return {
    park: verifiedPark
      ? { parkCode: verifiedCode!, name: verifiedPark.fullName }
      : null,
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

export function npsCampgroundToRecord(camp: NpsCampground, stateCode?: string) {
  const lat = parseFloat(camp.latitude);
  const lng = parseFloat(camp.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const amenities = camp.amenities || {};
  const hasTent = Object.keys(amenities).some((k) =>
    k.toLowerCase().includes("tent"),
  );

  return {
    externalId: `nps-${camp.id}`,
    name: camp.name,
    latitude: lat,
    longitude: lng,
    // A state supplied to the NPS query is source-side filtering, so it is
    // safe to carry onto those returned rows. Otherwise remain unknown.
    state: stateCode ?? null,
    parkCode: camp.parkCode,
    parkName: null as string | null,
    source: "nps" as const,
    campingType: hasTent ? ("developed_tent" as const) : ("rv" as const),
    description: camp.description?.replace(/<[^>]+>/g, " ").slice(0, 2000),
    amenities,
    reservationUrl: camp.url,
    permitRequired: permitRequiredCompatibility("unknown"),
    accessStatus: "unknown" as const,
    permitStatus: "unknown" as const,
    fees: camp.fees,
    metadata: {
      reservationInfo: camp.reservationInfo,
      regulationsurl: camp.regulationsurl,
      campsites: camp.campsites,
      evidence: {
        access: { status: "unknown", sourceUrl: camp.regulationsurl || camp.url, inferred: false },
        permit: { status: "unknown", sourceUrl: camp.regulationsurl || camp.url, inferred: false },
      },
    },
  };
}
