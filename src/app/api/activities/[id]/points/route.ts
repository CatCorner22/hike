import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, latLngPointSchema, parseJsonBody } from "@/lib/api/validation";
import { addActivityPoint, getActivity, listActivityPoints } from "@/lib/store/local";

const pointSchema = latLngPointSchema.extend({
  elevation: z.number().finite().nullable().optional(),
  recordedAt: isoDatetimeSchema,
});
const pointRequestSchema = z.union([
  pointSchema,
  z.object({ points: z.array(pointSchema).min(1).max(500) }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(request, pointRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const points = "points" in body ? body.points : [body];

  try {
    if (hasDatabase()) {
      const db = getDb();
      // TODO(auth): verify that the authenticated user owns this activity before inserting points.
      const saved = await db.insert(activityPoints).values(points.map((point) => ({
        activityId: id,
        lat: point.lat,
        lng: point.lng,
        elevation: point.elevation ?? null,
        recordedAt: new Date(point.recordedAt),
      }))).returning();
      return NextResponse.json("points" in body ? { points: saved } : saved[0]);
    }

    const saved = await Promise.all(points.map((point) => addActivityPoint({
      activityId: id,
      lat: point.lat,
      lng: point.lng,
      elevation: point.elevation ?? null,
      recordedAt: point.recordedAt,
    })));
    return NextResponse.json("points" in body ? { points: saved } : saved[0]);
  } catch (error) {
    return errorResponse(error, "Failed to save point");
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // An unknown activity must 404 rather than return an empty array — "no points"
    // reads as "the recording captured nothing", which is a different fact entirely.
    if (hasDatabase()) {
      const db = getDb();
      // TODO(auth): verify that the authenticated user owns this activity before reading points.
      const activity = await db.query.activities.findFirst({ where: eq(activities.id, id) });
      if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const points = await db.query.activityPoints.findMany({
        where: eq(activityPoints.activityId, id),
        orderBy: (p, { asc }) => [asc(p.recordedAt)],
      });
      return NextResponse.json({ points });
    }
    if (!(await getActivity(id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ points: await listActivityPoints(id) });
  } catch (error) {
    return errorResponse(error, "Failed to load points");
  }
}
