import { sql, type SQL } from "drizzle-orm";
import { activities, activityPoints } from "@/lib/db/schema";

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
 * Every column of `activity_points`, in the table's own order.
 *
 * Named once so the two writers below cannot drift apart, and so a test can
 * assert the parity Drizzle's own `haveSameKeys` check enforces. Getting this
 * list wrong is not a type error — it is a 500 on every uploaded GPS point,
 * which is how it shipped once already.
 */
export const ACTIVITY_POINT_COLUMNS = [
  "id",
  "activity_id",
  "client_point_id",
  "lat",
  "lng",
  "elevation",
  "recorded_at",
] as const;

export interface StoredActivityPoint {
  id: string;
  activityId: string;
  clientPointId: string | null;
  lat: number;
  lng: number;
  elevation: number | null;
  recordedAt: Date;
}

/**
 * A UTC wall-clock literal for `recorded_at`, which is `timestamp` WITHOUT time
 * zone.
 *
 * Passing a JS `Date` here is wrong in a way that only shows up on a server that
 * is not running in UTC. `pg` serializes a Date in the process's *local* zone
 * with an offset — `2026-01-01 04:00:00.000-08:00` — and casting that to
 * `timestamp` throws the offset away and keeps the local wall time. Measured on
 * a server with TZ=America/Los_Angeles: a fix recorded at 12:00Z was stored and
 * read back as 04:00Z. Every point of every uploaded track, off by the host's
 * offset, and a search team reading a last-known-position eight hours wrong.
 *
 * Drizzle's own column mapper writes the UTC wall time, which is what every
 * other timestamp in this app means. This does the same thing explicitly, and
 * `database-probe.mjs` runs under a non-UTC TZ so it stays that way.
 */
function utcTimestampLiteral(value: string): string {
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) {
    throw new Error("Activity point has an unreadable recordedAt");
  }
  return at.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Writes a whole batch of GPS points in one statement.
 *
 * The previous version issued a lookup and an insert per point: a 500-point
 * upload — the shape the offline recorder actually sends when a hiker comes back
 * into range — was about a thousand round trips. Measured against a co-located
 * Postgres that is 1.8 ms per point, tolerable; against a database one internet
 * hop away at 20 ms it is twenty seconds, which is a gateway timeout on the one
 * request that carries a finished hike home. Now it is a fixed handful of round
 * trips whatever the batch size.
 *
 * The activity's open state stays inside the INSERT, as a join predicate rather
 * than a separate read, so another instance finalizing the activity mid-flight
 * cannot leave points attached to a completed track. `ON CONFLICT DO NOTHING`
 * arbitrates both unique indexes, including duplicates within this same batch.
 */
export async function insertActivityPointBatch(
  db: {
    execute: (query: SQL) => Promise<{ rows: Record<string, unknown>[] } | Record<string, unknown>[]>;
  },
  activityId: string,
  ownerId: string,
  points: ReadonlyArray<PendingActivityPoint>,
): Promise<StoredActivityPoint[]> {
  if (points.length === 0) return [];

  // The first VALUES row carries the casts; Postgres takes the column types of
  // the whole list from it, and an untyped parameter there is "could not
  // determine data type".
  const rows = points.map((point, index) => {
    const clientPointId = point.clientPointId ?? null;
    const elevation = point.elevation ?? null;
    const recordedAt = utcTimestampLiteral(point.recordedAt);
    return index === 0
      ? sql`(${clientPointId}::text, ${point.lat}::double precision, ${point.lng}::double precision, ${elevation}::double precision, ${recordedAt}::timestamp)`
      : sql`(${clientPointId}, ${point.lat}, ${point.lng}, ${elevation}, ${recordedAt})`;
  });

  const statement = sql`
    insert into ${activityPoints} (id, activity_id, client_point_id, lat, lng, elevation, recorded_at)
    select gen_random_uuid(), a.id, v.client_point_id, v.lat, v.lng, v.elevation, v.recorded_at
    from ${activities} a
    cross join (values ${sql.join(rows, sql`, `)}) as v(client_point_id, lat, lng, elevation, recorded_at)
    where a.id = ${activityId} and a.owner_id = ${ownerId} and a.ended_at is null
    on conflict do nothing
    returning id, activity_id, client_point_id, lat, lng, elevation, recorded_at
  `;

  const result = await db.execute(statement);
  const returned = Array.isArray(result) ? result : result.rows;
  return returned.map((row) => ({
    id: String(row.id),
    activityId: String(row.activity_id),
    clientPointId: row.client_point_id == null ? null : String(row.client_point_id),
    lat: Number(row.lat),
    lng: Number(row.lng),
    elevation: row.elevation == null ? null : Number(row.elevation),
    recordedAt: row.recorded_at instanceof Date ? row.recorded_at : new Date(String(row.recorded_at)),
  }));
}
