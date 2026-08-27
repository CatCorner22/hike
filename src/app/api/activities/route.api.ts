import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, hikePlans } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, parseJsonBody, trailRefSchema } from "@/lib/api/validation";
import { requireOwner } from "@/lib/auth/owner";
import {
  ActivityIdCollisionError,
  createActivity,
  getPlan,
  listActivities,
  replayActivityCreate,
} from "@/lib/store/local";
import { postgresTrailFk, resolveStoredTrailId } from "@/lib/trails/service";

const activityCreateSchema = z.object({
  clientActivityId: z.string().uuid().optional(),
  trailId: trailRefSchema.nullable().optional(),
  planId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200).nullable().optional(),
  startedAt: isoDatetimeSchema.optional(),
});

function activityIdCollisionResponse() {
  return NextResponse.json(
    { error: "Activity could not be started with that idempotency key" },
    { status: 409 },
  );
}

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
      activities: activityHistory.slice(0, 50),
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
  try {
    // Replay before resolving trail metadata: an idempotent retry must return the
    // committed row unchanged and must not perform new side effects from a changed body.
    if (body.clientActivityId) {
      if (hasDatabase()) {
        const existing = await getDb().query.activities.findFirst({
          where: eq(activities.id, body.clientActivityId),
        });
        if (existing) {
          return existing.ownerId === owner.ownerId
            ? NextResponse.json(existing)
            : activityIdCollisionResponse();
        }
      } else {
        const replay = await replayActivityCreate(body.clientActivityId, owner.ownerId);
        if (replay.status === "owned") return NextResponse.json(replay.activity);
        if (replay.status === "collision") return activityIdCollisionResponse();
      }
    }

    const trailId = await resolveStoredTrailId(body.trailId ?? null);
    if (body.planId) {
      // A missing or foreign plan used to 500 on the Postgres FK (or store
      // silently on the JSON fallback). Ownership is required: accepting
      // another owner's plan id would also leak whether that id exists.
      const owned = hasDatabase()
        ? await getDb().query.hikePlans.findFirst({
            where: and(eq(hikePlans.id, body.planId), eq(hikePlans.ownerId, owner.ownerId)),
          })
        : await getPlan(body.planId, owner.ownerId);
      if (!owned) {
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
      }
    }
    if (hasDatabase()) {
      const db = getDb();
      const values = {
        ...(body.clientActivityId ? { id: body.clientActivityId } : {}),
        ownerId: owner.ownerId,
        trailId: postgresTrailFk(trailId),
        planId: body.planId ?? null,
        name: body.name ?? null,
        startedAt: new Date(startedAt),
        stats: {},
      };
      if (body.clientActivityId) {
        const [activity] = await db
          .insert(activities)
          .values(values)
          .onConflictDoNothing({ target: activities.id })
          .returning();
        if (activity) return NextResponse.json(activity);

        // Another instance may have won after the replay lookup. Re-read the winner
        // and apply the same owner boundary instead of turning the safe retry into 500.
        const winner = await db.query.activities.findFirst({
          where: eq(activities.id, body.clientActivityId),
        });
        if (winner?.ownerId === owner.ownerId) return NextResponse.json(winner);
        return activityIdCollisionResponse();
      }
      const [activity] = await db.insert(activities).values(values).returning();
      return NextResponse.json(activity);
    }
    return NextResponse.json(await createActivity({
      ownerId: owner.ownerId,
      clientActivityId: body.clientActivityId,
      trailId,
      planId: body.planId ?? null,
      name: body.name ?? null,
      startedAt,
    }));
  } catch (error) {
    if (error instanceof ActivityIdCollisionError) return activityIdCollisionResponse();
    return errorResponse(error, "Failed to start activity");
  }
}
