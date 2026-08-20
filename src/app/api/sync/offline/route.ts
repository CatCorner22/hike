import { NextResponse } from "next/server";
import { gpxFromLineString } from "@/lib/geo";
import { parseOsmTrailId } from "@/lib/ids";
import { findOrCreateTrail, getTrailById } from "@/lib/trails/service";
import { z } from "zod";

const importSchema = z.object({
  gpx: z.string().min(1).max(5_000_000),
  name: z.string().trim().max(255).optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trailId = searchParams.get("trailId");

  if (!trailId) {
    return NextResponse.json({ error: "trailId required" }, { status: 400 });
  }

  try {
    let geometry: GeoJSON.LineString | GeoJSON.MultiLineString | null = null;
    let name = "Trail";

    const osm = parseOsmTrailId(trailId);
    if (osm) {
      const result = await findOrCreateTrail(osm.osmId, osm.osmType);
      if (result) {
        geometry = result.detail.geometry;
        name = result.detail.name;
      }
    } else {
      const trail = await getTrailById(trailId);
      if (trail) {
        geometry = trail.geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
        name = trail.name;
      }
    }

    if (!geometry) {
      return NextResponse.json({ error: "Trail not found" }, { status: 404 });
    }

    const gpx = gpxFromLineString(name, geometry);

    return new NextResponse(gpx, {
      headers: {
        "Content-Type": "application/gpx+xml",
        "Content-Disposition": `attachment; filename="${name.replace(/[^a-z0-9]/gi, "_")}.gpx"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = importSchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid GPX request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { gpx, name } = parsed.data;

  const { parseGpx } = await import("@/lib/geo");
  const geometry = parseGpx(gpx);

  if (!geometry) {
    return NextResponse.json({ error: "Invalid GPX" }, { status: 400 });
  }

  return NextResponse.json({ name: name || "Imported route", geometry });
}
