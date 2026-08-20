import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, parseJsonBody } from "@/lib/api/validation";
import { coordsToLineString } from "@/lib/geo";
import { requireOwner } from "@/lib/auth/owner";
import { getActivity, listActivityPoints, updateActivity } from "@/lib/store/local";

const activityPatchSchema = z.object({
  endedAt: isoDatetimeSchema.nullable().optional(),
  stats: z.record(z.string(), z.number().finite()).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  try {
    if (hasDatabase()) {
      const db = getDb();
      const activity = await db.query.activities.findFirst({
        where: and(eq(activities.id, id), eq(activities.ownerId, owner.ownerId)),
      });
      if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const points = await db.query.activityPoints.findMany({
        where: eq(activityPoints.activityId, id),
        orderBy: (p, { asc }) => [asc(p.recordedAt)],
      });
      return NextResponse.json({ activity, points });
    }
    const activity = await getActivity(id, owner.ownerId);
    if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ activity, points: await listActivityPoints(id) });
  } catch (error) {
    return errorResponse(error, "Failed to load activity");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  const parsed = await parseJsonBody(request, activityPatchSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    // Ownership is checked before the points are read: an outsider must not be able to
    // learn anything about a track, including how many points it has.
    const ownsActivity = hasDatabase()
      ? Boolean(
          await getDb().query.activities.findFirst({
            where: and(eq(activities.id, id), eq(activities.ownerId, owner.ownerId)),
          }),
        )
      : Boolean(await getActivity(id, owner.ownerId));
    if (!ownsActivity) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const points = hasDatabase()
      ? await getDb().query.activityPoints.findMany({
          where: eq(activityPoints.activityId, id),
          orderBy: (p, { asc }) => [asc(p.recordedAt)],
        })
      : await listActivityPoints(id);
    const trackGeometry = points.length >= 2
      ? coordsToLineString(points.map((p) => ({ lat: p.lat, lng: p.lng })))
      : null;

    if (hasDatabase()) {
      const values: Partial<typeof activities.$inferInsert> = { trackGeometry };
      if ("endedAt" in body) values.endedAt = body.endedAt ? new Date(body.endedAt) : null;
      if ("stats" in body) values.stats = body.stats;
      if ("notes" in body) values.notes = body.notes;
      const db = getDb();
      const [updated] = await db
        .update(activities)
        .set(values)
        .where(and(eq(activities.id, id), eq(activities.ownerId, owner.ownerId)))
        .returning();
      if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(updated);
    }

    const updates: Parameters<typeof updateActivity>[2] = { trackGeometry };
    if ("endedAt" in body) updates.endedAt = body.endedAt;
    if ("stats" in body) updates.stats = body.stats;
    if ("notes" in body) updates.notes = body.notes;
    const updated = await updateActivity(id, owner.ownerId, updates);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, "Failed to update activity");
  }
}
