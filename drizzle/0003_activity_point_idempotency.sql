-- A lost response must not turn one recorded GPS fix into two persisted fixes.
-- Keep the first physical row for legacy exact duplicates before adding the fallback
-- tuple constraint, so applying this migration does not fail on already-corrupted data.
ALTER TABLE "activity_points" ADD COLUMN IF NOT EXISTS "client_point_id" text;

DELETE FROM "activity_points" older
USING "activity_points" newer
WHERE older.ctid < newer.ctid
  AND older.activity_id = newer.activity_id
  AND older.recorded_at = newer.recorded_at
  AND older.lat = newer.lat
  AND older.lng = newer.lng;

CREATE UNIQUE INDEX IF NOT EXISTS "activity_points_activity_client_point_unique"
  ON "activity_points" ("activity_id", "client_point_id");

CREATE UNIQUE INDEX IF NOT EXISTS "activity_points_activity_recorded_lat_lng_unique"
  ON "activity_points" ("activity_id", "recorded_at", "lat", "lng");
