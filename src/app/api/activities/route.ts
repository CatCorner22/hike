import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, hikePlans } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, parseJsonBody } from "@/lib/api/validation";
import { createActivity, getPlan, listActivities } from "@/lib/store/local";
import { notFoundResponse, ownerIdFromRequest, ownerUnavailableResponse, withoutOwner } from "@/lib/api/ownership";

const activityCreateSchema = z.object({
  trailId: z.string().uuid().nullable().optional(),
  planId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200).nullable().optional(),
  startedAt: isoDatetimeSchema.optional(),
});

export async function GET(request: Request) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
  try {
    if (hasDatabase()) {
      const db = getDb();
      const rows = await db.query.activities.findMany({ where: eq(activities.ownerId, ownerId), orderBy: [desc(activities.startedAt)], limit: 50 });
      return NextResponse.json({ activities: rows.map(withoutOwner) });
    }
    return NextResponse.json({ activities: (await listActivities(ownerId)).map(withoutOwner) });
  } catch (error) {
    return errorResponse(error, "Failed to list activities");
  }
}

export async function POST(request: Request) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
  const parsed = await parseJsonBody(request, activityCreateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const startedAt = body.startedAt ?? new Date().toISOString();
  try {
    if (hasDatabase()) {
      const db = getDb();
      if (body.planId) {
        const plan = await db.query.hikePlans.findFirst({ where: and(eq(hikePlans.id, body.planId), eq(hikePlans.ownerId, ownerId)) });
        if (!plan) return notFoundResponse();
      }
      const [activity] = await db.insert(activities).values({
        ownerId,
        trailId: body.trailId ?? null,
        planId: body.planId ?? null,
        name: body.name ?? null,
        startedAt: new Date(startedAt),
        stats: {},
      }).returning();
      return NextResponse.json(withoutOwner(activity));
    }
    if (body.planId && !await getPlan(body.planId, ownerId)) return notFoundResponse();
    return NextResponse.json(withoutOwner(await createActivity({
      ownerId,
      trailId: body.trailId ?? null,
      planId: body.planId ?? null,
      name: body.name ?? null,
      startedAt,
    })));
  } catch (error) {
    return errorResponse(error, "Failed to start activity");
  }
}
