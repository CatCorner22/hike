import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validation";
import { rateLimit } from "@/lib/api/rate-limit";
import { fetchWithTimeout, readJsonCapped } from "@/lib/api/outbound";
import {
  TERRAIN_MIN_COVERAGE,
  chunkTerrainPoints,
  planTerrainGrid,
  terrainCoverage,
  type TerrainGrid,
} from "@/lib/offline/terrain-grid";

/**
 * The elevation grid a route pack carries so the offline map can show relief.
 *
 * Server-side because the elevation service is an outbound third party, and
 * every outbound call in this app goes through one place that bounds its time,
 * its size and its concurrency. A hiker pressing "Prepare offline" at a
 * trailhead on the last bar of signal needs this to either work or fail, never
 * to hang.
 */

const MAX_TERRAIN_BODY_BYTES = 2_048;

const terrainRequestSchema = z.object({
  routeId: z.string().trim().min(1).max(256),
  bbox: z.array(z.number().finite()).length(4),
}).strict();

/**
 * Open-elevation by default, overridable.
 *
 * The public instance is a free volunteer service: it goes down, it rate-limits,
 * and some networks cannot reach it at all. An operator running their own
 * instance — or a mirror closer to their users — should not have to fork the app
 * to use it, and a route pack prepared against a self-hosted copy is the same
 * pack. Must be https, because everything else this app fetches is.
 */
const DEFAULT_ELEVATION_ENDPOINT = "https://api.open-elevation.com/api/v1/lookup";

function elevationEndpoint(): { url: string; source: string } {
  const configured = process.env.ELEVATION_API_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "https:" || parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
        return { url: parsed.toString(), source: parsed.hostname };
      }
    } catch {
      // Fall through to the default rather than failing the whole prepare over
      // a typo in an optional setting.
    }
  }
  return { url: DEFAULT_ELEVATION_ENDPOINT, source: "open-elevation" };
}

/**
 * Per request, not for the whole grid. Three sequential chunks at this ceiling
 * is still well inside the twelve seconds the client allows the whole call.
 */
const ELEVATION_TIMEOUT_MS = 8_000;

interface ElevationResult {
  elevation?: unknown;
}

async function lookupElevations(
  endpoint: string,
  points: Array<{ lat: number; lng: number }>,
): Promise<Array<number | null>> {
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: points.map((point) => ({ latitude: point.lat, longitude: point.lng })),
      }),
    },
    ELEVATION_TIMEOUT_MS,
  );
  if (!response.ok) return points.map(() => null);
  const data = await readJsonCapped<{ results?: unknown }>(response);
  const results: unknown[] = Array.isArray(data.results) ? data.results : [];
  // Position is the only correspondence this API gives, so a short answer means
  // the tail is unknown rather than shifted.
  return points.map((_, index) => {
    const result = results[index] as ElevationResult | undefined;
    const elevation = result?.elevation;
    return typeof elevation === "number" && Number.isFinite(elevation) ? elevation : null;
  });
}

export async function POST(request: Request) {
  // Three outbound calls each, against a free public service. Tighter than the
  // corridor limit for that reason.
  const limited = rateLimit(request, "terrain-grid", 6);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, terrainRequestSchema, {
    maxBytes: MAX_TERRAIN_BODY_BYTES,
  });
  if (!parsed.ok) return parsed.response;

  const bbox = parsed.data.bbox as [number, number, number, number];
  const plan = planTerrainGrid(bbox);
  if (!plan) {
    return NextResponse.json(
      { error: "That corridor cannot be sampled for terrain." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const endpoint = elevationEndpoint();
    const elevations: Array<number | null> = [];
    // Sequential on purpose: this is a free public service and the app is one
    // hiker, not a crawler.
    for (const chunk of chunkTerrainPoints(plan.points)) {
      elevations.push(...(await lookupElevations(endpoint.url, chunk)));
    }

    const grid: TerrainGrid = {
      bbox,
      cols: plan.cols,
      rows: plan.rows,
      elevations,
      spacingMeters: plan.spacingMeters,
      source: endpoint.source,
      fetchedAt: new Date().toISOString(),
    };

    const coverage = terrainCoverage(grid);
    if (coverage < TERRAIN_MIN_COVERAGE) {
      // A half-answered grid shades half the map and leaves the rest blank,
      // which reads as flat ground rather than as missing data.
      return NextResponse.json(
        {
          grid: null,
          reason: `Only ${Math.round(coverage * 100)}% of the corridor had elevation data.`,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json({ grid }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Terrain could not be sampled");
  }
}
