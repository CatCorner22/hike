import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints } from "@/lib/db/schema";
import { coordsToLineString } from "@/lib/geo";
import {
  getActivity,
  listActivityPoints,
  updateActivity,
} from "@/lib/store/local";
import { parseJson, updateActivitySchema } from "@/lib/api/validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (hasDatabase()) {
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

    const activity = await getActivity(id);
    if (!activity) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const points = await listActivityPoints(id);
    return NextResponse.json({ activity, points });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load activity" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const parsed = await parseJson(request, updateActivitySchema);
    if (!parsed.success) return parsed.response;
    const body = parsed.data;
    const existing = hasDatabase()
      ? await getDb().query.activities.findFirst({
          where: eq(activities.id, id),
        })
      : await getActivity(id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const points = hasDatabase()
      ? await getDb().query.activityPoints.findMany({
          where: eq(activityPoints.activityId, id),
          orderBy: (p, { asc }) => [asc(p.recordedAt)],
        })
      : await listActivityPoints(id);

    const trackGeometry =
      points.length >= 2
        ? coordsToLineString(points.map((p) => ({ lat: p.lat, lng: p.lng })))
        : null;

    if (hasDatabase()) {
      const db = getDb();
      const [updated] = await db
        .update(activities)
        .set({
          endedAt:
            body.endedAt === undefined
              ? undefined
              : body.endedAt
                ? new Date(body.endedAt)
                : null,
          stats: body.stats,
          notes: body.notes,
          trackGeometry,
        })
        .where(eq(activities.id, id))
        .returning();
      if (!updated) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(updated);
    }

    const updated = await updateActivity(id, {
      ...body,
      trackGeometry,
    });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update activity" },
      { status: 500 },
    );
  }
}
