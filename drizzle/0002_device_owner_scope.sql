-- Device-scoped ownership. Existing private data is assigned to an
-- unreachable sentinel, intentionally preventing a newly issued device cookie
-- from exposing pre-migration rows. No live owner token can equal "legacy".
ALTER TABLE "hike_plans" ADD COLUMN IF NOT EXISTS "owner_id" text;
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "owner_id" text;
ALTER TABLE "activity_points" ADD COLUMN IF NOT EXISTS "owner_id" text;

UPDATE "hike_plans" SET "owner_id" = 'legacy' WHERE "owner_id" IS NULL;
UPDATE "activities" SET "owner_id" = 'legacy' WHERE "owner_id" IS NULL;
UPDATE "activity_points" SET "owner_id" = 'legacy' WHERE "owner_id" IS NULL;

ALTER TABLE "hike_plans" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "activities" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "activity_points" ALTER COLUMN "owner_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "hike_plans_owner_id_idx" ON "hike_plans" ("owner_id");
CREATE INDEX IF NOT EXISTS "activities_owner_id_idx" ON "activities" ("owner_id");
CREATE INDEX IF NOT EXISTS "activity_points_owner_id_idx" ON "activity_points" ("owner_id");
CREATE INDEX IF NOT EXISTS "activity_points_owner_activity_recorded_id_idx"
  ON "activity_points" ("owner_id", "activity_id", "recorded_at", "id");
