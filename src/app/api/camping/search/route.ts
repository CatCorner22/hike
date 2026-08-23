import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte, ne, sql, type SQL } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { campgrounds } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { parseBbox, toSouthWestNorthEast } from "@/lib/geo/bbox";
import { searchCampgrounds, npsCampgroundToRecord } from "@/lib/nps/client";
import { ridbFacilityToRecord, ridbPermitToRecord, searchFacilities, searchPermitEntrances } from "@/lib/ridb/client";
import { fetchAllStateCampgrounds, stateCampgroundToRecord } from "@/lib/state-parks";
import { searchBackcountryCamps } from "@/lib/osm/overpass";
import { filterSeedCampgrounds } from "@/lib/camping/seed";
import { rateLimit } from "@/lib/api/rate-limit";
import { requireOwner } from "@/lib/auth/owner";
import {
  CAMP_PERMIT_STATUSES,
  permitRequiredCompatibility,
  type CampAccessStatus,
  type CampPermitStatus,
} from "@/lib/camping/evidence";

type CampgroundRecord = {
  externalId: string; name: string; latitude: number; longitude: number; state: string | null;
  parkCode: string | null; parkName: string | null; source: "nps" | "ridb" | "state" | "osm";
  campingType: "developed_tent" | "rv" | "backcountry" | "walk_in"; description: string | null;
  amenities: Record<string, unknown> | null; reservationUrl: string | null; permitRequired: boolean | null;
  accessStatus: CampAccessStatus; permitStatus: CampPermitStatus;
  fees: unknown; metadata: Record<string, unknown> | null;
};

function osmCampgroundRecord(camp: Awaited<ReturnType<typeof searchBackcountryCamps>>[number]): CampgroundRecord {
  const sourceUrl = `https://www.openstreetmap.org/node/${encodeURIComponent(camp.osmId)}`;
  return {
    externalId: `osm-${camp.osmId}`,
    name: camp.name,
    latitude: camp.lat,
    longitude: camp.lng,
    state: null,
    parkCode: null,
    parkName: null,
    source: "osm",
    campingType: camp.campingType,
    description: null,
    amenities: camp.tags,
    reservationUrl: null,
    permitRequired: permitRequiredCompatibility(camp.permitStatus),
    accessStatus: camp.accessStatus,
    permitStatus: camp.permitStatus,
    fees: null,
    metadata: {
      ...camp.tags,
      evidence: {
        access: { status: camp.accessStatus, sourceUrl, inferred: false },
        permit: { status: camp.permitStatus, sourceUrl, inferred: false },
      },
    },
  };
}

async function fetchCampgroundRecords(query?: string, state?: string): Promise<CampgroundRecord[]> {
  const records: CampgroundRecord[] = [];
  const [npsCamps, ridbFacilities, ridbPermits, stateCamps] = await Promise.all([
    searchCampgrounds({ q: query, stateCode: state, limit: 50 }),
    searchFacilities({ query, state, limit: 50 }),
    // Permit-entrance responses do not include a state. Excluding them from a
    // state-filtered request is safer than stamping the requested state on.
    state ? Promise.resolve([]) : searchPermitEntrances({ query, limit: 30 }),
    fetchAllStateCampgrounds(),
  ]);
  for (const camp of npsCamps) { const record = npsCampgroundToRecord(camp, state); if (record) records.push(record); }
  for (const facility of ridbFacilities) { const record = ridbFacilityToRecord(facility, state); if (record) records.push(record); }
  for (const permit of ridbPermits) { const record = ridbPermitToRecord(permit); if (record) records.push(record); }
  for (const camp of stateCamps) {
    if (state && camp.state !== state) continue;
    if (query && !camp.name.toLowerCase().includes(query.toLowerCase())) continue;
    records.push(stateCampgroundToRecord(camp));
  }
  return records;
}

async function persistCampgrounds(records: CampgroundRecord[]) {
  if (!hasDatabase()) return;
  const db = getDb();
  for (const record of records) {
    const existing = await db.query.campgrounds.findFirst({ where: eq(campgrounds.externalId, record.externalId) });
    if (existing) await db.update(campgrounds).set({ ...record, cachedAt: new Date() }).where(eq(campgrounds.id, existing.id));
    else await db.insert(campgrounds).values(record);
  }
}

function matchesRecord(record: CampgroundRecord, filters: {
  q?: string;
  state?: string;
  campingType?: string;
  permitStatus?: string;
  source?: string;
  bbox?: [number, number, number, number] | null;
}): boolean {
  if (record.accessStatus === "private") return false;
  if (filters.q && !`${record.name} ${record.parkName ?? ""}`.toLowerCase().includes(filters.q.toLowerCase())) return false;
  if (filters.state && filters.state !== "all" && record.state && record.state !== filters.state) return false;
  if (filters.campingType && filters.campingType !== "all" && record.campingType !== filters.campingType) return false;
  if (filters.permitStatus && filters.permitStatus !== "all" && record.permitStatus !== filters.permitStatus) return false;
  if (filters.source && filters.source !== "all" && record.source !== filters.source) return false;
  if (filters.bbox) {
    const [west, south, east, north] = filters.bbox;
    if (record.longitude < west || record.longitude > east || record.latitude < south || record.latitude > north) return false;
  }
  return true;
}

function uniqueRecords(records: CampgroundRecord[]): CampgroundRecord[] {
  return [...new Map(records.map((record) => [record.externalId, record])).values()];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const state = searchParams.get("state") || undefined;
  const campingType = searchParams.get("campingType") || undefined;
  const legacyPermit = searchParams.get("permitRequired") || undefined;
  const permitStatus = searchParams.get("permitStatus") || (
    legacyPermit === "yes" ? "required" : legacyPermit === "no" ? "not_required" : legacyPermit
  ) || undefined;
  const source = searchParams.get("source") || undefined;
  const bboxParam = searchParams.get("bbox");
  const bbox = parseBbox(bboxParam);
  const sync = searchParams.get("sync") === "true";
  if (sync) {
    // The sync branch fans out to NPS/RIDB/ArcGIS/OSM and WRITES the results into the
    // shared campgrounds table. Anonymous callers could burn upstream quota and seed
    // the database; a session costs nothing to a real user and stops drive-by abuse.
    const owner = await requireOwner(request);
    if (!owner.ok) return owner.response;
    const limited = rateLimit(request, `camping-sync:${owner.ownerId}`, 4);
    if (limited) return limited;
  } else if (bbox) {
    const limited = rateLimit(request, "camping-nearby", 20);
    if (limited) return limited;
  }
  if (bboxParam && !bbox) return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });
  if (q && q.length > 128) return NextResponse.json({ error: "Query is too long" }, { status: 400 });
  if (campingType && campingType !== "all" && !["developed_tent", "rv", "backcountry", "walk_in"].includes(campingType)) {
    return NextResponse.json({ error: "Invalid camping type" }, { status: 400 });
  }
  if (source && source !== "all" && !["nps", "ridb", "state", "osm"].includes(source)) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }
  if (permitStatus && permitStatus !== "all" && !(CAMP_PERMIT_STATUSES as readonly string[]).includes(permitStatus)) {
    return NextResponse.json({ error: "Invalid permit status" }, { status: 400 });
  }

  try {
    const liveRecords = sync ? await fetchCampgroundRecords(q, state) : [];
    if (sync) await persistCampgrounds(liveRecords);
    if (!hasDatabase()) {
      const seeded = filterSeedCampgrounds({
        q,
        state,
        campingType,
        permitRequired: permitStatus === "required" ? "yes" : permitStatus === "not_required" ? "no" : undefined,
        source,
      }) as CampgroundRecord[];
      const osmRecords = bbox
        ? (await searchBackcountryCamps(toSouthWestNorthEast(bbox))).map(osmCampgroundRecord)
        : [];
      const records = uniqueRecords([...liveRecords, ...seeded, ...osmRecords])
        .filter((record) => matchesRecord(record, { q, state, campingType, permitStatus, source, bbox }));
      return NextResponse.json({
        campgrounds: records.map((record) => ({
          ...record,
          id: record.externalId,
          cachedAt: record.metadata?.seed === true ? null : new Date().toISOString(),
        })),
        coverage: {
          mode: sync ? "live-plus-starter" : bbox ? "nearby-osm-plus-starter" : "starter",
          refreshed: sync,
          liveRecords: liveRecords.length + osmRecords.length,
        },
      });
    }

    const db = getDb();
    const conditions: SQL[] = [];
    if (state && state !== "all") conditions.push(eq(campgrounds.state, state));
    if (campingType && campingType !== "all") conditions.push(eq(campgrounds.campingType, campingType as "developed_tent"));
    if (permitStatus && permitStatus !== "all") {
      conditions.push(eq(campgrounds.permitStatus, permitStatus as CampPermitStatus));
    }
    conditions.push(ne(campgrounds.accessStatus, "private"));
    if (source && source !== "all") conditions.push(eq(campgrounds.source, source as "nps"));
    if (q) conditions.push(sql`${campgrounds.name} ILIKE ${`%${q}%`}`);
    if (bbox) {
      conditions.push(gte(campgrounds.longitude, bbox[0]), lte(campgrounds.longitude, bbox[2]));
      conditions.push(gte(campgrounds.latitude, bbox[1]), lte(campgrounds.latitude, bbox[3]));
    }
    const findRows = () => db.query.campgrounds.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: [asc(campgrounds.name)],
      limit: 200,
    });
    // Empty results stay empty unless the caller asked for ?sync=true.
    let rows = await findRows();
    if (bbox && rows.length < 20) {
      const osmCamps = await searchBackcountryCamps(toSouthWestNorthEast(bbox));
      const existingIds = new Set(rows.map((row) => row.externalId));
      rows = [...rows, ...osmCamps
        .map(osmCampgroundRecord)
        .filter((record) => !existingIds.has(record.externalId))
        .filter((record) => matchesRecord(record, { q, state, campingType, permitStatus, source, bbox }))
        .map((record) => ({ ...record, id: record.externalId, cachedAt: new Date() }))];
    }
    return NextResponse.json({
      campgrounds: rows,
      coverage: { mode: "database-cache", refreshed: sync, liveRecords: liveRecords.length },
    });
  } catch (error) {
    return errorResponse(error, "Search failed");
  }
}
