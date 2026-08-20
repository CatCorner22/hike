import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints } from "@/lib/db/schema";
import {
  addActivityPoint,
  getActivity,
  listActivityPoints,
} from "@/lib/store/local";
import { z } from "zod";

const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  elevation: z.number().finite().nullish(),
  recordedAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid recorded time"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const parsed = pointSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid activity point", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const body = parsed.data;
    if (hasDatabase()) {
      const db = getDb();
      const activity = await db.query.activities.findFirst({
        where: eq(activities.id, id),
      });
      if (!activity) {
        return NextResponse.json({ error: "Activity not found" }, { status: 404 });
      }
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

    if (!(await getActivity(id))) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
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
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
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
      const activity = await db.query.activities.findFirst({
        where: eq(activities.id, id),
      });
      if (!activity) {
        return NextResponse.json({ error: "Activity not found" }, { status: 404 });
      }
      const points = await db.query.activityPoints.findMany({
        where: eq(activityPoints.activityId, id),
        orderBy: (p, { asc }) => [asc(p.recordedAt)],
      });
      return NextResponse.json({ points });
    }

    if (!(await getActivity(id))) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
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
