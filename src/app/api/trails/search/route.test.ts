import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ searchTrailsWithCache: vi.fn(async () => []) }));
vi.mock("@/lib/trails/service", () => ({ searchTrailsWithCache: mocks.searchTrailsWithCache }));

import { GET } from "./route";

describe("trail discovery search", () => {
  it("allows a nearby bounding-box search without inventing a text query", async () => {
    const response = await GET(new Request("http://localhost/api/trails/search?bbox=-120,37,-119,38"));
    expect(response.status).toBe(200);
    expect(mocks.searchTrailsWithCache).toHaveBeenCalledWith("", [-120, 37, -119, 38]);
  });

  it("requires either a name or a bounding box", async () => {
    const response = await GET(new Request("http://localhost/api/trails/search"));
    await expect(response.json()).resolves.toEqual({ trails: [] });
  });
});
