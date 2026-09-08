import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/owner";
import { getDb, hasDatabase } from "@/lib/db";
import { activities, activityPoints } from "@/lib/db/schema";
import { errorResponse } from "@/lib/api/errors";
import { buildActivityGpxExport } from "@/lib/activities/gpx-export";
import { getActivity, listActivityPoints } from "@/lib/store/local";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  try {
    let activity: { name: string | null; endedAt: Date | string | null } | null;
    let points: Array<{
      lat: number;
      lng: number;
      elevation?: number | null;
      recordedAt: Date | string;
    }>;

    if (hasDatabase()) {
      const db = getDb();
      activity = await db.query.activities.findFirst({
        columns: { name: true, endedAt: true },
        where: and(eq(activities.id, id), eq(activities.ownerId, owner.ownerId)),
      }) ?? null;
      if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 });
      points = await db.query.activityPoints.findMany({
        columns: { lat: true, lng: true, elevation: true, recordedAt: true },
        where: eq(activityPoints.activityId, id),
        orderBy: [asc(activityPoints.recordedAt), asc(activityPoints.id)],
      });
    } else {
      activity = await getActivity(id, owner.ownerId);
      if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 });
      points = await listActivityPoints(id);
    }

    const result = buildActivityGpxExport({ ...activity, points });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return new Response(result.gpx, {
      status: 200,
      headers: {
        "Content-Type": "application/gpx+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, "Failed to export activity");
  }
}
