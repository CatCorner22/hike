import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { hikePlans } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const db = getDb();

  const plan = await db.query.hikePlans.findFirst({
    where: eq(hikePlans.id, id),
  });

  if (!plan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(plan);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const body = await request.json();
  const db = getDb();

  const [plan] = await db
    .update(hikePlans)
    .set({
      name: body.name,
      trailId: body.trailId,
      plannedDate: body.plannedDate ? new Date(body.plannedDate) : null,
      notes: body.notes,
      waypoints: body.waypoints,
      campgroundIds: body.campgroundIds,
      customGeometry: body.customGeometry,
      updatedAt: new Date(),
    })
    .where(eq(hikePlans.id, id))
    .returning();

  return NextResponse.json(plan);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const db = getDb();
  await db.delete(hikePlans).where(eq(hikePlans.id, id));
  return NextResponse.json({ success: true });
}
