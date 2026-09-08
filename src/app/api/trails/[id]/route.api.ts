import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { getTrailById, getTrailByOsmId } from "@/lib/trails/service";
import { fetchElevationProfile } from "@/lib/geo";
import { parseOsmTrailId } from "@/lib/ids";
import { getTrailDetail } from "@/lib/osm/overpass";
import { rateLimit } from "@/lib/api/rate-limit";
import { withDeadline } from "@/lib/api/outbound";

function bboxCenter(bbox: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const [minLng, minLat, maxLng, maxLat] = bbox;
  if (![minLng, minLat, maxLng, maxLat].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, "trail-detail", 15);
  if (limited) return limited;
  const { id } = await params;
  try {
    const osm = parseOsmTrailId(id);
    if (osm) {
      const cached = await getTrailByOsmId(osm.osmId, osm.osmType);
      if (cached) {
        const bbox = (cached.bbox as number[] | null) ?? [];
        return NextResponse.json({
          id: cached.id, osmId: cached.osmId, osmType: cached.osmType, name: cached.name, geometry: cached.geometry,
          bbox: cached.bbox, center: bboxCenter(bbox),
          lengthMeters: cached.lengthMeters, elevationGainMeters: cached.elevationGainMeters,
          difficulty: cached.difficulty, sacScale: cached.sacScale, network: cached.network,
          wikipediaUrl: cached.wikipediaUrl, tags: cached.tags,
          elevationProfile: await withDeadline(fetchElevationProfile(cached.geometry as GeoJSON.LineString | GeoJSON.MultiLineString), 6_000, []),
        });
      }
      // Discovery GETs intentionally do not write shared trail rows. An
      // explicit server-side import/refresh endpoint can persist this later.
      const detail = await getTrailDetail(osm.osmId, osm.osmType);
      if (!detail) return NextResponse.json({ error: "Trail not found" }, { status: 404 });
      return NextResponse.json({ id, ...detail, elevationProfile: await withDeadline(fetchElevationProfile(detail.geometry), 6_000, []) });
    }
    const trail = await getTrailById(id);
    if (!trail) return NextResponse.json({ error: "Trail not found" }, { status: 404 });
    const bbox = (trail.bbox as number[] | null) ?? [];
    return NextResponse.json({
      id: trail.id, osmId: trail.osmId, osmType: trail.osmType, name: trail.name, geometry: trail.geometry,
      bbox: trail.bbox, center: bboxCenter(bbox),
      lengthMeters: trail.lengthMeters, elevationGainMeters: trail.elevationGainMeters,
      difficulty: trail.difficulty, sacScale: trail.sacScale, network: trail.network,
      wikipediaUrl: trail.wikipediaUrl, tags: trail.tags,
      elevationProfile: await withDeadline(fetchElevationProfile(trail.geometry as GeoJSON.LineString | GeoJSON.MultiLineString), 6_000, []),
    });
  } catch (error) { return errorResponse(error, "Failed to load trail"); }
}
