import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, latLngPointSchema, parseJsonBody } from "@/lib/api/validation";
import { requireOwner } from "@/lib/auth/owner";
import { addActivityPoint, getActivity, listActivityPoints } from "@/lib/store/local";

const pointSchema = latLngPointSchema.extend({
  elevation: z.number().finite().nullable().optional(),
  recordedAt: isoDatetimeSchema,
});
const pointRequestSchema = z.union([
  pointSchema,
  z.object({ points: z.array(pointSchema).min(1).max(500) }),
]);

/**
 * Points have no owner column of their own; they belong to whoever owns the parent
 * activity. Every read and write here resolves that first, so an unknown or
 * someone-else's activity is a 404 before any point is touched.
 */
async function ownsActivity(id: string, ownerId: string): Promise<boolean> {
  if (hasDatabase()) {
    const row = await getDb().query.activities.findFirst({
      where: and(eq(activities.id, id), eq(activities.ownerId, ownerId)),
    });
    return Boolean(row);
  }
  return Boolean(await getActivity(id, ownerId));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  const parsed = await parseJsonBody(request, pointRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const points = "points" in body ? body.points : [body];

  try {
    if (!(await ownsActivity(id, owner.ownerId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (hasDatabase()) {
      const db = getDb();
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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  try {
    // An unknown activity must 404 rather than return an empty array — "no points"
    // reads as "the recording captured nothing", which is a different fact entirely.
    // An activity owned by someone else is indistinguishable from an unknown one.
    if (!(await ownsActivity(id, owner.ownerId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (hasDatabase()) {
      const points = await getDb().query.activityPoints.findMany({
        where: eq(activityPoints.activityId, id),
        orderBy: (p, { asc }) => [asc(p.recordedAt)],
      });
      return NextResponse.json({ points });
    }
    return NextResponse.json({ points: await listActivityPoints(id) });
  } catch (error) {
    return errorResponse(error, "Failed to load points");
  }
}
