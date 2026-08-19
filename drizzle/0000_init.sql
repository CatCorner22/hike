CREATE TYPE "public"."camping_type" AS ENUM('developed_tent', 'rv', 'backcountry', 'walk_in');
CREATE TYPE "public"."campground_source" AS ENUM('nps', 'ridb', 'state', 'osm');
CREATE TYPE "public"."crowd_level" AS ENUM('low', 'moderate', 'high');

CREATE TABLE IF NOT EXISTS "trails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "osm_id" text NOT NULL UNIQUE,
  "osm_type" text NOT NULL,
  "name" text NOT NULL,
  "geometry" jsonb NOT NULL,
  "length_meters" double precision,
  "elevation_gain_meters" double precision,
  "difficulty" text,
  "sac_scale" text,
  "network" text,
  "operator" text,
  "wikipedia_url" text,
  "bbox" jsonb,
  "tags" jsonb,
  "cached_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "trail_research" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trail_id" uuid NOT NULL REFERENCES "trails"("id") ON DELETE cascade,
  "brief" jsonb NOT NULL,
  "researched_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "hike_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "trail_id" uuid REFERENCES "trails"("id") ON DELETE set null,
  "planned_date" timestamp,
  "notes" text,
  "waypoints" jsonb,
  "campground_ids" jsonb,
  "custom_geometry" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid REFERENCES "hike_plans"("id") ON DELETE set null,
  "trail_id" uuid REFERENCES "trails"("id") ON DELETE set null,
  "name" text,
  "started_at" timestamp NOT NULL,
  "ended_at" timestamp,
  "stats" jsonb,
  "notes" text,
  "track_geometry" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "activity_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "activity_id" uuid NOT NULL REFERENCES "activities"("id") ON DELETE cascade,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "elevation" double precision,
  "recorded_at" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "campgrounds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_id" text NOT NULL,
  "name" text NOT NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "state" text,
  "park_code" text,
  "park_name" text,
  "source" "campground_source" NOT NULL,
  "camping_type" "camping_type" NOT NULL,
  "description" text,
  "amenities" jsonb,
  "reservation_url" text,
  "permit_required" boolean DEFAULT false,
  "fees" jsonb,
  "metadata" jsonb,
  "cached_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "campgrounds_external_id_idx" ON "campgrounds" ("external_id");
CREATE INDEX IF NOT EXISTS "campgrounds_state_idx" ON "campgrounds" ("state");
CREATE INDEX IF NOT EXISTS "trails_osm_id_idx" ON "trails" ("osm_id");
