DROP INDEX IF EXISTS "campgrounds_external_id_idx";
ALTER TABLE "campgrounds" DROP CONSTRAINT IF EXISTS "campgrounds_external_id_unique";
DELETE FROM "campgrounds" a USING "campgrounds" b
  WHERE a.ctid < b.ctid AND a.external_id = b.external_id;
ALTER TABLE "campgrounds" ADD CONSTRAINT "campgrounds_external_id_unique" UNIQUE ("external_id");
