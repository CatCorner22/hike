import { NextResponse } from "next/server";
import { and, eq, gt, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, latLngPointSchema, parseJsonBody } from "@/lib/api/validation";
import { requireOwner } from "@/lib/auth/owner";
import { addActivityPoint, getActivity, listActivityPoints } from "@/lib/store/local";

const pointSchema = latLngPointSchema.extend({
  elevation: z.number().finite().nullable().optional(),
  recordedAt: isoDatetimeSchema,
});
const pointRequestSchema = z.union([
  pointSchema,
  z.object({ points: z.array(pointSchema).min(1).max(500) }),
]);

/**
 * Points have no owner column of their own; they belong to whoever owns the parent
 * activity. Every read and write here resolves that first, so an unknown or
 * someone-else's activity is a 404 before any point is touched.
 */
async function ownsActivity(id: string, ownerId: string): Promise<boolean> {
  if (hasDatabase()) {
    const row = await getDb().query.activities.findFirst({
      where: and(eq(activities.id, id), eq(activities.ownerId, ownerId)),
    });
    return Boolean(row);
  }
  return Boolean(await getActivity(id, ownerId));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  const parsed = await parseJsonBody(request, pointRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const points = "points" in body ? body.points : [body];

  try {
    if (!(await ownsActivity(id, owner.ownerId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (hasDatabase()) {
      const db = getDb();
      const saved = await db.insert(activityPoints).values(points.map((point) => ({
        activityId: id,
        lat: point.lat,
        lng: point.lng,
        elevation: point.elevation ?? null,
        recordedAt: new Date(point.recordedAt),
      }))).returning();
      return NextResponse.json("points" in body ? { points: saved } : saved[0]);
    }

    const saved = await Promise.all(points.map((point) => addActivityPoint({
      activityId: id,
      lat: point.lat,
      lng: point.lng,
      elevation: point.elevation ?? null,
      recordedAt: point.recordedAt,
    })));
    return NextResponse.json("points" in body ? { points: saved } : saved[0]);
  } catch (error) {
    return errorResponse(error, "Failed to save point");
  }
}

/**
 * A multi-day recording at 1 Hz is hundreds of thousands of points. Returning
 * them in one array allocates the whole track server-side and ships megabytes
 * to a phone that is probably on a dying battery, so reads are bounded.
 *
 * The cursor is (recordedAt, id) rather than an offset: points are appended
 * while a hike is in progress, and an offset would silently skip or repeat rows
 * as the tail grows.
 */
const MAX_POINT_PAGE = 2000;
const DEFAULT_POINT_PAGE = 1000;

function parseCursor(raw: string | null): { recordedAt: Date; id: string } | null {
  if (!raw) return null;
  const separator = raw.lastIndexOf("_");
  if (separator <= 0) return null;
  const recordedAt = new Date(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (Number.isNaN(recordedAt.getTime()) || !id) return null;
  return { recordedAt, id };
}

function encodeCursor(point: { recordedAt: Date | string; id: string }): string {
  const recordedAt =
    point.recordedAt instanceof Date ? point.recordedAt.toISOString() : point.recordedAt;
  return `${recordedAt}_${point.id}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? DEFAULT_POINT_PAGE);
  if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
    return NextResponse.json({ error: "limit must be a positive number" }, { status: 400 });
  }
  const limit = Math.min(Math.floor(requestedLimit), MAX_POINT_PAGE);
  const cursorParam = url.searchParams.get("cursor");
  if (cursorParam && !parseCursor(cursorParam)) {
    return NextResponse.json({ error: "cursor is malformed" }, { status: 400 });
  }
  const cursor = parseCursor(cursorParam);

  try {
    // An unknown activity must 404 rather than return an empty array — "no points"
    // reads as "the recording captured nothing", which is a different fact entirely.
    // An activity owned by someone else is indistinguishable from an unknown one.
    if (!(await ownsActivity(id, owner.ownerId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fetch one extra row to detect a further page without a second query.
    let page: Array<{ id: string; recordedAt: Date | string }> & Record<number, unknown>;
    if (hasDatabase()) {
      page = (await getDb().query.activityPoints.findMany({
        where: cursor
          ? and(
              eq(activityPoints.activityId, id),
              or(
                gt(activityPoints.recordedAt, cursor.recordedAt),
                and(
                  eq(activityPoints.recordedAt, cursor.recordedAt),
                  gt(activityPoints.id, cursor.id),
                ),
              ),
            )
          : eq(activityPoints.activityId, id),
        orderBy: (p, { asc }) => [asc(p.recordedAt), asc(p.id)],
        limit: limit + 1,
      })) as typeof page;
    } else {
      const all = await listActivityPoints(id);
      const after = cursor
        ? all.filter((point) => {
            const at = new Date(point.recordedAt).getTime();
            const cut = cursor.recordedAt.getTime();
            return at > cut || (at === cut && point.id > cursor.id);
          })
        : all;
      page = after.slice(0, limit + 1) as typeof page;
    }

    const hasMore = page.length > limit;
    const points = hasMore ? page.slice(0, limit) : page;
    const last = points[points.length - 1];
    return NextResponse.json({
      points,
      pagination: {
        limit,
        maxLimit: MAX_POINT_PAGE,
        hasMore,
        nextCursor: hasMore && last ? encodeCursor(last) : null,
      },
    });
  } catch (error) {
    return errorResponse(error, "Failed to load points");
  }
}
