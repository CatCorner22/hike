import { fetchWithTimeout, readJsonCapped } from "@/lib/api/outbound";
import { permitRequiredCompatibility } from "@/lib/camping/evidence";
const RIDB_BASE = "https://ridb.recreation.gov/api/v1";

function getApiKey() {
  return process.env.RIDB_API_KEY || null;
}

async function ridbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const url = new URL(`${RIDB_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: { apikey: apiKey },
      next: { revalidate: 86400 },
    }, 5_000);
  } catch {
    return null;
  }

  if (!response.ok) return null;
  return readJsonCapped(response);
}

export interface RidbFacility {
  FacilityID: string;
  FacilityName: string;
  FacilityDescription: string;
  FacilityLatitude: number;
  FacilityLongitude: number;
  FacilityTypeDescription: string;
  Reservable: boolean;
  Enabled: boolean;
  LastUpdatedDate: string;
}

export interface RidbCampsite {
  CampsiteID: string;
  CampsiteName: string;
  CampsiteType: string;
  TypeOfUse: string;
  Loop: string;
  CampsiteAccessible: boolean;
  CampsiteReservable: boolean;
}

export interface RidbPermitEntrance {
  PermitEntranceID: string;
  PermitEntranceName: string;
  PermitEntranceDescription: string;
  PermitEntranceLatitude: number;
  PermitEntranceLongitude: number;
  District: string;
  Zone: string;
}

export async function searchFacilities(params: {
  state?: string;
  query?: string;
  activity?: string;
  limit?: number;
  offset?: number;
}): Promise<RidbFacility[]> {
  const data = await ridbFetch<{ RECDATA: RidbFacility[] }>("/facilities", {
    limit: String(params.limit ?? 50),
    offset: String(params.offset ?? 0),
    ...(params.state ? { state: params.state } : {}),
    ...(params.query ? { query: params.query } : {}),
    ...(params.activity ? { activity: params.activity } : {}),
  });
  return data?.RECDATA ?? [];
}

export async function getFacilityCampsites(facilityId: string): Promise<RidbCampsite[]> {
  const data = await ridbFetch<{ RECDATA: RidbCampsite[] }>(
    `/facilities/${facilityId}/campsites`,
    { limit: "100" },
  );
  return data?.RECDATA ?? [];
}

export async function searchPermitEntrances(params: {
  query?: string;
  limit?: number;
}): Promise<RidbPermitEntrance[]> {
  const data = await ridbFetch<{ RECDATA: RidbPermitEntrance[] }>("/permitentrances", {
    limit: String(params.limit ?? 50),
    ...(params.query ? { query: params.query } : {}),
  });
  return data?.RECDATA ?? [];
}

export function ridbFacilityToRecord(facility: RidbFacility, state?: string) {
  const lat = facility.FacilityLatitude;
  const lng = facility.FacilityLongitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const typeDesc = facility.FacilityTypeDescription?.toLowerCase() || "";
  let campingType: "developed_tent" | "rv" | "backcountry" | "walk_in" = "developed_tent";
  if (typeDesc.includes("rv")) campingType = "rv";
  if (typeDesc.includes("backcountry") || typeDesc.includes("wilderness")) {
    campingType = "backcountry";
  }

  return {
    externalId: `ridb-facility-${facility.FacilityID}`,
    name: facility.FacilityName,
    latitude: lat,
    longitude: lng,
    state: state ?? null,
    parkCode: null as string | null,
    parkName: null as string | null,
    source: "ridb" as const,
    campingType,
    description: facility.FacilityDescription?.slice(0, 2000) ?? null,
    amenities: { reservable: facility.Reservable },
    reservationUrl: `https://www.recreation.gov/camping/campgrounds/${facility.FacilityID}`,
    permitRequired: permitRequiredCompatibility("unknown"),
    accessStatus: "unknown" as const,
    permitStatus: "unknown" as const,
    fees: null,
    metadata: {
      facilityType: facility.FacilityTypeDescription,
      lastUpdated: facility.LastUpdatedDate,
      evidence: {
        access: { status: "unknown", inferred: false, sourceUpdatedAt: facility.LastUpdatedDate },
        permit: { status: "unknown", inferred: false, sourceUpdatedAt: facility.LastUpdatedDate },
      },
    },
  };
}

export function ridbPermitToRecord(entrance: RidbPermitEntrance) {
  const lat = entrance.PermitEntranceLatitude;
  const lng = entrance.PermitEntranceLongitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return {
    externalId: `ridb-permit-${entrance.PermitEntranceID}`,
    name: entrance.PermitEntranceName,
    latitude: lat,
    longitude: lng,
    // This RIDB payload has no state field. Never stamp the caller's requested
    // state onto a location the source did not identify that way.
    state: null as string | null,
    parkCode: null as string | null,
    parkName: entrance.District || entrance.Zone || null,
    source: "ridb" as const,
    campingType: "backcountry" as const,
    description: entrance.PermitEntranceDescription?.slice(0, 2000) ?? null,
    amenities: { district: entrance.District, zone: entrance.Zone },
    reservationUrl: "https://www.recreation.gov/permits",
    permitRequired: true,
    accessStatus: "unknown" as const,
    permitStatus: "required" as const,
    fees: null,
    metadata: {
      type: "permit_entrance",
      evidence: {
        access: { status: "unknown", inferred: false },
        permit: {
          status: "required",
          sourceUrl: "https://www.recreation.gov/permits",
          inferred: false,
        },
      },
    },
  };
}
