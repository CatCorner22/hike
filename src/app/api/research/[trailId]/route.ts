import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { trailResearch } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { parseOsmTrailId } from "@/lib/ids";
import { researchTrail } from "@/lib/research/agent";
import { findOrCreateTrail, getTrailById, getTrailByOsmId } from "@/lib/trails/service";
import { getTrailDetail, type TrailDetail } from "@/lib/osm/overpass";
import { rateLimit } from "@/lib/api/rate-limit";
import { withDeadline } from "@/lib/api/outbound";

const REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const transientResearch = new Map<string, { brief: unknown; researchedAt: number }>();

type ResolvedTrail = {
  id: string;
  trail: {
    name: string;
    bbox: unknown;
    wikipediaUrl?: string | null;
    tags?: unknown;
    center?: { lat: number; lng: number };
  };
};

function toResolved(id: string, trail: TrailDetail | { name: string; bbox: unknown; wikipediaUrl: string | null; tags: unknown }): ResolvedTrail {
  return { id, trail };
}

async function resolveReadOnly(trailId: string): Promise<ResolvedTrail | null> {
  const osm = parseOsmTrailId(trailId);
  if (osm) {
    const cached = await getTrailByOsmId(osm.osmId, osm.osmType);
    if (cached) return toResolved(cached.id, cached);
    const detail = await getTrailDetail(osm.osmId, osm.osmType);
    return detail ? toResolved(trailId, detail) : null;
  }
  const cached = await getTrailById(trailId);
  return cached ? toResolved(cached.id, cached) : null;
}

async function createBrief(resolved: ResolvedTrail) {
  const bbox = resolved.trail.bbox as number[] | null;
  return withDeadline(researchTrail({
    trailName: resolved.trail.name,
    location: "center" in resolved.trail && resolved.trail.center
      ? resolved.trail.center
      : bbox ? { lat: bbox[1], lng: bbox[0] } : undefined,
    wikipediaUrl: resolved.trail.wikipediaUrl ?? undefined,
    tags: (resolved.trail.tags as Record<string, string>) ?? undefined,
  }), 15_000, null);
}

async function latestCached(trailId: string) {
  const transient = transientResearch.get(trailId);
  if (transient) return transient;
  if (!hasDatabase()) return null;
  const cached = await getDb().query.trailResearch.findFirst({
    where: eq(trailResearch.trailId, trailId),
    orderBy: [desc(trailResearch.researchedAt)],
  });
  return cached ? { brief: cached.brief, researchedAt: cached.researchedAt.getTime() } : null;
}

/**
 * A GET is read-only: it returns durable or process-local cached research and
 * may produce a transient brief, but never inserts or updates trail rows.
 * `refresh=true` is intentionally ignored while cooldown is active.
 */
export async function GET(request: Request, { params }: { params: Promise<{ trailId: string }> }) {
  const limited = rateLimit(request, "research", 6);
  if (limited) return limited;
  const { trailId } = await params;
  const requestedRefresh = new URL(request.url).searchParams.get("refresh") === "true";
  try {
    const resolved = await resolveReadOnly(trailId);
    if (!resolved) return NextResponse.json({ error: "Trail not found" }, { status: 404 });
    const cached = await latestCached(resolved.id);
    if (cached && Date.now() - cached.researchedAt < REFRESH_COOLDOWN_MS) {
      return NextResponse.json({ brief: cached.brief, cached: true, cooldownActive: requestedRefresh });
    }
    const brief = await createBrief(resolved);
    if (!brief) return NextResponse.json({ error: "Research timed out; cached sources remain available." }, { status: 504 });
    transientResearch.set(resolved.id, { brief, researchedAt: Date.now() });
    return NextResponse.json({ brief, cached: false, transient: true, cooldownActive: false });
  } catch (error) {
    return errorResponse(error, "Research failed");
  }
}

/**
 * Explicit refresh/import action. It still observes the same server-side
 * cooldown; query parameters can never bypass it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ trailId: string }> }) {
  const limited = rateLimit(request, "research-refresh", 3);
  if (limited) return limited;
  const { trailId } = await params;
  try {
    const existing = await resolveReadOnly(trailId);
    if (!existing) return NextResponse.json({ error: "Trail not found" }, { status: 404 });
    const cached = await latestCached(existing.id);
    if (cached && Date.now() - cached.researchedAt < REFRESH_COOLDOWN_MS) {
      return NextResponse.json({ brief: cached.brief, cached: true, cooldownActive: true });
    }

    let resolved = existing;
    const osm = parseOsmTrailId(trailId);
    if (osm && hasDatabase()) {
      const imported = await findOrCreateTrail(osm.osmId, osm.osmType);
      if (!imported) return NextResponse.json({ error: "Trail not found" }, { status: 404 });
      resolved = toResolved(imported.id, imported.detail);
    }
    const brief = await createBrief(resolved);
    if (!brief) return NextResponse.json({ error: "Research timed out; try again later." }, { status: 504 });
    if (hasDatabase()) await getDb().insert(trailResearch).values({ trailId: resolved.id, brief });
    transientResearch.set(resolved.id, { brief, researchedAt: Date.now() });
    return NextResponse.json({ brief, cached: false, cooldownActive: false });
  } catch (error) {
    return errorResponse(error, "Research failed");
  }
}
