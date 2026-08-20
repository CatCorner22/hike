import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { hikePlans } from "@/lib/db/schema";
import { createPlan, listPlans } from "@/lib/store/local";
import { createPlanSchema, parseJson } from "@/lib/api/validation";

export async function GET() {
  try {
    if (hasDatabase()) {
      const db = getDb();
      const plans = await db.query.hikePlans.findMany({
        orderBy: [desc(hikePlans.updatedAt)],
        limit: 50,
      });
      return NextResponse.json({ plans });
    }

    const plans = await listPlans();
    return NextResponse.json({ plans });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list plans" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const parsed = await parseJson(request, createPlanSchema);
    if (!parsed.success) return parsed.response;
    const body = parsed.data;

    if (hasDatabase()) {
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

    const plan = await createPlan({
      name: body.name,
      trailId: body.trailId ?? null,
      plannedDate: body.plannedDate ?? null,
      notes: body.notes ?? null,
      waypoints: body.waypoints ?? null,
      campgroundIds: body.campgroundIds ?? [],
      customGeometry: body.customGeometry ?? null,
    });
    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create plan" },
      { status: 500 },
    );
  }
}
