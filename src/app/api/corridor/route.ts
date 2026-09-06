import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { parseBbox } from "@/lib/geo/bbox";
import { rateLimit } from "@/lib/api/rate-limit";
import { fetchCorridorFeatures } from "@/lib/osm/corridor-fetch";
import { corridorBboxDegreesExceeded } from "@/lib/osm/corridor-query";
import { normalizeCorridor, MAX_CORRIDOR_METERS } from "@/lib/offline/corridor";

/**
 * Corridor context for an offline route pack.
 *
 * This exists as a server route because the browser cannot reach Overpass under
 * this app's CSP, and because the outbound byte caps, timeouts and mirror
 * failover live server-side. It returns public map data and is therefore not
 * owner-scoped, but it is rate limited: the upstream is a donated community
 * endpoint and abusing it would get the whole app blocked.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, "corridor", 10);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const bbox = parseBbox(searchParams.get("bbox"));
  if (!bbox) return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });

  const bufferParam = Number(searchParams.get("buffer") ?? "");
  const bufferMeters =
    Number.isFinite(bufferParam) && bufferParam > 0 ? Math.min(bufferParam, MAX_CORRIDOR_METERS) : undefined;

  const bounds: [number, number, number, number] = [bbox[0], bbox[1], bbox[2], bbox[3]];
  if (corridorBboxDegreesExceeded(bounds)) {
    return NextResponse.json(
      { error: "Corridor area is too large. Prepare a shorter route or reduce the corridor width." },
      { status: 400 },
    );
  }

  try {
    const result = await fetchCorridorFeatures(bounds);
    const corridor = normalizeCorridor({
      bufferMeters: bufferMeters ?? 3218.688,
      bbox: bounds,
      lines: result.lines,
      points: result.points,
      coverage: result.coverage,
      note: result.note,
      retrievedAt: new Date().toISOString(),
    });
    // Corridor data is public and slow-changing, but it must never be cached in a
    // way that outlives its usefulness silently: the pack records retrievedAt and
    // the UI reports it, so a short shared cache is safe.
    return NextResponse.json(
      { corridor },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    return errorResponse(error, "Corridor download failed");
  }
}
