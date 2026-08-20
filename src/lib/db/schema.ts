import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const campingTypeEnum = pgEnum("camping_type", [
  "developed_tent",
  "rv",
  "backcountry",
  "walk_in",
]);

export const campgroundSourceEnum = pgEnum("campground_source", [
  "nps",
  "ridb",
  "state",
  "osm",
]);

export const crowdLevelEnum = pgEnum("crowd_level", [
  "low",
  "moderate",
  "high",
]);

export const trails = pgTable("trails", {
  id: uuid("id").primaryKey().defaultRandom(),
  osmId: text("osm_id").notNull(),
  osmType: text("osm_type").notNull(),
  name: text("name").notNull(),
  geometry: jsonb("geometry").notNull(),
  lengthMeters: doublePrecision("length_meters"),
  elevationGainMeters: doublePrecision("elevation_gain_meters"),
  difficulty: text("difficulty"),
  sacScale: text("sac_scale"),
  network: text("network"),
  operator: text("operator"),
  wikipediaUrl: text("wikipedia_url"),
  bbox: jsonb("bbox"),
  tags: jsonb("tags"),
  cachedAt: timestamp("cached_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("trails_osm_id_osm_type_unique").on(table.osmId, table.osmType),
]);

export const trailResearch = pgTable("trail_research", {
  id: uuid("id").primaryKey().defaultRandom(),
  trailId: uuid("trail_id")
    .notNull()
    .references(() => trails.id, { onDelete: "cascade" }),
  brief: jsonb("brief").notNull(),
  researchedAt: timestamp("researched_at").defaultNow().notNull(),
});

export const hikePlans = pgTable("hike_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable so the migration does not have to invent an owner for pre-existing rows.
  // The API treats a NULL owner as belonging to nobody, so legacy rows are invisible
  // until they are claimed — see drizzle/0002_owner_scoping.sql.
  ownerId: text("owner_id"),
  name: text("name").notNull(),
  trailId: uuid("trail_id").references(() => trails.id, { onDelete: "set null" }),
  plannedDate: timestamp("planned_date"),
  notes: text("notes"),
  waypoints: jsonb("waypoints"),
  campgroundIds: jsonb("campground_ids").$type<string[]>(),
  customGeometry: jsonb("custom_geometry"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [index("hike_plans_owner_id_idx").on(table.ownerId)]);

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id"),
  planId: uuid("plan_id").references(() => hikePlans.id, { onDelete: "set null" }),
  trailId: uuid("trail_id").references(() => trails.id, { onDelete: "set null" }),
  name: text("name"),
  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at"),
  stats: jsonb("stats"),
  notes: text("notes"),
  trackGeometry: jsonb("track_geometry"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [index("activities_owner_id_idx").on(table.ownerId)]);

export const activityPoints = pgTable("activity_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id")
    .notNull()
    .references(() => activities.id, { onDelete: "cascade" }),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  elevation: doublePrecision("elevation"),
  recordedAt: timestamp("recorded_at").notNull(),
});

export const campgrounds = pgTable("campgrounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  state: text("state"),
  parkCode: text("park_code"),
  parkName: text("park_name"),
  source: campgroundSourceEnum("source").notNull(),
  campingType: campingTypeEnum("camping_type").notNull(),
  description: text("description"),
  amenities: jsonb("amenities"),
  reservationUrl: text("reservation_url"),
  permitRequired: boolean("permit_required").default(false),
  fees: jsonb("fees"),
  metadata: jsonb("metadata"),
  cachedAt: timestamp("cached_at").defaultNow().notNull(),
});

export type Trail = typeof trails.$inferSelect;
export type HikePlan = typeof hikePlans.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Campground = typeof campgrounds.$inferSelect;
export type TrailResearch = typeof trailResearch.$inferSelect;
