import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validation";
import { gpxFromLineString, parseGpx } from "@/lib/geo";
import { parseOsmTrailId } from "@/lib/ids";
import { getTrailById, getTrailByOsmId } from "@/lib/trails/service";
import { getTrailDetail } from "@/lib/osm/overpass";

const MAX_GPX_BYTES = 5 * 1024 * 1024;
const gpxImportSchema = z.object({
  gpx: z.string().min(1).max(MAX_GPX_BYTES),
  name: z.string().trim().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trailId = searchParams.get("trailId");
  if (!trailId) return NextResponse.json({ error: "trailId required" }, { status: 400 });
  try {
    let geometry: GeoJSON.LineString | GeoJSON.MultiLineString | null = null;
    let name = "Trail";
    const osm = parseOsmTrailId(trailId);
    if (osm) {
      const cached = await getTrailByOsmId(osm.osmId, osm.osmType);
      if (cached) { geometry = cached.geometry as GeoJSON.LineString | GeoJSON.MultiLineString; name = cached.name; }
      else {
        // Export discovery must not silently insert/update shared rows.
        const detail = await getTrailDetail(osm.osmId, osm.osmType);
        if (detail) { geometry = detail.geometry; name = detail.name; }
      }
    } else {
      const trail = await getTrailById(trailId);
      if (trail) { geometry = trail.geometry as GeoJSON.LineString | GeoJSON.MultiLineString; name = trail.name; }
    }
    if (!geometry) return NextResponse.json({ error: "Trail not found" }, { status: 404 });
    return new NextResponse(gpxFromLineString(name, geometry), {
      headers: { "Content-Type": "application/gpx+xml", "Content-Disposition": `attachment; filename="${name.replace(/[^a-z0-9]/gi, "_")}.gpx"` },
    });
  } catch (error) { return errorResponse(error, "Export failed"); }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_GPX_BYTES + 4096) {
    return NextResponse.json({ error: "GPX payload is too large" }, { status: 413 });
  }
  const parsed = await parseJsonBody(request, gpxImportSchema, { maxBytes: MAX_GPX_BYTES + 8_192 });
  if (!parsed.ok) return parsed.response;
  if (new TextEncoder().encode(parsed.data.gpx).byteLength > MAX_GPX_BYTES) {
    return NextResponse.json({ error: "GPX payload is too large" }, { status: 413 });
  }
  try {
    const geometry = parseGpx(parsed.data.gpx);
    if (!geometry) return NextResponse.json({ error: "Invalid GPX" }, { status: 400 });
    return NextResponse.json({ name: parsed.data.name ?? "Imported route", geometry });
  } catch (error) { return errorResponse(error, "Import failed"); }
}
