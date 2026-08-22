import { describe, expect, it } from "vitest";
import { isStoredTrailRef, osmTrailId, parseOsmTrailId, trailPageHref } from "./ids";

describe("trail refs", () => {
  it("parses Explore osm hrefs", () => {
    expect(parseOsmTrailId("osm-relation-123")).toEqual({ osmType: "relation", osmId: "123" });
    expect(parseOsmTrailId("osm-way-9")).toEqual({ osmType: "way", osmId: "9" });
    expect(parseOsmTrailId("not-a-trail")).toBeNull();
    expect(osmTrailId("relation", "123")).toBe("osm-relation-123");
  });

  it("accepts UUIDs and osm hrefs as stored trail refs", () => {
    expect(isStoredTrailRef("osm-relation-123")).toBe(true);
    expect(isStoredTrailRef("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isStoredTrailRef("javascript:alert(1)")).toBe(false);
    expect(isStoredTrailRef("trail-xyz")).toBe(false);
  });

  it("prefers the OSM href so Overpass can resolve without a DB row", () => {
    expect(trailPageHref("550e8400-e29b-41d4-a716-446655440000", "relation", "123")).toBe(
      "/trails/osm-relation-123",
    );
    expect(trailPageHref("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/trails/550e8400-e29b-41d4-a716-446655440000",
    );
  });
});
