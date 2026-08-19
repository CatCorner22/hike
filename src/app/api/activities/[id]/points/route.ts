import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { activityPoints } from "@/lib/db/schema";
import { addActivityPoint, listActivityPoints } from "@/lib/store/local";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  try {
    if (hasDatabase()) {
      const db = getDb();
      const [point] = await db
        .insert(activityPoints)
        .values({
          activityId: id,
          lat: body.lat,
          lng: body.lng,
          elevation: body.elevation ?? null,
          recordedAt: new Date(body.recordedAt),
        })
        .returning();
      return NextResponse.json(point);
    }

    const point = await addActivityPoint({
      activityId: id,
      lat: body.lat,
      lng: body.lng,
      elevation: body.elevation ?? null,
      recordedAt: body.recordedAt,
    });
    return NextResponse.json(point);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save point" },
      { status: 500 },
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (hasDatabase()) {
      const db = getDb();
      const points = await db.query.activityPoints.findMany({
        where: eq(activityPoints.activityId, id),
        orderBy: (p, { asc }) => [asc(p.recordedAt)],
      });
      return NextResponse.json({ points });
    }

    const points = await listActivityPoints(id);
    return NextResponse.json({ points });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load points" },
      { status: 500 },
    );
  }
}
