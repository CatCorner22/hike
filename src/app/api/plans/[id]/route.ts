import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { hikePlans } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import {
  geoJsonLineOrMultiLineStringSchema,
  isoDatetimeSchema,
  parseJsonBody,
} from "@/lib/api/validation";
import { deletePlan, getPlan, updatePlan } from "@/lib/store/local";

const planPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  trailId: z.string().uuid().nullable().optional(),
  plannedDate: isoDatetimeSchema.nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  waypoints: z.unknown().nullable().optional(),
  campgroundIds: z.array(z.string().min(1)).max(100).nullable().optional(),
  customGeometry: geoJsonLineOrMultiLineStringSchema.nullable().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (hasDatabase()) {
      const db = getDb();
      // TODO(auth): verify that the authenticated user owns this plan.
      const plan = await db.query.hikePlans.findFirst({ where: eq(hikePlans.id, id) });
      if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(plan);
    }
    const plan = await getPlan(id);
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(plan);
  } catch (error) {
    return errorResponse(error, "Failed to load plan");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(request, planPatchSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    if (hasDatabase()) {
      const values: Partial<typeof hikePlans.$inferInsert> = { updatedAt: new Date() };
      if ("name" in body) values.name = body.name;
      if ("trailId" in body) values.trailId = body.trailId;
      if ("plannedDate" in body) values.plannedDate = body.plannedDate ? new Date(body.plannedDate) : null;
      if ("notes" in body) values.notes = body.notes;
      if ("waypoints" in body) values.waypoints = body.waypoints;
      if ("campgroundIds" in body) values.campgroundIds = body.campgroundIds;
      if ("customGeometry" in body) values.customGeometry = body.customGeometry;

      const db = getDb();
      // TODO(auth): limit this update to a plan owned by the authenticated user.
      const [plan] = await db.update(hikePlans).set(values).where(eq(hikePlans.id, id)).returning();
      if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(plan);
    }

    const updates: Parameters<typeof updatePlan>[1] = {};
    if ("name" in body) updates.name = body.name;
    if ("trailId" in body) updates.trailId = body.trailId;
    if ("plannedDate" in body) updates.plannedDate = body.plannedDate;
    if ("notes" in body) updates.notes = body.notes;
    if ("waypoints" in body) updates.waypoints = body.waypoints;
    if ("campgroundIds" in body) updates.campgroundIds = body.campgroundIds ?? [];
    if ("customGeometry" in body) updates.customGeometry = body.customGeometry;
    const plan = await updatePlan(id, updates);
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(plan);
  } catch (error) {
    return errorResponse(error, "Failed to update plan");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (hasDatabase()) {
      const db = getDb();
      // TODO(auth): limit this deletion to a plan owned by the authenticated user.
      await db.delete(hikePlans).where(eq(hikePlans.id, id));
      return NextResponse.json({ success: true });
    }
    await deletePlan(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, "Failed to delete plan");
  }
}
