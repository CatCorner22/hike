import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { withActivityMutation } from "@/lib/db/activity-mutation";
import { hikePlans } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import {
  geoJsonLineOrMultiLineStringSchema,
  isoDatetimeSchema,
  parseJsonBody,
} from "@/lib/api/validation";
import { requireOwner } from "@/lib/auth/owner";
import { deletePlan, getPlan, updatePlan } from "@/lib/store/local";

const planPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  trailId: z.string().uuid().nullable().optional(),
  plannedDate: isoDatetimeSchema.nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  waypoints: z.unknown().nullable().optional(),
  campgroundIds: z.array(z.string().min(1)).max(100).nullable().optional(),
  customGeometry: geoJsonLineOrMultiLineStringSchema.nullable().optional(),
  // The edit page sends the revision it received with its full snapshot.
  updatedAt: isoDatetimeSchema.optional(),
});

// Someone else's plan answers 404, not 403: a 403 would confirm the id exists, which
// is itself a disclosure when the ids are the only thing standing between an outsider
// and a stranger's route and GPS history.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  try {
    if (hasDatabase()) {
      const db = getDb();
      const plan = await db.query.hikePlans.findFirst({
        where: and(eq(hikePlans.id, id), eq(hikePlans.ownerId, owner.ownerId)),
      });
      if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(plan);
    }
    const plan = await getPlan(id, owner.ownerId);
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(plan);
  } catch (error) {
    return errorResponse(error, "Failed to load plan");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  const parsed = await parseJsonBody(request, planPatchSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    return await withActivityMutation(`plan:${id}`, async () => {
      if (hasDatabase()) {
        const db = getDb();
        const current = await db.query.hikePlans.findFirst({
          where: and(eq(hikePlans.id, id), eq(hikePlans.ownerId, owner.ownerId)),
        });
        if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (!body.updatedAt) {
          return NextResponse.json(
            { error: "Plan update conflict: send the plan's current updatedAt revision" },
            { status: 409 },
          );
        }
        if (current.updatedAt.getTime() !== new Date(body.updatedAt).getTime()) {
          return NextResponse.json(
            { error: "Plan update conflict: the plan changed in another tab", plan: current },
            { status: 409 },
          );
        }
        const values: Partial<typeof hikePlans.$inferInsert> = { updatedAt: new Date() };
        if ("name" in body) values.name = body.name;
        if ("trailId" in body) values.trailId = body.trailId;
        if ("plannedDate" in body) values.plannedDate = body.plannedDate ? new Date(body.plannedDate) : null;
        if ("notes" in body) values.notes = body.notes;
        if ("waypoints" in body) values.waypoints = body.waypoints;
        if ("campgroundIds" in body) values.campgroundIds = body.campgroundIds;
        if ("customGeometry" in body) values.customGeometry = body.customGeometry;

        const [plan] = await db
          .update(hikePlans)
          .set(values)
          // Compare the exact database value read above, not the JSON-millisecond value:
          // PostgreSQL may retain microseconds that a browser's ISO string cannot carry.
          .where(and(
            eq(hikePlans.id, id),
            eq(hikePlans.ownerId, owner.ownerId),
            eq(hikePlans.updatedAt, current.updatedAt),
          ))
          .returning();
        if (!plan) {
          const latest = await db.query.hikePlans.findFirst({
            where: and(eq(hikePlans.id, id), eq(hikePlans.ownerId, owner.ownerId)),
          });
          return NextResponse.json(
            { error: "Plan update conflict: the plan changed in another tab", plan: latest },
            { status: 409 },
          );
        }
        return NextResponse.json(plan);
      }

      const current = await getPlan(id, owner.ownerId);
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!body.updatedAt) {
        return NextResponse.json(
          { error: "Plan update conflict: send the plan's current updatedAt revision" },
          { status: 409 },
        );
      }
      if (current.updatedAt !== body.updatedAt) {
        return NextResponse.json(
          { error: "Plan update conflict: the plan changed in another tab", plan: current },
          { status: 409 },
        );
      }
      const updates: Parameters<typeof updatePlan>[2] = {};
      if ("name" in body) updates.name = body.name;
      if ("trailId" in body) updates.trailId = body.trailId;
      if ("plannedDate" in body) updates.plannedDate = body.plannedDate;
      if ("notes" in body) updates.notes = body.notes;
      if ("waypoints" in body) updates.waypoints = body.waypoints;
      if ("campgroundIds" in body) updates.campgroundIds = body.campgroundIds ?? [];
      if ("customGeometry" in body) updates.customGeometry = body.customGeometry;
      const plan = await updatePlan(id, owner.ownerId, updates);
      if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(plan);
    });
  } catch (error) {
    return errorResponse(error, "Failed to update plan");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  try {
    if (hasDatabase()) {
      const db = getDb();
      // .returning() so a delete that matched nothing reports 404 instead of claiming
      // success — otherwise deleting a stranger's plan and deleting your own look alike.
      const deleted = await db
        .delete(hikePlans)
        .where(and(eq(hikePlans.id, id), eq(hikePlans.ownerId, owner.ownerId)))
        .returning({ id: hikePlans.id });
      if (deleted.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ success: true });
    }
    if (!(await deletePlan(id, owner.ownerId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, "Failed to delete plan");
  }
}
