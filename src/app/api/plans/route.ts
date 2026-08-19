import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { hikePlans } from "@/lib/db/schema";

export async function GET() {
  if (!hasDatabase()) {
    return NextResponse.json({ plans: [] });
  }

  const db = getDb();
  const plans = await db.query.hikePlans.findMany({
    orderBy: [desc(hikePlans.updatedAt)],
    limit: 50,
  });

  return NextResponse.json({ plans });
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

  const [plan] = await db
    .insert(hikePlans)
    .values({
      name: body.name,
      trailId: body.trailId ?? null,
      plannedDate: body.plannedDate ? new Date(body.plannedDate) : null,
      notes: body.notes ?? null,
      waypoints: body.waypoints ?? null,
      campgroundIds: body.campgroundIds ?? [],
      customGeometry: body.customGeometry ?? null,
    })
    .returning();

  return NextResponse.json(plan);
}

