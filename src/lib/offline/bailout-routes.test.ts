import { describe, expect, it } from "vitest";
import {
  BAILOUT_ROUTE_DISCLAIMER,
  attachBailoutRoute,
  bailoutRouteCandidates,
  parseBailoutGpx,
  prepareBailoutRoute,
  validBailoutRoutes,
} from "./bailout-routes";

const main: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [-83.92, 35.96],
    [-83.90, 35.96],
  ],
};

function gpx(points: Array<[number, number]>): string {
  const pts = points.map(([lng, lat]) => `<trkpt lat="${lat}" lon="${lng}"></trkpt>`).join("");
  return `<gpx><trk><trkseg>${pts}</trkseg></trk></gpx>`;
}

describe("prepared bailout routes", () => {
  it("stores a GPX that meets the route and rejects one that would need a invented walk", () => {
    const near = parseBailoutGpx({
      routeId: "plan-1",
      name: "Forest road.gpx",
      gpx: gpx([[-83.91, 35.9603], [-83.91, 35.97]]),
      main,
    });
    expect("route" in near).toBe(true);
    if (!("route" in near)) return;
    expect(near.route.disclaimer).toBe(BAILOUT_ROUTE_DISCLAIMER);
    expect(near.route.join.offsetMeters).toBeLessThanOrEqual(80);

    const far = parseBailoutGpx({
      routeId: "plan-1",
      name: "Elsewhere.gpx",
      gpx: gpx([[-83.91, 36.02], [-83.90, 36.03]]),
      main,
    });
    expect(far).toMatchObject({ error: expect.stringMatching(/will not invent a connector/i) });
  });

  it("turns stored tracks into join candidates without adding geometry", () => {
    const prepared = prepareBailoutRoute({
      routeId: "plan-1",
      name: "Spur",
      geometry: { type: "LineString", coordinates: [[-83.91, 35.9602], [-83.91, 35.968]] },
      main,
    });
    expect("route" in prepared).toBe(true);
    if (!("route" in prepared)) return;
    const candidates = bailoutRouteCandidates([prepared.route]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].lat).toBe(prepared.route.join.lat);
    expect(candidates[0].note).toMatch(/user-supplied mapped path/i);
  });

  it("rejects a poisoned join, foreign route id, or forged disclaimer", () => {
    const prepared = prepareBailoutRoute({
      routeId: "plan-1",
      name: "Spur",
      geometry: { type: "LineString", coordinates: [[-83.91, 35.9602], [-83.91, 35.968]] },
      main,
    });
    expect("route" in prepared).toBe(true);
    if (!("route" in prepared)) return;
    expect(validBailoutRoutes([prepared.route], "plan-1", main)).toBe(true);
    expect(validBailoutRoutes([{ ...prepared.route, routeId: "plan-foreign" }], "plan-1", main)).toBe(false);
    expect(validBailoutRoutes([{ ...prepared.route, disclaimer: "Guaranteed exit." }], "plan-1", main)).toBe(false);
    expect(validBailoutRoutes([{
      ...prepared.route,
      join: { ...prepared.route.join, lat: 51.5, lng: -0.12, alongMeters: 12 },
    }], "plan-1", main)).toBe(false);
  });

  it("caps the number of stored tracks", () => {
    let routes: ReturnType<typeof attachBailoutRoute> = { routes: [] };
    for (let index = 0; index < 8; index += 1) {
      const prepared = prepareBailoutRoute({
        routeId: "plan-1",
        name: `Spur ${index}`,
        geometry: {
          type: "LineString",
          coordinates: [[-83.91 + index * 0.0002, 35.9602], [-83.91 + index * 0.0002, 35.968]],
        },
        main,
      });
      expect("route" in prepared).toBe(true);
      if (!("route" in prepared) || !("routes" in routes)) return;
      routes = attachBailoutRoute(routes.routes, prepared.route);
    }
    expect("routes" in routes && routes.routes).toHaveLength(8);
    const extra = prepareBailoutRoute({
      routeId: "plan-1",
      name: "Ninth",
      geometry: { type: "LineString", coordinates: [[-83.905, 35.9602], [-83.905, 35.969]] },
      main,
    });
    expect("route" in extra).toBe(true);
    if (!("route" in extra) || !("routes" in routes)) return;
    expect(attachBailoutRoute(routes.routes, extra.route)).toMatchObject({
      error: expect.stringMatching(/at most 8/i),
    });
  });
});
