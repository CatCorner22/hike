ALTER TABLE "trails" DROP CONSTRAINT IF EXISTS "trails_osm_id_key";
ALTER TABLE "trails" DROP CONSTRAINT IF EXISTS "trails_osm_id_unique";
DROP INDEX IF EXISTS "trails_osm_id_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "trails_osm_id_osm_type_unique" ON "trails" ("osm_id", "osm_type");
