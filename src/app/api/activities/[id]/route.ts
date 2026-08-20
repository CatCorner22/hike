import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, parseJsonBody } from "@/lib/api/validation";
import { coordsToLineString } from "@/lib/geo";
import { getActivity, listActivityPoints, updateActivity } from "@/lib/store/local";
import { notFoundResponse, ownerIdFromRequest, ownerUnavailableResponse, withoutOwner } from "@/lib/api/ownership";

// Measurements may be fractional; range bounds plus parseJsonBody's
// pre-parse unsafe-integer guard protect precision without forcing integers.
const boundedStat = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const activityPatchSchema = z.object({
  endedAt: isoDatetimeSchema.nullable().optional(),
  stats: z.object({
    distanceMeters: boundedStat.nonnegative().optional(),
    elevationGainMeters: boundedStat.nonnegative().optional(),
    durationSeconds: boundedStat.nonnegative().optional(),
    maxSpeedMps: boundedStat.nonnegative().optional(),
    avgSpeedMps: boundedStat.nonnegative().optional(),
  }).strict().nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
  const { id } = await params;
  try {
    if (hasDatabase()) {
      const db = getDb();
      const activity = await db.query.activities.findFirst({ where: and(eq(activities.id, id), eq(activities.ownerId, ownerId)) });
      if (!activity) return notFoundResponse();
      const points = await db.query.activityPoints.findMany({
        where: and(eq(activityPoints.activityId, id), eq(activityPoints.ownerId, ownerId)),
        orderBy: (p, { asc }) => [asc(p.recordedAt), asc(p.id)],
        limit: 500,
      });
      return NextResponse.json({ activity: withoutOwner(activity), points: points.map(withoutOwner) });
    }
    const activity = await getActivity(id, ownerId);
    if (!activity) return notFoundResponse();
    return NextResponse.json({ activity: withoutOwner(activity), points: (await listActivityPoints(id, ownerId)).slice(0, 500).map(withoutOwner) });
  } catch (error) {
    return errorResponse(error, "Failed to load activity");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
  const { id } = await params;
  const parsed = await parseJsonBody(request, activityPatchSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const activity = hasDatabase()
      ? await getDb().query.activities.findFirst({ where: and(eq(activities.id, id), eq(activities.ownerId, ownerId)) })
      : await getActivity(id, ownerId);
    if (!activity) return notFoundResponse();
    const points = hasDatabase()
      ? await getDb().query.activityPoints.findMany({
          where: and(eq(activityPoints.activityId, id), eq(activityPoints.ownerId, ownerId)),
          orderBy: (p, { asc }) => [asc(p.recordedAt), asc(p.id)],
          limit: 10_000,
        })
      : await listActivityPoints(id, ownerId);
    const trackGeometry = points.length >= 2
      ? coordsToLineString(points.map((p) => ({ lat: p.lat, lng: p.lng })))
      : null;

    if (hasDatabase()) {
      const values: Partial<typeof activities.$inferInsert> = { trackGeometry };
      if ("endedAt" in body) values.endedAt = body.endedAt ? new Date(body.endedAt) : null;
      if ("stats" in body) values.stats = body.stats;
      if ("notes" in body) values.notes = body.notes;
      const db = getDb();
      const [updated] = await db.update(activities).set(values).where(and(eq(activities.id, id), eq(activities.ownerId, ownerId))).returning();
      if (!updated) return notFoundResponse();
      return NextResponse.json(withoutOwner(updated));
    }

    const updates: Parameters<typeof updateActivity>[2] = { trackGeometry };
    if ("endedAt" in body) updates.endedAt = body.endedAt;
    if ("stats" in body) updates.stats = body.stats;
    if ("notes" in body) updates.notes = body.notes;
    const updated = await updateActivity(id, ownerId, updates);
    if (!updated) return notFoundResponse();
    return NextResponse.json(withoutOwner(updated));
  } catch (error) {
    return errorResponse(error, "Failed to update activity");
  }
}
