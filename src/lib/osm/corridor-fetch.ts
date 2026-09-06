import { fetchWithTimeout, readJsonCapped } from "@/lib/api/outbound";
import type { OverpassResponse } from "@/lib/osm/overpass";
import { corridorQuery, parseCorridorResponse } from "@/lib/osm/corridor-query";
import type { CorridorCoverage, CorridorLine, CorridorPoint } from "@/lib/offline/corridor";

/**
 * Corridor retrieval.
 *
 * The corridor query is heavier than a trail lookup, so it gets a longer budget
 * than `runOverpass` allows and its own mirror rotation. It still fails closed:
 * a corridor that cannot be retrieved is reported as `failed` with a reason,
 * never as an empty-but-complete corridor. An empty corridor drawn as complete
 * would tell a hiker there is no road nearby, which is a claim we cannot make
 * from a failed request.
 */
const CORRIDOR_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

/**
 * Overpass declares `timeout:25` for this query, and an uncached first run of a
 * real corridor was measured taking longer than 10 s. A 12 s client budget
 * therefore failed the happy path while Overpass was still working -- the user
 * saw "could not be downloaded" for a request that would have succeeded. Preparing
 * a pack is a deliberate, stationary action with a progress state, so waiting is
 * cheaper than a false failure.
 */
const CORRIDOR_TIMEOUT_MS = 30_000;

export interface CorridorFetchResult {
  lines: CorridorLine[];
  points: CorridorPoint[];
  coverage: CorridorCoverage;
  note?: string;
}

export async function fetchCorridorFeatures(
  bbox: [number, number, number, number],
): Promise<CorridorFetchResult> {
  const query = corridorQuery(bbox);
  let lastError: Error | null = null;

  for (const [attempt, url] of CORRIDOR_MIRRORS.entries()) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "HikeApp/1.0 (offline corridor preparation)",
          },
          body: `data=${encodeURIComponent(query)}`,
        },
        CORRIDOR_TIMEOUT_MS,
      );
      if (!response.ok) {
        lastError = new Error(`Overpass corridor error: ${response.status}`);
        continue;
      }
      const data = await readJsonCapped<OverpassResponse>(response);
      const parsed = parseCorridorResponse(data);
      if (parsed.lines.length === 0 && parsed.points.length === 0) {
        return {
          ...parsed,
          coverage: "failed",
          note: "No roads, water or structures were found in the corridor. This may be genuinely remote ground, or the map data may be incomplete — do not read blank space as safe.",
        };
      }
      return { ...parsed, coverage: "complete" };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Corridor request failed");
    }
  }

  return {
    lines: [],
    points: [],
    coverage: "failed",
    note: `Surrounding terrain could not be downloaded (${lastError?.message ?? "network unavailable"}). The route line is still saved and navigable.`,
  };
}
