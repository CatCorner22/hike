import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, parseJsonBody, trailRefSchema } from "@/lib/api/validation";
import { requireOwner } from "@/lib/auth/owner";
import { createActivity, listActivities } from "@/lib/store/local";
import { postgresTrailFk, resolveStoredTrailId } from "@/lib/trails/service";

const activityCreateSchema = z.object({
  trailId: trailRefSchema.nullable().optional(),
  planId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200).nullable().optional(),
  startedAt: isoDatetimeSchema.optional(),
});

export async function GET(request: Request) {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  try {
    if (hasDatabase()) {
      const db = getDb();
      const rows = await db.query.activities.findMany({
        where: eq(activities.ownerId, owner.ownerId),
        orderBy: [desc(activities.startedAt)],
        limit: 50,
      });
      const openActivities = await db.query.activities.findMany({
        where: and(eq(activities.ownerId, owner.ownerId), isNull(activities.endedAt)),
        orderBy: [desc(activities.startedAt)],
      });
      return NextResponse.json({ activities: rows, openActivities });
    }
    const activityHistory = await listActivities(owner.ownerId);
    return NextResponse.json({
      activities: activityHistory,
      // Kept separate from the bounded history so an older abandoned recording remains
      // visible to a recovering client instead of silently leaving a server activity open.
      openActivities: activityHistory.filter((activity) => activity.endedAt === null),
    });
  } catch (error) {
    return errorResponse(error, "Failed to list activities");
  }
}

export async function POST(request: Request) {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  const parsed = await parseJsonBody(request, activityCreateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const startedAt = body.startedAt ?? new Date().toISOString();
  const trailId = await resolveStoredTrailId(body.trailId ?? null);
  try {
    if (hasDatabase()) {
      const db = getDb();
      const [activity] = await db.insert(activities).values({
        ownerId: owner.ownerId,
        trailId: postgresTrailFk(trailId),
        planId: body.planId ?? null,
        name: body.name ?? null,
        startedAt: new Date(startedAt),
        stats: {},
      }).returning();
      return NextResponse.json(activity);
    }
    return NextResponse.json(await createActivity({
      ownerId: owner.ownerId,
      trailId,
      planId: body.planId ?? null,
      name: body.name ?? null,
      startedAt,
    }));
  } catch (error) {
    return errorResponse(error, "Failed to start activity");
  }
}
