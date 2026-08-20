import { describe, expect, it } from "vitest";
import { createProjector, followWindow, metresPerDegreeLongitude } from "./project";
import { latLngToUtm, utmToLatLng } from "@/lib/safety/usng";

const M_PER_DEG_LAT = 111_132;
// A phone canvas: the aspect ratio compounds the projection error, so use a real one.
const WIDTH = 390;
const HEIGHT = 700;
const PADDING = 28;

function offset(lat: number, lng: number, northM: number, eastM: number) {
  return {
    lat: lat + northM / M_PER_DEG_LAT,
    lng: lng + eastM / metresPerDegreeLongitude(lat),
  };
}

/** Bearing as it appears on the canvas, degrees clockwise from screen-up. */
function screenBearing(
  projector: ReturnType<typeof createProjector>,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const a = projector.toPx(from.lng, from.lat);
  const b = projector.toPx(to.lng, to.lat);
  return ((Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI + 360) % 360;
}

describe("navigation canvas projection", () => {
  /**
   * Regression: longitude was mapped straight to x with no cos(latitude) correction, and
   * the bbox was stretched to fill a non-square canvas. A true 45 deg bearing rendered at
   * 29.7 deg at 25 N and 33.2 deg at 37.7 N — up to 15 deg of error on a map used to walk
   * back to a trail.
   */
  it("renders a true bearing at the same angle on screen", () => {
    for (const lat of [25, 37.7, 45, 50, 61, -33]) {
      const user = { lat, lng: -119.6 };
      const projector = createProjector(followWindow(user), WIDTH, HEIGHT, PADDING);
      for (const [northM, eastM, expected] of [
        [100, 100, 45],
        [100, 0, 0],
        [0, 100, 90],
        [-100, 0, 180],
        [0, -100, 270],
        [100, -100, 315],
        [50, 150, 71.57],
      ] as const) {
        const target = offset(lat, user.lng, northM, eastM);
        const rendered = screenBearing(projector, user, target);
        // Shortest angular distance, so 359 vs 1 reads as 2 degrees apart.
        const delta = Math.abs((((rendered - expected + 180) % 360) + 360) % 360 - 180);
        expect(delta, `lat ${lat}, ${northM}N ${eastM}E`).toBeLessThan(0.5);
      }
    }
  });

  it("renders a square of ground as a square on screen", () => {
    for (const lat of [25, 37.7, 61]) {
      const user = { lat, lng: -119.6 };
      const projector = createProjector(followWindow(user), WIDTH, HEIGHT, PADDING);
      const origin = projector.toPx(user.lng, user.lat);
      const east = projector.toPx(offset(lat, user.lng, 0, 100).lng, user.lat);
      const north = projector.toPx(user.lng, offset(lat, user.lng, 100, 0).lat);
      const eastPx = east.x - origin.x;
      const northPx = origin.y - north.y;
      expect(eastPx / northPx, `lat ${lat}`).toBeCloseTo(1, 2);
    }
  });

  it("reports one pixels-per-metre scale that matches what it draws", () => {
    const user = { lat: 37.7, lng: -119.6 };
    const projector = createProjector(followWindow(user), WIDTH, HEIGHT, PADDING);
    const origin = projector.toPx(user.lng, user.lat);
    const north = projector.toPx(user.lng, offset(37.7, user.lng, 250, 0).lat);
    expect((origin.y - north.y) / 250).toBeCloseTo(projector.pxPerMetre, 6);
  });

  it("keeps everything inside the canvas", () => {
    const user = { lat: 37.7, lng: -119.6 };
    const bbox = followWindow(user);
    const projector = createProjector(bbox, WIDTH, HEIGHT, PADDING);
    for (const [lng, lat] of [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
      [bbox[0], bbox[3]],
      [bbox[2], bbox[1]],
    ]) {
      const point = projector.toPx(lng, lat);
      expect(point.x).toBeGreaterThanOrEqual(-0.001);
      expect(point.x).toBeLessThanOrEqual(WIDTH + 0.001);
      expect(point.y).toBeGreaterThanOrEqual(-0.001);
      expect(point.y).toBeLessThanOrEqual(HEIGHT + 0.001);
    }
  });
});

describe("followWindow", () => {
  /**
   * Regression: the window was a fixed +/-0.003 deg around the user, which is only
   * +/-264 m east-west at 37.7 N and +/-162 m at 61 N. Off-trail goes critical at 80 m,
   * so the route could be off-canvas while the banner said to walk back to it.
   */
  it("keeps the point you are being told to walk to on screen", () => {
    const user = { lat: 37.7, lng: -119.6 };
    for (const distanceM of [50, 150, 400, 1200, 5000]) {
      const nearest = offset(user.lat, user.lng, distanceM * 0.6, distanceM * 0.8);
      const bbox = followWindow(user, [nearest]);
      const projector = createProjector(bbox, WIDTH, HEIGHT, PADDING);
      const point = projector.toPx(nearest.lng, nearest.lat);
      expect(point.x, `${distanceM} m`).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(WIDTH);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(HEIGHT);
    }
  });

  it("does not zoom in tighter than the minimum radius when everything is close", () => {
    const user = { lat: 37.7, lng: -119.6 };
    const bbox = followWindow(user, [offset(user.lat, user.lng, 5, 5)]);
    expect(bbox[3] - bbox[1]).toBeCloseTo(0.006, 6);
  });

  it("ignores missing or non-finite points", () => {
    const user = { lat: 37.7, lng: -119.6 };
    const bbox = followWindow(user, [null, undefined, { lat: Number.NaN, lng: 0 }]);
    expect(bbox.every(Number.isFinite)).toBe(true);
    expect(bbox[3] - bbox[1]).toBeCloseTo(0.006, 6);
  });
});

describe("UTM grid overlay", () => {
  /**
   * The navigate canvas draws a real 100 m UTM grid because the SAR readouts next to it
   * are UTM/USNG. Under the old projection those squares rendered at a 0.65 aspect at
   * 37.7 N, so a grid sold as 100 m squares was visibly rectangular.
   */
  it("draws 100 m UTM squares as squares", () => {
    for (const [lat, lng] of [
      [37.7, -119.6],
      [25.1, -80.4],
      [61.2, -149.9],
    ] as const) {
      const utm = latLngToUtm(lat, lng);
      const projector = createProjector(followWindow({ lat, lng }), 390, 700, 28);

      const originE = Math.floor(utm.easting / 100) * 100;
      const originN = Math.floor(utm.northing / 100) * 100;
      const corner = (e: number, n: number) => {
        const geo = utmToLatLng({ zone: utm.zone, easting: e, northing: n, north: utm.north });
        return projector.toPx(geo.lng, geo.lat);
      };

      const origin = corner(originE, originN);
      const east = corner(originE + 100, originN);
      const north = corner(originE, originN + 100);
      const eastPx = Math.hypot(east.x - origin.x, east.y - origin.y);
      const northPx = Math.hypot(north.x - origin.x, north.y - origin.y);

      expect(eastPx / northPx, `lat ${lat}`).toBeCloseTo(1, 1);
      // And the grid line spacing matches the reported scale.
      expect(eastPx / 100).toBeCloseTo(projector.pxPerMetre, 2);
    }
  });
});
