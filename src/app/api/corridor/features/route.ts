import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validation";
import { rateLimit } from "@/lib/api/rate-limit";
import { parseBbox, type BboxLngLat } from "@/lib/geo/bbox";
import { validCorridorFeatures } from "@/lib/offline/corridor-features";
import { fetchCorridorFeatureSet } from "@/lib/osm/corridor-overpass";

const MAX_CORRIDOR_BODY_BYTES = 8_192;

const corridorRequestSchema = z.object({
  routeId: z.string().trim().min(1).max(256),
  bboxes: z.array(z.array(z.number().finite()).length(4)).min(1).max(2),
});

function parseRouteId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
}

function parseBboxBody(value: unknown): BboxLngLat | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  return parseBbox(value.join(","));
}

function parseBboxesBody(value: unknown): BboxLngLat[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const bboxes = value.map(parseBboxBody);
  return bboxes.every((bbox): bbox is BboxLngLat => bbox !== null) ? bboxes : null;
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "corridor-features", 8);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, corridorRequestSchema, {
    maxBytes: MAX_CORRIDOR_BODY_BYTES,
  });
  if (!parsed.ok) return parsed.response;

  const routeId = parseRouteId(parsed.data.routeId);
  const bboxes = parseBboxesBody(parsed.data.bboxes);
  if (!routeId || !bboxes) {
    return NextResponse.json({ error: "Route id and corridor bounds are required." }, { status: 400 });
  }

  try {
    const result = await fetchCorridorFeatureSet(routeId, bboxes);
    if (result.features && !validCorridorFeatures(result.features, routeId, bboxes)) {
      return NextResponse.json({ features: null, reason: "Corridor feature snapshot failed validation." });
    }
    return NextResponse.json({ features: result.features, reason: result.reason });
  } catch (error) {
    return errorResponse(error, "Corridor feature lookup failed");
  }
}
