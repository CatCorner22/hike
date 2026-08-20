import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { hikePlans } from "@/lib/db/schema";
import { createPlan, listPlans } from "@/lib/store/local";
import { z } from "zod";
import { isValidGeometry } from "@/lib/geo/navigation";

const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Invalid planned date",
});
const geometry = z.custom<GeoJSON.LineString | GeoJSON.MultiLineString>(
  isValidGeometry,
  "Invalid route geometry",
);

const createPlanSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trailId: z.string().max(200).nullish(),
  plannedDate: dateString.nullish(),
  notes: z.string().max(50_000).nullish(),
  waypoints: z.unknown().optional(),
  campgroundIds: z.array(z.string().max(200)).max(500).optional(),
  customGeometry: geometry.nullish(),
});

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
    const parsed = createPlanSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid plan", issues: parsed.error.issues },
        { status: 400 },
      );
    }
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
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create plan" },
      { status: 500 },
    );
  }
}
