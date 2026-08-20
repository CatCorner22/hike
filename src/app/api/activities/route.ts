import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, parseJsonBody } from "@/lib/api/validation";
import { createActivity, listActivities } from "@/lib/store/local";

const activityCreateSchema = z.object({
  trailId: z.string().uuid().nullable().optional(),
  planId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200).nullable().optional(),
  startedAt: isoDatetimeSchema.optional(),
});

export async function GET() {
  try {
    if (hasDatabase()) {
      const db = getDb();
      // TODO(auth): constrain this query to activities owned by the authenticated user.
      const rows = await db.query.activities.findMany({ orderBy: [desc(activities.startedAt)], limit: 50 });
      return NextResponse.json({ activities: rows });
    }
    return NextResponse.json({ activities: await listActivities() });
  } catch (error) {
    return errorResponse(error, "Failed to list activities");
  }
}

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, activityCreateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const startedAt = body.startedAt ?? new Date().toISOString();
  try {
    if (hasDatabase()) {
      const db = getDb();
      // TODO(auth): assign the authenticated user as the activity owner.
      const [activity] = await db.insert(activities).values({
        trailId: body.trailId ?? null,
        planId: body.planId ?? null,
        name: body.name ?? null,
        startedAt: new Date(startedAt),
        stats: {},
      }).returning();
      return NextResponse.json(activity);
    }
    return NextResponse.json(await createActivity({
      trailId: body.trailId ?? null,
      planId: body.planId ?? null,
      name: body.name ?? null,
      startedAt,
    }));
  } catch (error) {
    return errorResponse(error, "Failed to start activity");
  }
}
