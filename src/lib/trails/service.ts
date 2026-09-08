import { and, eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { trails } from "@/lib/db/schema";
import { parseOsmTrailId, osmTrailId } from "@/lib/ids";
import {
  getTrailDetail,
  searchTrails,
  type TrailDetail,
  type TrailSearchResult,
} from "@/lib/osm/overpass";
import {
  computeElevationGain,
  fetchElevationProfile,
  lineLengthMeters,
} from "@/lib/geo";

export async function findOrCreateTrail(
  osmId: string,
  osmType: string = "relation",
): Promise<{ id: string; detail: TrailDetail } | null> {
  const detail = await getTrailDetail(osmId, osmType);
  if (!detail) return null;

  if (!hasDatabase()) {
    return { id: osmTrailId(osmType, osmId), detail };
  }

  const db = getDb();
  const lengthMeters = detail.lengthMeters ?? lineLengthMeters(detail.geometry);
  let elevationGainMeters: number | undefined;
  try {
    const profile = await fetchElevationProfile(detail.geometry);
    if (profile.length > 0) elevationGainMeters = computeElevationGain(profile);
  } catch {
    /* Geometry is enough to persist the trail; elevation can fill in later. */
  }

  const cachedAt = new Date();
  const values = {
    osmId,
    osmType,
    name: detail.name,
    geometry: detail.geometry,
    lengthMeters,
    elevationGainMeters,
    difficulty: detail.difficulty,
    sacScale: detail.sacScale,
    network: detail.network,
    wikipediaUrl: detail.wikipediaUrl,
    bbox: detail.bbox,
    tags: detail.tags,
    cachedAt,
  };

  try {
    const [row] = await db
      .insert(trails)
      .values(values)
      .onConflictDoUpdate({
        target: [trails.osmId, trails.osmType],
        set: {
          name: values.name,
          geometry: values.geometry,
          lengthMeters: values.lengthMeters,
          ...(elevationGainMeters !== undefined ? { elevationGainMeters } : {}),
          difficulty: values.difficulty,
          sacScale: values.sacScale,
          network: values.network,
          wikipediaUrl: values.wikipediaUrl,
          bbox: values.bbox,
          tags: values.tags,
          cachedAt,
        },
      })
      .returning();
    if (row) {
      return {
        id: row.id,
        detail: {
          ...detail,
          lengthMeters,
          elevationGainMeters: elevationGainMeters ?? row.elevationGainMeters ?? undefined,
        },
      };
    }
  } catch {
    // Unique races or drivers that reject ON CONFLICT still resolve by re-read.
  }

  const winner = await db.query.trails.findFirst({
    where: and(eq(trails.osmId, osmId), eq(trails.osmType, osmType)),
  });
  if (!winner) return null;
  return {
    id: winner.id,
    detail: {
      ...detail,
      lengthMeters,
      elevationGainMeters: elevationGainMeters ?? winner.elevationGainMeters ?? undefined,
    },
  };
}

export async function searchTrailsWithCache(
  query: string,
  bbox?: [number, number, number, number],
): Promise<TrailSearchResult[]> {
  return searchTrails(query, bbox);
}

export async function getTrailById(trailId: string) {
  if (!hasDatabase()) return null;
  const db = getDb();
  return db.query.trails.findFirst({ where: eq(trails.id, trailId) });
}

export async function getTrailByOsmId(osmId: string, osmType: string = "relation") {
  if (!hasDatabase()) return null;
  const db = getDb();
  return db.query.trails.findFirst({
    where: and(eq(trails.osmId, osmId), eq(trails.osmType, osmType)),
  });
}

export async function listRecentTrails(limit = 10) {
  if (!hasDatabase()) return [];
  const db = getDb();
  return db.query.trails.findMany({ limit, orderBy: (t, { desc }) => [desc(t.cachedAt)] });
}

/**
 * Plans/activities store a UUID FK when Postgres is on. Explore trails are
 * `osm-relation-123`. Resolve that to a real row (or keep the OSM id on the
 * file store) so "Add to plan" and trail links keep working.
 *
 * The file store never writes a trails table, so Overpass is skipped there —
 * the Explore href is already a stable key.
 */
export async function resolveStoredTrailId(trailId: string | null | undefined): Promise<string | null> {
  if (!trailId) return null;
  const osm = parseOsmTrailId(trailId);
  if (!osm) {
    // A well-formed UUID that is not a stored trail used to pass through and
    // then die on the Postgres FK as a 500 — while the JSON fallback stored
    // it silently. Verify the row exists when we have a trails table.
    if (hasDatabase()) {
      const existing = await getTrailById(trailId);
      return existing ? existing.id : null;
    }
    return trailId;
  }
  if (!hasDatabase()) return trailId;
  try {
    const created = await findOrCreateTrail(osm.osmId, osm.osmType);
    if (!created || parseOsmTrailId(created.id)) return null;
    return created.id;
  } catch {
    // Overpass/DB failures must not block Add to plan when the client copied geometry.
    return null;
  }
}

/** Postgres `hike_plans.trail_id` / `activities.trail_id` are UUID FKs. */
export function postgresTrailFk(trailId: string | null | undefined): string | null {
  if (!trailId || parseOsmTrailId(trailId)) return null;
  return trailId;
}
