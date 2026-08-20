import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { findOrCreateTrail, getTrailById } from "@/lib/trails/service";
import { fetchElevationProfile } from "@/lib/geo";
import { parseOsmTrailId } from "@/lib/ids";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const osm = parseOsmTrailId(id);
    if (osm) {
      const result = await findOrCreateTrail(osm.osmId, osm.osmType);
      if (!result) return NextResponse.json({ error: "Trail not found" }, { status: 404 });
      return NextResponse.json({ id: result.id, ...result.detail, elevationProfile: await fetchElevationProfile(result.detail.geometry) });
    }
    const trail = await getTrailById(id);
    if (!trail) return NextResponse.json({ error: "Trail not found" }, { status: 404 });
    const bbox = (trail.bbox as number[] | null) ?? [];
    return NextResponse.json({
      id: trail.id, osmId: trail.osmId, osmType: trail.osmType, name: trail.name, geometry: trail.geometry,
      bbox: trail.bbox, center: { lat: (bbox[1] + bbox[3]) / 2 || 0, lng: (bbox[0] + bbox[2]) / 2 || 0 },
      lengthMeters: trail.lengthMeters, elevationGainMeters: trail.elevationGainMeters,
      difficulty: trail.difficulty, sacScale: trail.sacScale, network: trail.network,
      wikipediaUrl: trail.wikipediaUrl, tags: trail.tags,
      elevationProfile: await fetchElevationProfile(trail.geometry as GeoJSON.LineString | GeoJSON.MultiLineString),
    });
  } catch (error) { return errorResponse(error, "Failed to load trail"); }
}
