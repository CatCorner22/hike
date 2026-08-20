import { describe, expect, it } from "vitest";
import { parseBbox } from "@/lib/camping/bbox";
import { GET } from "./route";

describe("camping search bbox handling", () => {
  it.each([
    ["-105,39,-104,40", [-105, 39, -104, 40]],
    [null, null],
  ])("parses %s", (value, expected) => {
    expect(parseBbox(value)).toEqual(expected);
  });

  it.each([
    "1,2,3",
    "west,south,east,north",
    "-181,0,1,1",
    "0,-91,1,1",
    "10,0,5,1",
    "0,10,1,5",
  ])("rejects malformed bbox %s", async (bbox) => {
    expect(parseBbox(bbox)).toBeNull();
    const response = await GET(
      new Request(`http://localhost/api/camping/search?bbox=${bbox}`),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid bbox" });
  });

  it("applies a valid bbox when using fallback campground data", async () => {
    const response = await GET(
      new Request("http://localhost/api/camping/search?bbox=-123,37,-121,39"),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      campgrounds: Array<{ latitude: number; longitude: number }>;
    };
    expect(data.campgrounds.length).toBeGreaterThan(0);
    expect(
      data.campgrounds.every(
        ({ latitude, longitude }) =>
          longitude >= -123 &&
          longitude <= -121 &&
          latitude >= 37 &&
          latitude <= 39,
      ),
    ).toBe(true);
  });
});
