import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { errorResponse } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { requireOwner } from "@/lib/auth/owner";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints, hikePlans } from "@/lib/db/schema";
import { listActivities, listActivityPoints, listPlans } from "@/lib/store/local";

/**
 * Everything this owner has, in one file they can keep.
 *
 * The app could export a single track as GPX and a single pack as JSON, and had
 * no way at all to take a copy of the whole thing. On a personal deployment
 * that is one database away from every plan and every finished hike: the
 * container gets replaced, the free tier lapses, the session secret is rotated
 * by accident — and there was nothing on disk anywhere else.
 *
 * This is an export, not a restore. It is a readable record a person keeps:
 * the plans with their geometry, the activities with their track and their
 * statistics, and the raw fixes underneath them. Nothing here imports it back;
 * saying so is more useful than implying a button that does not exist.
 */
export const dynamic = "force-dynamic";

/**
 * A ceiling on the raw fixes in one document.
 *
 * A multi-day recording is tens of thousands of points, and several of them
 * would build a response too large to hold in memory on a small container —
 * on the one route whose whole purpose is to work when things have gone wrong.
 * The tracks themselves are complete regardless: `trackGeometry` is the walked
 * line, and it is exported in full. What this bounds is the fix log beneath it,
 * and the document says so when it bites.
 */
const MAX_EXPORTED_POINTS = 50_000;

export async function GET(request: Request) {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  // Expensive and rarely wanted. A few a minute is more than a person needs and
  // far less than a way to make the server read its whole database in a loop.
  const limited = rateLimit(request, `export:${owner.ownerId}`, 4, 60_000);
  if (limited) return limited;

  try {
    const truncated: string[] = [];
    let budget = MAX_EXPORTED_POINTS;

    let plans: unknown[];
    let records: Array<{ id: string }>;
    if (hasDatabase()) {
      const db = getDb();
      plans = await db.query.hikePlans.findMany({
        where: eq(hikePlans.ownerId, owner.ownerId),
      });
      records = await db.query.activities.findMany({
        where: eq(activities.ownerId, owner.ownerId),
      });
    } else {
      plans = await listPlans(owner.ownerId);
      records = (await listActivities(owner.ownerId)) as Array<{ id: string }>;
    }

    const exportedActivities = [];
    for (const activity of records) {
      let points: unknown[] = [];
      if (budget > 0) {
        const all = hasDatabase()
          ? await getDb().query.activityPoints.findMany({
              where: eq(activityPoints.activityId, activity.id),
              orderBy: (point, { asc }) => [asc(point.recordedAt), asc(point.id)],
              limit: budget + 1,
            })
          : await listActivityPoints(activity.id);
        points = all.slice(0, budget);
        if (all.length > points.length) truncated.push(activity.id);
        budget -= points.length;
      } else {
        truncated.push(activity.id);
      }
      exportedActivities.push({ ...activity, points });
    }

    const body = {
      klandagiExport: 1,
      exportedAt: new Date().toISOString(),
      // Not the session token and not anything that identifies a person: the
      // anonymous per-install id, so a reader can tell two exports apart.
      ownerId: owner.ownerId,
      note:
        "A record you keep, not a restore file — nothing in Klandagi reads it back in. "
        + "Each activity's trackGeometry is the complete walked line; `points` is the raw fix log beneath it.",
      plans,
      activities: exportedActivities,
      ...(truncated.length > 0
        ? {
            truncated: {
              activityIds: truncated,
              limit: MAX_EXPORTED_POINTS,
              note:
                "The raw fix log was cut at the limit for these activities. Their trackGeometry is still complete. "
                + "Export a single activity from its own page to get all of its fixes.",
            },
          }
        : {}),
    };

    const stamp = new Date().toISOString().slice(0, 10);
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="klandagi-backup-${stamp}.json"`,
      },
    });
  } catch (error) {
    return errorResponse(error, "Your data could not be exported");
  }
}
