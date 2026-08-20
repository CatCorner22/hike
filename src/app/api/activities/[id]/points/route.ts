import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { MAX_ACTIVITY_POINTS, parseIsoDate, parseLatLng } from "@/lib/api/validate";
import { getDb, hasDatabase } from "@/lib/db";
import { activityPoints } from "@/lib/db/schema";
import { addActivityPoint, listActivityPoints } from "@/lib/store/local";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const coords = parseLatLng(body.lat, body.lng);
  const recordedAt = parseIsoDate(body.recordedAt) ?? new Date().toISOString();
  if (!coords) {
    return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
  }

  try {
    if (hasDatabase()) {
      const db = getDb();
      const existing = await db.query.activityPoints.findMany({
        where: eq(activityPoints.activityId, id),
        columns: { id: true },
      });
      if (existing.length >= MAX_ACTIVITY_POINTS) {
        return NextResponse.json({ error: "Activity point cap reached" }, { status: 413 });
      }
      const [point] = await db
        .insert(activityPoints)
        .values({
          activityId: id,
          lat: coords.lat,
          lng: coords.lng,
          elevation: body.elevation ?? null,
          recordedAt: new Date(recordedAt),
        })
        .returning();
      return NextResponse.json(point);
    }

    const existing = await listActivityPoints(id);
    if (existing.length >= MAX_ACTIVITY_POINTS) {
      return NextResponse.json({ error: "Activity point cap reached" }, { status: 413 });
    }
    const point = await addActivityPoint({
      activityId: id,
      lat: coords.lat,
      lng: coords.lng,
      elevation: body.elevation ?? null,
      recordedAt,
    });
    return NextResponse.json(point);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save point" },
      { status: 500 },
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (hasDatabase()) {
      const db = getDb();
      const points = await db.query.activityPoints.findMany({
        where: eq(activityPoints.activityId, id),
        orderBy: (p, { asc }) => [asc(p.recordedAt)],
      });
      return NextResponse.json({ points });
    }

    const points = await listActivityPoints(id);
    return NextResponse.json({ points });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load points" },
      { status: 500 },
    );
  }
}
