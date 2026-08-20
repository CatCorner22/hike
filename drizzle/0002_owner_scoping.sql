-- Owner scoping for user data.
--
-- Plans and activities were readable and writable by anyone who could reach the
-- deployment: GET /api/plans returned every plan on the server, and the activity
-- endpoints returned raw GPS traces to anyone holding an id. These columns let the API
-- constrain every query to the caller.
--
-- The column is nullable on purpose. A NULL owner belongs to nobody and is invisible
-- through the API, so this migration cannot hand existing rows to the wrong person.

ALTER TABLE "hike_plans" ADD COLUMN IF NOT EXISTS "owner_id" text;
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "owner_id" text;

CREATE INDEX IF NOT EXISTS "hike_plans_owner_id_idx" ON "hike_plans" ("owner_id");
CREATE INDEX IF NOT EXISTS "activities_owner_id_idx" ON "activities" ("owner_id");

-- CLAIMING EXISTING ROWS
--
-- Rows created before this migration have no owner and will not appear in the app.
-- To adopt them, find your owner id and assign it:
--
--   1. Open the app, then read the `hike_owner` cookie in devtools
--      (Application -> Cookies). The owner id is the part before the first ".".
--   2. Run, with that id:
--
--        UPDATE hike_plans  SET owner_id = '<your-owner-id>' WHERE owner_id IS NULL;
--        UPDATE activities  SET owner_id = '<your-owner-id>' WHERE owner_id IS NULL;
--
-- Do this only on a deployment whose existing rows are all yours. On a shared
-- deployment it would hand every previous user's plans and GPS tracks to one account.
