import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { withActivityMutation } from "@/lib/db/activity-mutation";
import { activities, activityPoints } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, parseJsonBody } from "@/lib/api/validation";
import { coordsToLineString } from "@/lib/geo";
import { requireOwner } from "@/lib/auth/owner";
import { getActivity, listActivityPoints, updateActivity } from "@/lib/store/local";
import { downsampleActivityPoints } from "@/lib/activities/display-points";

const activityPatchSchema = z.object({
  endedAt: isoDatetimeSchema.nullable().optional(),
  stats: z.record(z.string(), z.number().finite()).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
}).refine((body) => "endedAt" in body || "stats" in body || "notes" in body, {
  message: "At least one of endedAt, stats, or notes is required.",
});

/**
 * The detail screen draws a single track line, so it does not need every fix
 * from a multi-day recording — and shipping hundreds of thousands of points to
 * a phone to render a few hundred pixels of polyline is wasteful and slow.
 *
 * Keep the endpoints and take an even stride through the middle, then report the
 * true count and whether the response was reduced. Callers that need full
 * fidelity page through /api/activities/:id/points.
 */
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
      const display = downsampleActivityPoints(points);
      const trackGeometry = display.points.length >= 2
        ? coordsToLineString(display.points.map((point) => ({ lat: point.lat, lng: point.lng })))
        : null;
      // trackGeometry is a cache, not evidence. Deriving it from the authoritative
      // points on read prevents a late, accepted fix from disappearing from the line a
      // hiker reviews even if an older deployment left a stale cache behind.
      return NextResponse.json({
        activity: { ...activity, trackGeometry },
        ...display,
      });
    }
    const activity = await getActivity(id, owner.ownerId);
    if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const points = await listActivityPoints(id);
    const display = downsampleActivityPoints(points);
    const trackGeometry = display.points.length >= 2
      ? coordsToLineString(display.points.map((point) => ({ lat: point.lat, lng: point.lng })))
      : null;
    return NextResponse.json({
      activity: { ...activity, trackGeometry },
      ...display,
    });
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
    return await withActivityMutation(id, async () => {
      // Ownership is checked before mutation: an outsider must not be able to learn
      // anything about a track, including whether it is currently being recorded.
      const ownsActivity = hasDatabase()
        ? Boolean(
            await getDb().query.activities.findFirst({
              where: and(eq(activities.id, id), eq(activities.ownerId, owner.ownerId)),
            }),
          )
        : Boolean(await getActivity(id, owner.ownerId));
      if (!ownsActivity) return NextResponse.json({ error: "Not found" }, { status: 404 });

      if (hasDatabase()) {
        const values: Partial<typeof activities.$inferInsert> = {};
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

      const updates: Parameters<typeof updateActivity>[2] = {};
      if ("endedAt" in body) updates.endedAt = body.endedAt;
      if ("stats" in body) updates.stats = body.stats;
      if ("notes" in body) updates.notes = body.notes;
      const updated = await updateActivity(id, owner.ownerId, updates);
      if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(updated);
    });
  } catch (error) {
    return errorResponse(error, "Failed to update activity");
  }
}
