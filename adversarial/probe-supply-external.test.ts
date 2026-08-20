import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchElevationProfile } from "@/lib/geo";
import { fetchPackWeather } from "@/lib/offline/pack-weather";
import { searchTrails } from "@/lib/osm/overpass";

const originalFetch = globalThis.fetch;
afterEach(() => vi.unstubAllGlobals());

describe("supply external data request controls", () => {
  it("records abort-signal use for elevation, weather, and Overpass", async () => {
    const calls: Array<{ url: string; signal: boolean; body: string | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), signal: Boolean(init?.signal), body: typeof init?.body === "string" ? init.body : undefined });
      if (String(input).includes("open-elevation")) return new Response(JSON.stringify({ results: [{ elevation: 123 }] }), { status: 200, headers: { "content-type": "application/json" } });
      if (String(input).includes("open-meteo")) return new Response(JSON.stringify({ current: { temperature_2m: 1, relative_humidity_2m: 2, wind_speed_10m: 3 } }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ elements: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    await fetchElevationProfile({ type: "LineString", coordinates: [[-110, 40], [-110.1, 40.1]] }, 1);
    await fetchPackWeather(40, -110);
    await searchTrails("probe");
    console.log(JSON.stringify(calls, null, 2));
    expect(calls.map((c) => [c.url.includes("open-elevation") ? "elevation" : c.url.includes("open-meteo") ? "weather" : "overpass", c.signal])).toEqual([
      // Every third-party fetch must carry an abort signal. Elevation ran as a
      // bare fetch with no timeout at all, so a stalled service left "Prepare
      // offline" hanging at the trailhead with no way forward.
      ["elevation", true], ["weather", true], ["overpass", true],
    ]);
  });
});
