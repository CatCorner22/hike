import { NextResponse } from "next/server";
import { gpxFromLineString } from "@/lib/geo";
import { findOrCreateTrail, getTrailById } from "@/lib/trails/service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trailId = searchParams.get("trailId");
  const planId = searchParams.get("planId");

  if (!trailId) {
    return NextResponse.json({ error: "trailId required" }, { status: 400 });
  }

  try {
    let geometry: GeoJSON.LineString | GeoJSON.MultiLineString | null = null;
    let name = "Trail";

    if (trailId.startsWith("osm-")) {
      const [, osmType, osmId] = trailId.split("-");
      const result = await findOrCreateTrail(osmId, osmType);
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
  const body = await request.json();
  const { gpx, name } = body;

  if (!gpx) {
    return NextResponse.json({ error: "GPX content required" }, { status: 400 });
  }

  const { parseGpx } = await import("@/lib/geo");
  const geometry = parseGpx(gpx);

  if (!geometry) {
    return NextResponse.json({ error: "Invalid GPX" }, { status: 400 });
  }

  return NextResponse.json({ name: name || "Imported route", geometry });
}
