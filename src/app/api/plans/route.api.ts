import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { hikePlans } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import {
  geoJsonLineOrMultiLineStringSchema,
  isoDatetimeSchema,
  parseJsonBody,
  trailRefSchema,
  waypointsSchema,
} from "@/lib/api/validation";
import { requireOwner } from "@/lib/auth/owner";
import { createPlan, listPlans } from "@/lib/store/local";
import { postgresTrailFk, resolveStoredTrailId } from "@/lib/trails/service";

const planCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trailId: trailRefSchema.nullable().optional(),
  plannedDate: isoDatetimeSchema.nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  waypoints: waypointsSchema.nullable().optional(),
  campgroundIds: z.array(z.string().min(1)).max(100).optional(),
  customGeometry: geoJsonLineOrMultiLineStringSchema.nullable().optional(),
});

export async function GET(request: Request) {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  try {
    if (hasDatabase()) {
      const db = getDb();
      const plans = await db.query.hikePlans.findMany({
        where: eq(hikePlans.ownerId, owner.ownerId),
        orderBy: [desc(hikePlans.updatedAt)],
        limit: 50,
      });
      return NextResponse.json({ plans });
    }

    const plans = await listPlans(owner.ownerId);
    return NextResponse.json({ plans: plans.slice(0, 50) });
  } catch (error) {
    return errorResponse(error, "Failed to list plans");
  }
}

export async function POST(request: Request) {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  const parsed = await parseJsonBody(request, planCreateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const requestedTrailId = body.trailId ?? null;
  const trailId = await resolveStoredTrailId(requestedTrailId);
  if (requestedTrailId && !trailId && !body.customGeometry) {
    return NextResponse.json(
      { error: "That trail could not be loaded. Search again or import a GPX." },
      { status: 404 },
    );
  }

  try {
    if (hasDatabase()) {
      const db = getDb();
      const [plan] = await db.insert(hikePlans).values({
        ownerId: owner.ownerId,
        name: body.name,
        trailId: postgresTrailFk(trailId),
        plannedDate: body.plannedDate ? new Date(body.plannedDate) : null,
        notes: body.notes ?? null,
        waypoints: body.waypoints ?? null,
        campgroundIds: body.campgroundIds ?? [],
        customGeometry: body.customGeometry ?? null,
      }).returning();
      return NextResponse.json(plan);
    }

    return NextResponse.json(await createPlan({
      ownerId: owner.ownerId,
      name: body.name,
      trailId,
      plannedDate: body.plannedDate ?? null,
      notes: body.notes ?? null,
      waypoints: body.waypoints ?? null,
      campgroundIds: body.campgroundIds ?? [],
      customGeometry: body.customGeometry ?? null,
    }));
  } catch (error) {
    return errorResponse(error, "Failed to create plan");
  }
}
