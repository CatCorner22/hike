import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { activityPoints } from "@/lib/db/schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasDatabase()) {
    return NextResponse.json({ queued: true });
  }

  const { id } = await params;
  const body = await request.json();
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasDatabase()) {
    return NextResponse.json({ points: [] });
  }

  const { id } = await params;
  const db = getDb();

  const points = await db.query.activityPoints.findMany({
    where: eq(activityPoints.activityId, id),
    orderBy: (p, { asc }) => [asc(p.recordedAt)],
  });

  return NextResponse.json({ points });
}
