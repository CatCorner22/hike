import { sql } from "drizzle-orm";
import { activities } from "@/lib/db/schema";

const activityMutationTails = new Map<string, Promise<void>>();

/**
 * The JSON fallback is a single file, so two requests can otherwise both observe an
 * open activity (or an absent point) before either file mutation runs. Serializing an
 * activity's API mutations makes its answer match the database path: a completed hike
 * cannot acknowledge a later fix that it will not show to the hiker.
 */
export async function withActivityMutation<T>(
  activityId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = activityMutationTails.get(activityId) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  activityMutationTails.set(activityId, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (activityMutationTails.get(activityId) === tail) {
      activityMutationTails.delete(activityId);
    }
  }
}

export interface PendingActivityPoint {
  clientPointId?: string | null;
  lat: number;
  lng: number;
  elevation?: number | null;
  recordedAt: string;
}

/**
 * The projection an `INSERT ... SELECT` uses to write one point, gated on the
 * activity still being open.
 *
 * Drizzle's `insert().select()` calls `haveSameKeys(table[Columns],
 * select._.selectedFields)` and throws when they differ — so this must name
 * EVERY column of `activity_points`, in the table's own order, `id` included.
 * It did not, and the omission was invisible to CI: every job runs on the JSON
 * file fallback, so the only thing that ever exercised this path was a real
 * deployment, where saving a GPS point answered 500. That is the upload of a
 * finished hike.
 *
 * `id` is generated here rather than left to the column default because the
 * default is not applied to an insert-select; `gen_random_uuid()` is exactly
 * what `uuid().defaultRandom()` compiles to, and is built in from Postgres 13.
 */
export function openActivityPointSelection(point: PendingActivityPoint) {
  return {
    id: sql<string>`gen_random_uuid()`.as("id"),
    activityId: activities.id,
    clientPointId: sql<string | null>`${point.clientPointId ?? null}`.as("client_point_id"),
    lat: sql<number>`${point.lat}`.as("lat"),
    lng: sql<number>`${point.lng}`.as("lng"),
    elevation: sql<number | null>`${point.elevation ?? null}`.as("elevation"),
    recordedAt: sql<Date>`${new Date(point.recordedAt)}`.as("recorded_at"),
  };
}
