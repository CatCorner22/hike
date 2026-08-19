import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { activities } from "@/lib/db/schema";

export async function GET() {
  if (!hasDatabase()) {
    return NextResponse.json({ activities: [] });
  }

  const db = getDb();
  const rows = await db.query.activities.findMany({
    orderBy: [desc(activities.startedAt)],
    limit: 50,
  });

  return NextResponse.json({ activities: rows });
}

export async function POST(request: Request) {
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const body = await request.json();
  const db = getDb();

  const [activity] = await db
    .insert(activities)
    .values({
      trailId: body.trailId ?? null,
      planId: body.planId ?? null,
      name: body.name ?? null,
      startedAt: new Date(body.startedAt),
      stats: {},
    })
    .returning();

  return NextResponse.json(activity);
}
