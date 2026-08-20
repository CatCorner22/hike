import { and, eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { trails } from "@/lib/db/schema";
import { osmTrailId } from "@/lib/ids";
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
  const existing = await db.query.trails.findFirst({
    where: and(eq(trails.osmId, osmId), eq(trails.osmType, osmType)),
  });

  const lengthMeters = detail.lengthMeters ?? lineLengthMeters(detail.geometry);
  const profile = await fetchElevationProfile(detail.geometry);
  const elevationGainMeters = profile.length > 0 ? computeElevationGain(profile) : undefined;

  if (existing) {
    await db
      .update(trails)
      .set({
        name: detail.name,
        geometry: detail.geometry,
        lengthMeters,
        ...(elevationGainMeters !== undefined ? { elevationGainMeters } : {}),
        difficulty: detail.difficulty,
        sacScale: detail.sacScale,
        network: detail.network,
        wikipediaUrl: detail.wikipediaUrl,
        bbox: detail.bbox,
        tags: detail.tags,
        cachedAt: new Date(),
      })
      .where(eq(trails.id, existing.id));

    return {
      id: existing.id,
      detail: { ...detail, lengthMeters, elevationGainMeters: elevationGainMeters ?? existing.elevationGainMeters ?? undefined },
    };
  }

  const [inserted] = await db
    .insert(trails)
    .values({
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
    })
    .returning();

  return { id: inserted.id, detail: { ...detail, lengthMeters, elevationGainMeters } };
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
