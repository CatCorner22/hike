import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, parseJsonBody } from "@/lib/api/validation";
import { requireOwner } from "@/lib/auth/owner";
import { createActivity, listActivities } from "@/lib/store/local";

const activityCreateSchema = z.object({
  trailId: z.string().uuid().nullable().optional(),
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
      return NextResponse.json({ activities: rows });
    }
    return NextResponse.json({ activities: await listActivities(owner.ownerId) });
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
  try {
    if (hasDatabase()) {
      const db = getDb();
      const [activity] = await db.insert(activities).values({
        ownerId: owner.ownerId,
        trailId: body.trailId ?? null,
        planId: body.planId ?? null,
        name: body.name ?? null,
        startedAt: new Date(startedAt),
        stats: {},
      }).returning();
      return NextResponse.json(activity);
    }
    return NextResponse.json(await createActivity({
      ownerId: owner.ownerId,
      trailId: body.trailId ?? null,
      planId: body.planId ?? null,
      name: body.name ?? null,
      startedAt,
    }));
  } catch (error) {
    return errorResponse(error, "Failed to start activity");
  }
}
