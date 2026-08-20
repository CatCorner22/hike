import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { hikePlans } from "@/lib/db/schema";
import { deletePlan, getPlan, updatePlan } from "@/lib/store/local";
import { parseJson, updatePlanSchema } from "@/lib/api/validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (hasDatabase()) {
      const db = getDb();
      const plan = await db.query.hikePlans.findFirst({
        where: eq(hikePlans.id, id),
      });
      if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(plan);
    }

    const plan = await getPlan(id);
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load plan" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const parsed = await parseJson(request, updatePlanSchema);
    if (!parsed.success) return parsed.response;
    const body = parsed.data;
    if (hasDatabase()) {
      const db = getDb();
      const [plan] = await db
        .update(hikePlans)
        .set({
          name: body.name,
          trailId: body.trailId,
          plannedDate:
            body.plannedDate === undefined
              ? undefined
              : body.plannedDate
                ? new Date(body.plannedDate)
                : null,
          notes: body.notes,
          waypoints: body.waypoints,
          campgroundIds: body.campgroundIds,
          customGeometry: body.customGeometry,
          updatedAt: new Date(),
        })
        .where(eq(hikePlans.id, id))
        .returning();
      if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(plan);
    }

    const plan = await updatePlan(id, {
      ...body,
    });
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update plan" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (hasDatabase()) {
      const db = getDb();
      await db.delete(hikePlans).where(eq(hikePlans.id, id));
      return NextResponse.json({ success: true });
    }

    await deletePlan(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete plan" },
      { status: 500 },
    );
  }
}
