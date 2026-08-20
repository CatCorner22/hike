import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
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
import { deletePlan, getPlan, updatePlan } from "@/lib/store/local";
import { notFoundResponse, ownerIdFromRequest, ownerUnavailableResponse, withoutOwner } from "@/lib/api/ownership";

const planPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  trailId: z.string().uuid().nullable().optional(),
  plannedDate: isoDatetimeSchema.nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  waypoints: waypointsSchema.nullable().optional(),
  campgroundIds: z.array(z.string().min(1)).max(100).nullable().optional(),
  customGeometry: geoJsonLineOrMultiLineStringSchema.nullable().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
  const { id } = await params;
  try {
    if (hasDatabase()) {
      const db = getDb();
      const plan = await db.query.hikePlans.findFirst({ where: and(eq(hikePlans.id, id), eq(hikePlans.ownerId, ownerId)) });
      if (!plan) return notFoundResponse();
      return NextResponse.json(withoutOwner(plan));
    }
    const plan = await getPlan(id, ownerId);
    if (!plan) return notFoundResponse();
    return NextResponse.json(withoutOwner(plan));
  } catch (error) {
    return errorResponse(error, "Failed to load plan");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
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
      const [plan] = await db.update(hikePlans).set(values).where(and(eq(hikePlans.id, id), eq(hikePlans.ownerId, ownerId))).returning();
      if (!plan) return notFoundResponse();
      return NextResponse.json(withoutOwner(plan));
    }

    const updates: Parameters<typeof updatePlan>[2] = {};
    if ("name" in body) updates.name = body.name;
    if ("trailId" in body) updates.trailId = body.trailId;
    if ("plannedDate" in body) updates.plannedDate = body.plannedDate;
    if ("notes" in body) updates.notes = body.notes;
    if ("waypoints" in body) updates.waypoints = body.waypoints;
    if ("campgroundIds" in body) updates.campgroundIds = body.campgroundIds ?? [];
    if ("customGeometry" in body) updates.customGeometry = body.customGeometry;
    const plan = await updatePlan(id, ownerId, updates);
    if (!plan) return notFoundResponse();
    return NextResponse.json(withoutOwner(plan));
  } catch (error) {
    return errorResponse(error, "Failed to update plan");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
  const { id } = await params;
  try {
    if (hasDatabase()) {
      const db = getDb();
      const deleted = await db.delete(hikePlans).where(and(eq(hikePlans.id, id), eq(hikePlans.ownerId, ownerId))).returning({ id: hikePlans.id });
      if (deleted.length === 0) return notFoundResponse();
      return NextResponse.json({ success: true });
    }
    if (!await deletePlan(id, ownerId)) return notFoundResponse();
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, "Failed to delete plan");
  }
}
