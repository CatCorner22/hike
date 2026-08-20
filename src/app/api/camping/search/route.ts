import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { campgrounds } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { parseBbox, toSouthWestNorthEast } from "@/lib/geo/bbox";
import { searchCampgrounds, npsCampgroundToRecord } from "@/lib/nps/client";
import { ridbFacilityToRecord, ridbPermitToRecord, searchFacilities, searchPermitEntrances } from "@/lib/ridb/client";
import { fetchAllStateCampgrounds, stateCampgroundToRecord } from "@/lib/state-parks";
import { searchBackcountryCamps } from "@/lib/osm/overpass";
import { filterSeedCampgrounds } from "@/lib/camping/seed";

async function syncCampgrounds(query?: string, state?: string) {
  if (!hasDatabase()) return;
  const db = getDb();
  type CampgroundRecord = {
    externalId: string; name: string; latitude: number; longitude: number; state: string | null;
    parkCode: string | null; parkName: string | null; source: "nps" | "ridb" | "state" | "osm";
    campingType: "developed_tent" | "rv" | "backcountry" | "walk_in"; description: string | null;
    amenities: Record<string, unknown> | null; reservationUrl: string | null; permitRequired: boolean;
    fees: unknown; metadata: Record<string, unknown> | null;
  };
  const records: CampgroundRecord[] = [];
  const [npsCamps, ridbFacilities, ridbPermits, stateCamps] = await Promise.all([
    searchCampgrounds({ q: query, stateCode: state, limit: 50 }),
    searchFacilities({ query, state, limit: 50 }),
    searchPermitEntrances({ query, limit: 30 }),
    fetchAllStateCampgrounds(),
  ]);
  for (const camp of npsCamps) { const record = npsCampgroundToRecord(camp); if (record) records.push(record); }
  for (const facility of ridbFacilities) { const record = ridbFacilityToRecord(facility, state); if (record) records.push(record); }
  for (const permit of ridbPermits) { const record = ridbPermitToRecord(permit, state); if (record) records.push(record); }
  for (const camp of stateCamps) {
    if (state && camp.state !== state) continue;
    if (query && !camp.name.toLowerCase().includes(query.toLowerCase())) continue;
    records.push(stateCampgroundToRecord(camp));
  }
  for (const record of records) {
    const existing = await db.query.campgrounds.findFirst({ where: eq(campgrounds.externalId, record.externalId) });
    if (existing) await db.update(campgrounds).set({ ...record, cachedAt: new Date() }).where(eq(campgrounds.id, existing.id));
    else await db.insert(campgrounds).values(record);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const state = searchParams.get("state") || undefined;
  const campingType = searchParams.get("campingType") || undefined;
  const permitRequired = searchParams.get("permitRequired") || undefined;
  const source = searchParams.get("source") || undefined;
  const bboxParam = searchParams.get("bbox");
  const bbox = parseBbox(bboxParam);
  const sync = searchParams.get("sync") === "true";
  if (bboxParam && !bbox) return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });
  if (q && q.length > 128) return NextResponse.json({ error: "Query is too long" }, { status: 400 });

  try {
    if (sync) await syncCampgrounds(q, state);
    if (!hasDatabase()) {
      let seeded = filterSeedCampgrounds({ q, state, campingType, permitRequired, source });
      if (bbox) seeded = seeded.filter((camp) => camp.longitude >= bbox[0] && camp.longitude <= bbox[2] && camp.latitude >= bbox[1] && camp.latitude <= bbox[3]);
      return NextResponse.json({ campgrounds: seeded });
    }

    const db = getDb();
    const conditions: SQL[] = [];
    if (state && state !== "all") conditions.push(eq(campgrounds.state, state));
    if (campingType && campingType !== "all") conditions.push(eq(campgrounds.campingType, campingType as "developed_tent"));
    if (permitRequired === "yes") conditions.push(eq(campgrounds.permitRequired, true));
    else if (permitRequired === "no") conditions.push(eq(campgrounds.permitRequired, false));
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
    let rows = await findRows();
    if (rows.length === 0) { await syncCampgrounds(q, state); rows = await findRows(); }
    if (bbox && rows.length < 20) {
      const osmCamps = await searchBackcountryCamps(toSouthWestNorthEast(bbox));
      rows = [...rows, ...osmCamps.map((c) => ({
        id: `osm-${c.osmId}`, externalId: `osm-${c.osmId}`, name: c.name, latitude: c.lat, longitude: c.lng,
        state: null, parkCode: null, parkName: null, source: "osm" as const,
        campingType: c.backcountry ? "backcountry" as const : "walk_in" as const,
        description: null, amenities: c.tags, reservationUrl: null, permitRequired: c.backcountry,
        fees: null, metadata: c.tags, cachedAt: new Date(),
      }))];
    }
    return NextResponse.json({ campgrounds: rows });
  } catch (error) {
    return errorResponse(error, "Search failed");
  }
}
