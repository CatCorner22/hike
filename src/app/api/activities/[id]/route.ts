import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints } from "@/lib/db/schema";
import { coordsToLineString } from "@/lib/geo";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const db = getDb();

  const activity = await db.query.activities.findFirst({
    where: eq(activities.id, id),
  });

  if (!activity) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const points = await db.query.activityPoints.findMany({
    where: eq(activityPoints.activityId, id),
    orderBy: (p, { asc }) => [asc(p.recordedAt)],
  });

  return NextResponse.json({ activity, points });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const body = await request.json();
  const db = getDb();

  const points = await db.query.activityPoints.findMany({
    where: eq(activityPoints.activityId, id),
    orderBy: (p, { asc }) => [asc(p.recordedAt)],
  });

  const trackGeometry =
    points.length >= 2
      ? coordsToLineString(points.map((p) => ({ lat: p.lat, lng: p.lng })))
      : null;

  const [updated] = await db
    .update(activities)
    .set({
      endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
      stats: body.stats,
      notes: body.notes,
      trackGeometry,
    })
    .where(eq(activities.id, id))
    .returning();

  return NextResponse.json(updated);
}
