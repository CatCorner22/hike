import { describe, expect, it } from "vitest";
import { parseGpx } from "./index";

describe("parseGpx", () => {
  it("accepts trackpoint attributes in either order", () => {
    const geometry = parseGpx(`
      <gpx><trk><trkseg>
        <trkpt lon="-105.1" lat="40.1"></trkpt>
        <trkpt lat='40.2' lon='-105.2'></trkpt>
      </trkseg></trk></gpx>
    `);
    expect(geometry?.coordinates).toEqual([
      [-105.1, 40.1],
      [-105.2, 40.2],
    ]);
  });

  it.each([
    ["Infinity", "1"],
    ["NaN", "1"],
    ["91", "1"],
    ["1", "181"],
  ])("rejects unsafe coordinates lat=%s lon=%s", (lat, lon) => {
    expect(
      parseGpx(
        `<trkpt lat="${lat}" lon="${lon}"></trkpt><trkpt lat="1" lon="1"></trkpt>`,
      ),
    ).toBeNull();
  });
});
