import { corridorBounds, normalizeCorridor, type OfflineCorridor } from "@/lib/offline/corridor";

/**
 * Client-side corridor retrieval used while preparing a pack.
 *
 * Always resolves. A corridor is an enhancement to offline navigation, so no
 * failure here may propagate into the route-save path; the caller receives a
 * corridor whose coverage explains what happened instead of an exception.
 */
export async function fetchCorridorForRoute(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  bufferMeters?: number,
  signal?: AbortSignal,
): Promise<OfflineCorridor | null> {
  const bounds = corridorBounds(geometry, bufferMeters);
  if (!bounds) return null;
  const query = `bbox=${bounds.bbox.join(",")}&buffer=${Math.round(bounds.bufferMeters)}`;
  try {
    const response = await fetch(`/api/corridor?${query}`, { signal });
    if (!response.ok) {
      return normalizeCorridor({
        bufferMeters: bounds.bufferMeters,
        bbox: bounds.bbox,
        coverage: "failed",
        note:
          response.status === 400
            ? "The corridor area was rejected as too large. The route line is still saved."
            : `Surrounding terrain could not be downloaded (server said ${response.status}). The route line is still saved.`,
      });
    }
    const body = (await response.json()) as { corridor?: unknown };
    if (!body?.corridor || typeof body.corridor !== "object") {
      return normalizeCorridor({
        bufferMeters: bounds.bufferMeters,
        bbox: bounds.bbox,
        coverage: "failed",
        note: "The corridor download returned no usable data. The route line is still saved.",
      });
    }
    const candidate = body.corridor as Partial<OfflineCorridor>;
    // Re-normalized on the client: the response crossed a trust boundary, and the
    // caps that protect device storage are enforced here, not upstream.
    return normalizeCorridor({
      bufferMeters: candidate.bufferMeters ?? bounds.bufferMeters,
      bbox: bounds.bbox,
      lines: candidate.lines,
      points: candidate.points,
      coverage: candidate.coverage,
      note: candidate.note,
      retrievedAt: candidate.retrievedAt,
    });
  } catch (error) {
    if (signal?.aborted) return null;
    return normalizeCorridor({
      bufferMeters: bounds.bufferMeters,
      bbox: bounds.bbox,
      coverage: "failed",
      note: `Surrounding terrain could not be downloaded (${error instanceof Error ? error.message : "network error"}). The route line is still saved.`,
    });
  }
}
