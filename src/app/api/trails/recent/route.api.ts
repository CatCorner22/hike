import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { listRecentTrails } from "@/lib/trails/service";
import { rateLimit } from "@/lib/api/rate-limit";

/**
 * Recently cached trails for the home screen. Public by design: the list is
 * global cache recency (which trails this deployment fetched lately), not any
 * hiker's browsing history — nothing owner-scoped leaves this endpoint.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, "trails-recent", 30);
  if (limited) return limited;
  try {
    const trails = await listRecentTrails(5);
    return NextResponse.json({
      trails: trails.map((trail) => ({
        id: trail.id,
        name: trail.name,
        osmType: trail.osmType,
        osmId: trail.osmId,
      })),
    });
  } catch (error) {
    return errorResponse(error, "Recent trails are unavailable");
  }
}
