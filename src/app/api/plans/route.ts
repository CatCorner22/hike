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
  waypointsSchema,
} from "@/lib/api/validation";
import { createPlan, listPlans } from "@/lib/store/local";
import { ownerIdFromRequest, ownerUnavailableResponse, withoutOwner } from "@/lib/api/ownership";

const planCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trailId: z.string().uuid().nullable().optional(),
  plannedDate: isoDatetimeSchema.nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  waypoints: waypointsSchema.nullable().optional(),
  campgroundIds: z.array(z.string().min(1)).max(100).optional(),
  customGeometry: geoJsonLineOrMultiLineStringSchema.nullable().optional(),
});

export async function GET(request: Request) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
  try {
    if (hasDatabase()) {
      const db = getDb();
      const plans = await db.query.hikePlans.findMany({
        where: eq(hikePlans.ownerId, ownerId),
        orderBy: [desc(hikePlans.updatedAt)],
        limit: 50,
      });
      return NextResponse.json({ plans: plans.map(withoutOwner) });
    }

    return NextResponse.json({ plans: (await listPlans(ownerId)).map(withoutOwner) });
  } catch (error) {
    return errorResponse(error, "Failed to list plans");
  }
}

export async function POST(request: Request) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
  const parsed = await parseJsonBody(request, planCreateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    if (hasDatabase()) {
      const db = getDb();
      const [plan] = await db.insert(hikePlans).values({
        ownerId,
        name: body.name,
        trailId: body.trailId ?? null,
        plannedDate: body.plannedDate ? new Date(body.plannedDate) : null,
        notes: body.notes ?? null,
        waypoints: body.waypoints ?? null,
        campgroundIds: body.campgroundIds ?? [],
        customGeometry: body.customGeometry ?? null,
      }).returning();
      return NextResponse.json(withoutOwner(plan));
    }

    return NextResponse.json(withoutOwner(await createPlan({
      ownerId,
      name: body.name,
      trailId: body.trailId ?? null,
      plannedDate: body.plannedDate ?? null,
      notes: body.notes ?? null,
      waypoints: body.waypoints ?? null,
      campgroundIds: body.campgroundIds ?? [],
      customGeometry: body.customGeometry ?? null,
    })));
  } catch (error) {
    return errorResponse(error, "Failed to create plan");
  }
}
