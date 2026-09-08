DO $$ BEGIN
  CREATE TYPE "campground_access_status" AS ENUM ('allowed', 'restricted', 'private', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "campground_permit_status" AS ENUM ('required', 'not_required', 'seasonal', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "campgrounds"
  ADD COLUMN IF NOT EXISTS "access_status" "campground_access_status" DEFAULT 'unknown' NOT NULL;

ALTER TABLE "campgrounds"
  ADD COLUMN IF NOT EXISTS "permit_status" "campground_permit_status" DEFAULT 'unknown' NOT NULL;

-- A legacy DEFAULT false meant “provider did not say,” not “officially not required.”
ALTER TABLE "campgrounds" ALTER COLUMN "permit_required" DROP DEFAULT;
UPDATE "campgrounds" SET "permit_required" = NULL WHERE "permit_required" = false;

-- Preserve only explicit OSM evidence; never infer access from camping type.
UPDATE "campgrounds"
SET "access_status" = CASE
  WHEN lower("metadata"->>'access') = 'private' THEN 'private'::"campground_access_status"
  WHEN lower("metadata"->>'access') IN ('no', 'customers') THEN 'restricted'::"campground_access_status"
  WHEN lower("metadata"->>'access') IN ('yes', 'permissive', 'designated', 'public') THEN 'allowed'::"campground_access_status"
  ELSE 'unknown'::"campground_access_status"
END
WHERE "source" = 'osm';

UPDATE "campgrounds"
SET "permit_status" = CASE
  WHEN lower(COALESCE("metadata"->>'permit', "metadata"->>'permit_required')) IN ('yes', 'required') THEN 'required'::"campground_permit_status"
  WHEN lower(COALESCE("metadata"->>'permit', "metadata"->>'permit_required')) IN ('seasonal', 'limited', 'lottery') THEN 'seasonal'::"campground_permit_status"
  WHEN lower(COALESCE("metadata"->>'permit', "metadata"->>'permit_required')) IN ('no', 'not_required') THEN 'not_required'::"campground_permit_status"
  ELSE 'unknown'::"campground_permit_status"
END
WHERE "source" = 'osm';
