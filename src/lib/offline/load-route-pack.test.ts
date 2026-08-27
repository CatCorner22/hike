import { describe, expect, it } from "vitest";
import { enrichRoutePack, withNetworkTimeout } from "./load-route-pack";
import { buildRoutePack } from "./route-pack";
import { prepareBailoutRoute } from "./bailout-routes";
import type { TerrainGrid } from "./terrain-grid";

describe("withNetworkTimeout", () => {
  it("aborts the in-flight work when time runs out", async () => {
    let aborted = false;
    await expect(
      withNetworkTimeout((signal) => {
        return new Promise<string>((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }, 20),
    ).rejects.toThrow("Network timeout");
    expect(aborted).toBe(true);
  });

  it("returns the value when the factory finishes in time", async () => {
    await expect(withNetworkTimeout(async () => "ok", 200)).resolves.toBe("ok");
  });
});

describe("enrichRoutePack", () => {
  const geometry: GeoJSON.LineString = {
    type: "LineString",
    coordinates: [[-83.92, 35.96], [-83.90, 35.96]],
  };

  it("keeps a user-supplied bailout track when the plan page rebuilds the pack", () => {
    const prepared = prepareBailoutRoute({
      routeId: "plan-keep",
      name: "Spur",
      geometry: { type: "LineString", coordinates: [[-83.91, 35.9602], [-83.91, 35.968]] },
      main: geometry,
    });
    expect("route" in prepared).toBe(true);
    if (!("route" in prepared)) return;
    const existing = buildRoutePack({
      id: "plan-keep",
      name: "Kept",
      geometry,
      bailoutRoutes: [prepared.route],
    });
    const rebuilt = buildRoutePack({ id: "plan-keep", name: "Rebuilt from server", geometry });
    const merged = enrichRoutePack(rebuilt, existing);
    expect(merged.bailoutRoutes).toHaveLength(1);
    expect(merged.bailoutRoutes?.[0].name).toBe("Spur");
    expect(merged.name).toBe("Rebuilt from server");
  });

  it("drops poisoned weather instead of throwing during a plan rebuild", () => {
    const existing = {
      ...buildRoutePack({ id: "plan-keep", name: "Kept", geometry }),
      weather: { source: "open-meteo" as const, cachedAt: "not-a-date", tempC: Number.NaN },
    };
    const rebuilt = buildRoutePack({ id: "plan-keep", name: "Rebuilt from server", geometry });
    const merged = enrichRoutePack(rebuilt, existing);
    expect(merged.weather).toBeUndefined();
    expect(merged.geometry).toEqual(geometry);
  });

  it("drops a bailout that no longer meets a changed main route", () => {
    const prepared = prepareBailoutRoute({
      routeId: "plan-keep",
      name: "Spur",
      geometry: { type: "LineString", coordinates: [[-83.91, 35.9602], [-83.91, 35.968]] },
      main: geometry,
    });
    expect("route" in prepared).toBe(true);
    if (!("route" in prepared)) return;
    const existing = buildRoutePack({
      id: "plan-keep",
      name: "Kept",
      geometry,
      bailoutRoutes: [prepared.route],
    });
    const moved: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [[-82.0, 36.5], [-81.9, 36.5]],
    };
    const rebuilt = buildRoutePack({ id: "plan-keep", name: "Moved", geometry: moved });
    expect(enrichRoutePack(rebuilt, existing).bailoutRoutes).toBeUndefined();
  });

  const terrain: TerrainGrid = {
    bbox: [-83.94, 35.94, -83.88, 35.98],
    cols: 2,
    rows: 2,
    elevations: [120, 140, 130, 150],
    spacingMeters: 400,
    source: "open-elevation",
    fetchedAt: new Date().toISOString(),
  };

  it("keeps the relief grid when the server rebuild covers the same ground", () => {
    // Regression: the navigate screen's Refresh route rebuilt a bare pack and
    // enrich dropped terrain unconditionally, deleting the relief shading a
    // hiker had prepared the night before.
    const existing = buildRoutePack({ id: "plan-keep", name: "Kept", geometry, terrain });
    const rebuilt = buildRoutePack({ id: "plan-keep", name: "Rebuilt from server", geometry });
    expect(enrichRoutePack(rebuilt, existing).terrain).toEqual(terrain);
  });

  it("drops a relief grid that no longer covers a moved route", () => {
    const existing = buildRoutePack({ id: "plan-keep", name: "Kept", geometry, terrain });
    const moved: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [[-82.0, 36.5], [-81.9, 36.5]],
    };
    const rebuilt = buildRoutePack({ id: "plan-keep", name: "Moved", geometry: moved });
    expect(enrichRoutePack(rebuilt, existing).terrain).toBeUndefined();
  });
});
