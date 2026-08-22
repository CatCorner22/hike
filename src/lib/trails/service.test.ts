import { describe, expect, it } from "vitest";
import { postgresTrailFk, resolveStoredTrailId } from "./service";

describe("resolveStoredTrailId", () => {
  it("keeps Explore ids on the file store and never writes an OSM href into a UUID FK", async () => {
    delete process.env.DATABASE_URL;
    expect(await resolveStoredTrailId(null)).toBeNull();
    expect(await resolveStoredTrailId("osm-relation-123")).toBe("osm-relation-123");
    expect(await resolveStoredTrailId("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(postgresTrailFk("osm-relation-123")).toBeNull();
    expect(postgresTrailFk("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });
});
