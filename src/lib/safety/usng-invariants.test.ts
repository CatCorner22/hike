import { describe, expect, it } from "vitest";
import { formatMgrs10, formatUsng, latLngToUtm, parseUsng } from "./usng";

describe("USNG invariants", () => {
  it("round-trips valid UTM positions and rejects every polar out-of-domain position", () => {
    for (const origin of [
      { lat: -79.999, lng: 0 },
      { lat: -45, lng: 179.9 },
      { lat: 0, lng: 180 },
      { lat: 37.7459, lng: -119.5936 },
      { lat: 83.999, lng: 174 },
    ]) {
      const grid = formatMgrs10(origin.lat, origin.lng)!;
      const parsed = parseUsng(grid, origin)!;
      const dLat = (origin.lat - parsed.lat) * 111_320;
      const dLng = (origin.lng - parsed.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180);
      expect(Math.hypot(dLat, dLng)).toBeLessThan(25);
    }
    for (const lat of [-90, -80.001, 84.001, 90]) {
      expect(latLngToUtm(lat, 0)).toBeNull();
      expect(formatUsng(lat, 0)).toBeNull();
      expect(formatMgrs10(lat, 0)).toBeNull();
    }
  });
});
