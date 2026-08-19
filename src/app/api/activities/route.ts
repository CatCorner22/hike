import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { activities } from "@/lib/db/schema";
import { createActivity, listActivities } from "@/lib/store/local";

export async function GET() {
  try {
    if (hasDatabase()) {
      const db = getDb();
      const rows = await db.query.activities.findMany({
        orderBy: [desc(activities.startedAt)],
        limit: 50,
      });
      return NextResponse.json({ activities: rows });
    }

    const rows = await listActivities();
    return NextResponse.json({ activities: rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list activities" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const startedAt = body.startedAt || new Date().toISOString();

    if (hasDatabase()) {
      const db = getDb();
      const [activity] = await db
        .insert(activities)
        .values({
          trailId: body.trailId ?? null,
          planId: body.planId ?? null,
          name: body.name ?? null,
          startedAt: new Date(startedAt),
          stats: {},
        })
        .returning();
      return NextResponse.json(activity);
    }

    const activity = await createActivity({
      trailId: body.trailId ?? null,
      planId: body.planId ?? null,
      name: body.name ?? null,
      startedAt,
    });
    return NextResponse.json(activity);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start activity" },
      { status: 500 },
    );
  }
}
