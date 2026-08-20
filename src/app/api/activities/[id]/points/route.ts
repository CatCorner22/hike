import { NextResponse } from "next/server";
import { and, asc, eq, gt, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, latLngPointSchema, parseJsonBody } from "@/lib/api/validation";
import { addActivityPoint, getActivity, listActivityPoints } from "@/lib/store/local";
import { notFoundResponse, ownerIdFromRequest, ownerUnavailableResponse, withoutOwner } from "@/lib/api/ownership";

const pointSchema = latLngPointSchema.extend({
  elevation: z.number().finite().nullable().optional(),
  recordedAt: isoDatetimeSchema,
});
const pointRequestSchema = z.union([
  pointSchema,
  z.object({ points: z.array(pointSchema).min(1).max(500) }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
  const { id } = await params;
  const parsed = await parseJsonBody(request, pointRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const points = "points" in body ? body.points : [body];

  try {
    if (hasDatabase()) {
      const db = getDb();
      const activity = await db.query.activities.findFirst({ where: and(eq(activities.id, id), eq(activities.ownerId, ownerId)) });
      if (!activity) return notFoundResponse();
      const saved = await db.insert(activityPoints).values(points.map((point) => ({
        ownerId,
        activityId: id,
        lat: point.lat,
        lng: point.lng,
        elevation: point.elevation ?? null,
        recordedAt: new Date(point.recordedAt),
      }))).returning();
      return NextResponse.json("points" in body ? { points: saved.map(withoutOwner) } : withoutOwner(saved[0]));
    }

    if (!await getActivity(id, ownerId)) return notFoundResponse();
    const saved = await Promise.all(points.map((point) => addActivityPoint({
      ownerId,
      activityId: id,
      lat: point.lat,
      lng: point.lng,
      elevation: point.elevation ?? null,
      recordedAt: point.recordedAt,
    })));
    return NextResponse.json("points" in body ? { points: saved.map(withoutOwner) } : withoutOwner(saved[0]));
  } catch (error) {
    return errorResponse(error, "Failed to save point");
  }
}

function decodeCursor(cursor: string | null): { recordedAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [recordedAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("\u0000");
    if (!recordedAt || !id || !Number.isFinite(Date.parse(recordedAt)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { recordedAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(recordedAt: Date | string, id: string) {
  const value = typeof recordedAt === "string" ? recordedAt : recordedAt.toISOString();
  return Buffer.from(`${value}\u0000${id}`).toString("base64url");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = ownerIdFromRequest(request);
  if (!ownerId) return ownerUnavailableResponse();
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const requestedLimit = Number(query.get("limit") ?? "200");
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
    return NextResponse.json({ error: "limit must be an integer between 1 and 500" }, { status: 400 });
  }
  const cursor = decodeCursor(query.get("cursor"));
  if (query.get("cursor") && !cursor) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  try {
    if (hasDatabase()) {
      const db = getDb();
      const activity = await db.query.activities.findFirst({ where: and(eq(activities.id, id), eq(activities.ownerId, ownerId)) });
      if (!activity) return notFoundResponse();
      const points = await db.query.activityPoints.findMany({
        where: and(
          eq(activityPoints.activityId, id),
          eq(activityPoints.ownerId, ownerId),
          ...(cursor ? [or(gt(activityPoints.recordedAt, new Date(cursor.recordedAt)), and(eq(activityPoints.recordedAt, new Date(cursor.recordedAt)), gt(activityPoints.id, cursor.id)))] : []),
        ),
        orderBy: [asc(activityPoints.recordedAt), asc(activityPoints.id)],
        limit: requestedLimit + 1,
      });
      const page = points.slice(0, requestedLimit);
      const hasMore = points.length > requestedLimit;
      return NextResponse.json({
        points: page.map(withoutOwner), limit: requestedLimit, hasMore,
        nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1].recordedAt, page[page.length - 1].id) : null,
      });
    }
    if (!await getActivity(id, ownerId)) return notFoundResponse();
    const all = await listActivityPoints(id, ownerId);
    const after = cursor
      ? all.filter((point) => Date.parse(point.recordedAt) > Date.parse(cursor.recordedAt) || (Date.parse(point.recordedAt) === Date.parse(cursor.recordedAt) && point.id > cursor.id))
      : all;
    const points = after.slice(0, requestedLimit);
    const hasMore = after.length > requestedLimit;
    return NextResponse.json({
      points: points.map(withoutOwner), limit: requestedLimit, hasMore,
      nextCursor: hasMore && points.length ? encodeCursor(points[points.length - 1].recordedAt, points[points.length - 1].id) : null,
    });
  } catch (error) {
    return errorResponse(error, "Failed to load points");
  }
}
