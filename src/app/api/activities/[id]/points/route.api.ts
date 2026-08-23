import { NextResponse } from "next/server";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { MAX_ACTIVITY_POINTS } from "@/lib/api/validate";
import { getDb, hasDatabase } from "@/lib/db";
import { withActivityMutation } from "@/lib/db/activity-mutation";
import { activities, activityPoints } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { isoDatetimeSchema, latLngPointSchema, parseJsonBody } from "@/lib/api/validation";
import { requireOwner } from "@/lib/auth/owner";
import { addActivityPoints, getActivity, listActivityPoints } from "@/lib/store/local";

const pointSchema = latLngPointSchema.extend({
  elevation: z.number().finite().nullable().optional(),
  recordedAt: isoDatetimeSchema,
  clientPointId: z.string().trim().min(1).max(200).optional(),
});
const pointRequestSchema = z.union([
  pointSchema,
  z.object({ points: z.array(pointSchema).min(1).max(500) }),
]);
type PointInput = z.infer<typeof pointSchema>;

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

function sameFallbackPoint(
  candidate: {
    lat: number;
    lng: number;
    recordedAt: Date | string;
    clientPointId?: string | null;
  },
  point: PointInput,
): boolean {
  if (point.clientPointId && candidate.clientPointId === point.clientPointId) return true;
  return candidate.lat === point.lat
    && candidate.lng === point.lng
    && new Date(candidate.recordedAt).getTime() === new Date(point.recordedAt).getTime();
}

function pointTupleKey(point: PointInput): string {
  return `${new Date(point.recordedAt).getTime()}\u0000${point.lat}\u0000${point.lng}`;
}

/** Count rows this request would add, excluding stored and intra-request duplicates. */
function countNovelPoints(
  points: PointInput[],
  isStored: (point: PointInput) => boolean,
): number {
  const novelClientIds = new Set<string>();
  const novelTuples = new Set<string>();
  let count = 0;

  for (const point of points) {
    const tuple = pointTupleKey(point);
    if (
      (point.clientPointId && novelClientIds.has(point.clientPointId))
      || novelTuples.has(tuple)
      || isStored(point)
    ) {
      continue;
    }
    count += 1;
    if (point.clientPointId) novelClientIds.add(point.clientPointId);
    novelTuples.add(tuple);
  }
  return count;
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
    return await withActivityMutation(id, async () => {
      if (!(await ownsActivity(id, owner.ownerId))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      if (hasDatabase()) {
        const db = getDb();
        const activity = await db.query.activities.findFirst({
          where: and(eq(activities.id, id), eq(activities.ownerId, owner.ownerId)),
          columns: { endedAt: true },
        });
        if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 });

        // Capacity is a batch invariant. Checking it inside the insert loop allowed a
        // request at cap - 1 to persist its first point and then return 413 for the
        // whole batch. The offline client correctly treats 413 as permanent, so that
        // mixed result lost the rejected suffix. Count only genuinely novel points and
        // reject before the first mutation.
        const existingBefore = await db.query.activityPoints.findMany({
          where: eq(activityPoints.activityId, id),
          columns: {
            id: true,
            clientPointId: true,
            lat: true,
            lng: true,
            recordedAt: true,
          },
        });
        const novelPointCount = countNovelPoints(
          points,
          (point) => existingBefore.some((candidate) => sameFallbackPoint(candidate, point)),
        );
        if (activity.endedAt && novelPointCount > 0) {
          return NextResponse.json(
            { error: "Activity is finalized; no further GPS points can be added" },
            { status: 409 },
          );
        }
        if (
          novelPointCount > 0
          && existingBefore.length + novelPointCount > MAX_ACTIVITY_POINTS
        ) {
          return NextResponse.json({ error: "Activity point cap reached" }, { status: 413 });
        }

        const saved = [];
        for (const point of points) {
          const existing = await db.query.activityPoints.findFirst({
            where: point.clientPointId
              ? and(
                  eq(activityPoints.activityId, id),
                  or(
                    eq(activityPoints.clientPointId, point.clientPointId),
                    and(
                      eq(activityPoints.recordedAt, new Date(point.recordedAt)),
                      eq(activityPoints.lat, point.lat),
                      eq(activityPoints.lng, point.lng),
                    ),
                  ),
                )
              : and(
                  eq(activityPoints.activityId, id),
                  eq(activityPoints.recordedAt, new Date(point.recordedAt)),
                  eq(activityPoints.lat, point.lat),
                  eq(activityPoints.lng, point.lng),
                ),
          });
          if (existing) {
            saved.push(existing);
            continue;
          }
          // The activity's open state is part of the INSERT predicate. A separate
          // read followed by INSERT would let another server finalize between them and
          // still return 200 for a fix that belongs to no completed track.
          const insertFromOpenActivity = db
            .select({
              activityId: activities.id,
              clientPointId: sql<string | null>`${point.clientPointId ?? null}`.as("client_point_id"),
              lat: sql<number>`${point.lat}`.as("lat"),
              lng: sql<number>`${point.lng}`.as("lng"),
              elevation: sql<number | null>`${point.elevation ?? null}`.as("elevation"),
              recordedAt: sql<Date>`${new Date(point.recordedAt)}`.as("recorded_at"),
            })
            .from(activities)
            .where(and(
              eq(activities.id, id),
              eq(activities.ownerId, owner.ownerId),
              isNull(activities.endedAt),
            ));
          const inserted = await db.insert(activityPoints)
            .select(insertFromOpenActivity)
            .onConflictDoNothing()
            .returning();
          if (inserted[0]) {
            saved.push(inserted[0]);
            continue;
          }

          // The unique indexes arbitrate retries across server instances. Re-read the
          // winner rather than turning a harmless replay into an error.
          const winner = await db.query.activityPoints.findFirst({
            where: point.clientPointId
              ? and(
                  eq(activityPoints.activityId, id),
                  or(
                    eq(activityPoints.clientPointId, point.clientPointId),
                    and(
                      eq(activityPoints.recordedAt, new Date(point.recordedAt)),
                      eq(activityPoints.lat, point.lat),
                      eq(activityPoints.lng, point.lng),
                    ),
                  ),
                )
              : and(
                  eq(activityPoints.activityId, id),
                  eq(activityPoints.recordedAt, new Date(point.recordedAt)),
                  eq(activityPoints.lat, point.lat),
                  eq(activityPoints.lng, point.lng),
                ),
          });
          if (winner) {
            saved.push(winner);
            continue;
          }
          return NextResponse.json(
            { error: "Activity is finalized; no further GPS points can be added" },
            { status: 409 },
          );
        }
        return NextResponse.json("points" in body ? { points: saved } : saved[0]);
      }

      const activity = await getActivity(id, owner.ownerId);
      if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const existingBefore = await listActivityPoints(id);
      const novelPointCount = countNovelPoints(
        points,
        (point) => existingBefore.some((candidate) =>
          sameFallbackPoint(
            candidate as typeof candidate & { clientPointId?: string },
            point,
          )),
      );
      if (activity.endedAt && novelPointCount > 0) {
        return NextResponse.json(
          { error: "Activity is finalized; no further GPS points can be added" },
          { status: 409 },
        );
      }
      if (
        novelPointCount > 0
        && existingBefore.length + novelPointCount > MAX_ACTIVITY_POINTS
      ) {
        return NextResponse.json({ error: "Activity point cap reached" }, { status: 413 });
      }

      const responseRefs: Array<(typeof existingBefore)[number] | number> = [];
      const staged = [];
      for (const point of points) {
        const storedDuplicate = existingBefore.find((candidate) =>
          sameFallbackPoint(candidate, point),
        );
        if (storedDuplicate) {
          responseRefs.push(storedDuplicate);
          continue;
        }
        const stagedDuplicate = staged.findIndex((candidate) =>
          sameFallbackPoint(candidate, point),
        );
        if (stagedDuplicate >= 0) {
          responseRefs.push(stagedDuplicate);
          continue;
        }
        responseRefs.push(staged.length);
        staged.push({
          activityId: id,
          clientPointId: point.clientPointId,
          lat: point.lat,
          lng: point.lng,
          elevation: point.elevation ?? null,
          recordedAt: point.recordedAt,
        });
      }
      // One file replacement makes the fallback batch all-or-nothing even if the
      // filesystem fails while persisting it.
      const inserted = await addActivityPoints(staged);
      const saved = responseRefs.map((reference) =>
        typeof reference === "number" ? inserted[reference] : reference,
      );
      return NextResponse.json("points" in body ? { points: saved } : saved[0]);
    });
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
