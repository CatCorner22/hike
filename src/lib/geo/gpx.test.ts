import { describe, expect, it } from "vitest";
import { parseGpx } from "./index";

describe("parseGpx", () => {
  it("accepts lon-before-lat attributes", () => {
    const geometry = parseGpx('<gpx><trk><trkseg><trkpt lon="-105.2" lat="39.7"/><trkpt lon="-105.1" lat="39.8"/></trkseg></trk></gpx>');
    expect(geometry).toEqual({ type: "LineString", coordinates: [[-105.2, 39.7], [-105.1, 39.8]] });
  });

  it("preserves multiple track segment boundaries", () => {
    const geometry = parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg><trkseg><trkpt lat="5" lon="6"/><trkpt lat="7" lon="8"/></trkseg></trk></gpx>');
    expect(geometry).toEqual({ type: "MultiLineString", coordinates: [[[2, 1], [4, 3]], [[6, 5], [8, 7]]] });
  });

  it("parses self-closing track points", () => {
    const geometry = parseGpx('<gpx><trkpt lat="40" lon="-100" /><trkpt lat="41" lon="-101" /></gpx>');
    expect(geometry).toEqual({ type: "LineString", coordinates: [[-100, 40], [-101, 41]] });
  });

  it("uses route points when no track points are present", () => {
    const geometry = parseGpx('<gpx><rte><rtept lon="10" lat="20"/><rtept lon="11" lat="21"/></rte></gpx>');
    expect(geometry).toEqual({ type: "LineString", coordinates: [[10, 20], [11, 21]] });
  });

  it("returns null for garbage input", () => {
    expect(parseGpx("this is not a GPX file")).toBeNull();
  });
});
