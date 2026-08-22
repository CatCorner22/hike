import { beforeEach, describe, expect, it, vi } from "vitest";

const getTrailDetail = vi.fn();
const hasDatabase = vi.fn(() => false);

vi.mock("@/lib/db", () => ({
  hasDatabase: () => hasDatabase(),
  getDb: () => {
    throw new Error("getDb should not run in this test");
  },
}));

vi.mock("@/lib/osm/overpass", () => ({
  getTrailDetail: (...args: unknown[]) => getTrailDetail(...args),
  searchTrails: async () => [],
}));

import { resolveStoredTrailId } from "./service";

describe("resolveStoredTrailId Overpass failures", () => {
  beforeEach(() => {
    hasDatabase.mockReturnValue(true);
    getTrailDetail.mockReset();
  });

  it("returns null when Overpass throws so copied geometry can still save a plan", async () => {
    getTrailDetail.mockRejectedValue(new Error("Overpass down"));
    expect(await resolveStoredTrailId("osm-relation-123")).toBeNull();
  });
});
