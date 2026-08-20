import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { trailResearch, trails } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { parseOsmTrailId } from "@/lib/ids";
import { researchTrail } from "@/lib/research/agent";
import { findOrCreateTrail } from "@/lib/trails/service";

const REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export async function GET(request: Request, { params }: { params: Promise<{ trailId: string }> }) {
  const { trailId } = await params;
  const refresh = new URL(request.url).searchParams.get("refresh") === "true";
  try {
    let trail = null; let resolvedId = trailId;
    const osm = parseOsmTrailId(trailId);
    if (osm) {
      const result = await findOrCreateTrail(osm.osmId, osm.osmType);
      if (!result) return NextResponse.json({ error: "Trail not found" }, { status: 404 });
      resolvedId = result.id; trail = result.detail;
    } else if (hasDatabase()) {
      const db = getDb();
      const row = await db.query.trails.findFirst({ where: eq(trails.id, trailId) });
      if (row) { resolvedId = row.id; trail = row; }
    }
    if (!trail) return NextResponse.json({ error: "Trail not found" }, { status: 404 });
    if (hasDatabase()) {
      const db = getDb();
      const cached = await db.query.trailResearch.findFirst({ where: eq(trailResearch.trailId, resolvedId), orderBy: (r, { desc }) => [desc(r.researchedAt)] });
      if (cached && !refresh && Date.now() - cached.researchedAt.getTime() < REFRESH_COOLDOWN_MS) return NextResponse.json({ brief: cached.brief, cached: true });
    }
    const brief = await researchTrail({
      trailName: trail.name,
      location: "center" in trail && trail.center ? { lat: trail.center.lat, lng: trail.center.lng } : trail.bbox ? { lat: (trail.bbox as number[])[1], lng: (trail.bbox as number[])[0] } : undefined,
      wikipediaUrl: trail.wikipediaUrl ?? undefined,
      tags: (trail.tags as Record<string, string>) ?? undefined,
    });
    if (hasDatabase()) await getDb().insert(trailResearch).values({ trailId: resolvedId, brief });
    return NextResponse.json({ brief, cached: false, refreshed: refresh });
  } catch (error) { return errorResponse(error, "Research failed"); }
}
