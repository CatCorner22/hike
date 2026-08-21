import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLD_WATCH_C,
  GUST_WATCH_KPH,
  HAZARD_BRIEF_DISCLAIMER,
  HAZARD_BRIEF_MAX_AGE_MS,
  HAZARD_FETCH_CLUSTER_M,
  HEAT_WATCH_C,
  PRECIP_WATCH_MM,
  buildHazardBrief,
  clusterHazardSamples,
  deriveHazardObservations,
  describeHazardBrief,
  fetchRouteHazardBrief,
  hazardBriefFreshness,
  packWeatherFromHazardBrief,
  parseOpenMeteoForecast,
  selectHazardSamplePoints,
  validHazardBrief,
} from "./hazard-brief";

const NOW = Date.now() - 60_000;
const PARSE_NOW = Date.parse("2026-08-21T12:00:00.000Z");

function hour(offsetHours: number, extras: Partial<{
  tempC: number | null;
  rhPct: number | null;
  precipMm: number | null;
  precipProb: number | null;
  windKph: number | null;
  gustKph: number | null;
  weatherCode: number | null;
}> = {}) {
  return {
    time: new Date(NOW + offsetHours * 3_600_000).toISOString().slice(0, 16),
    tempC: extras.tempC ?? 18,
    rhPct: extras.rhPct ?? 50,
    precipMm: extras.precipMm ?? 0,
    precipProb: extras.precipProb ?? 10,
    windKph: extras.windKph ?? 12,
    gustKph: extras.gustKph ?? 18,
    weatherCode: extras.weatherCode ?? 1,
  };
}

function shortRoute(): GeoJSON.LineString {
  return { type: "LineString", coordinates: [[-83.92, 35.96], [-83.91, 35.97]] };
}

function longRoute(): GeoJSON.LineString {
  return {
    type: "LineString",
    coordinates: [
      [-84.0, 35.5],
      [-83.5, 35.7],
      [-83.0, 35.9],
      [-82.5, 36.1],
      [-82.0, 36.3],
    ],
  };
}

describe("hazard sample selection", () => {
  it("includes endpoints and does not invent points off the line", () => {
    const points = selectHazardSamplePoints(shortRoute());
    expect(points[0]?.distanceMeters).toBe(0);
    expect(points.at(-1)?.distanceMeters).toBeGreaterThan(0);
    expect(points.every((point) => point.lat >= 35.96 && point.lat <= 35.97)).toBe(true);
  });

  it("caps long routes and clusters nearby samples into one fetch", () => {
    const points = selectHazardSamplePoints(longRoute());
    expect(points.length).toBeLessThanOrEqual(5);
    expect(points[0].distanceMeters).toBe(0);
    const nearby = [
      { distanceMeters: 0, lat: 35.96, lng: -83.92 },
      { distanceMeters: 500, lat: 35.961, lng: -83.919 },
    ];
    expect(clusterHazardSamples(nearby)).toHaveLength(1);
    const far = [
      { distanceMeters: 0, lat: 35.96, lng: -83.92 },
      { distanceMeters: 80_000, lat: 36.6, lng: -83.0 },
    ];
    expect(haversineHint(far[0], far[1])).toBeGreaterThan(HAZARD_FETCH_CLUSTER_M);
    expect(clusterHazardSamples(far)).toHaveLength(2);
  });
});

function haversineHint(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

describe("open-meteo parse and observation thresholds", () => {
  it("keeps future hours and drops hours already in the past", () => {
    const parsed = parseOpenMeteoForecast({
      hourly: {
        time: ["2026-08-21T06:00", "2026-08-21T12:00", "2026-08-21T15:00", "2026-08-21T16:00", "2026-08-21T18:00"],
        temperature_2m: [10, 18, 20, 21, 17],
      },
    }, PARSE_NOW);
    expect(parsed?.hours.map((slot) => slot.time)).toEqual([
      "2026-08-21T12:00",
      "2026-08-21T15:00",
      "2026-08-21T18:00",
    ]);
  });

  it("flags heat, cold, wind, precip, and thunderstorms from numbers only", () => {
    const observations = deriveHazardObservations([
      {
        distanceMeters: 1000,
        lat: 35.96,
        lng: -83.92,
        hours: [
          hour(0, { tempC: HEAT_WATCH_C, rhPct: 20 }),
          hour(3, { tempC: COLD_WATCH_C, windKph: 4 }),
          hour(6, { gustKph: GUST_WATCH_KPH }),
          hour(9, { precipMm: PRECIP_WATCH_MM }),
          hour(12, { weatherCode: 95 }),
        ],
      },
    ]);
    expect(observations.map((item) => item.kind).sort()).toEqual(["cold", "heat", "lightning", "weather", "wind"]);
    expect(observations.every((item) => item.source === "open-meteo")).toBe(true);
  });

  it("does not invent a hazard when the snapshot stays below thresholds", () => {
    const observations = deriveHazardObservations([
      { distanceMeters: 0, lat: 35.96, lng: -83.92, hours: [hour(0)] },
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ kind: "weather", severity: "info" });
    expect(observations[0].title).toMatch(/no stored forecast thresholds/i);
  });

  it("uses heat index and wind chill when those formulas apply", () => {
    const hot = deriveHazardObservations([
      { distanceMeters: 0, lat: 35, lng: -83, hours: [hour(0, { tempC: 34, rhPct: 70 })] },
    ]);
    expect(hot.some((item) => item.kind === "heat" && /heat index/i.test(item.detail ?? ""))).toBe(true);
    const cold = deriveHazardObservations([
      { distanceMeters: 0, lat: 35, lng: -83, hours: [hour(0, { tempC: -5, windKph: 40 })] },
    ]);
    expect(cold.some((item) => item.kind === "cold" && /wind chill/i.test(item.detail ?? ""))).toBe(true);
  });
});

describe("hazard brief validation and freshness", () => {
  const brief = buildHazardBrief({
    routeId: "plan-honest",
    samples: [{ distanceMeters: 0, lat: 35.96, lng: -83.92, hours: [hour(0)] }],
    sunrise: "2026-08-21T10:40",
    sunset: "2026-08-22T00:10",
    now: NOW,
  });

  it("accepts a well-formed brief and rejects poisoned copies", () => {
    expect(validHazardBrief(brief, "plan-honest", [-84, 35.9, -83.8, 36])).toBe(true);
    expect(validHazardBrief({ ...brief, routeId: "plan-foreign" }, "plan-honest")).toBe(false);
    expect(validHazardBrief({ ...brief, disclaimer: "Current weather. You are safe." }, "plan-honest")).toBe(false);
    expect(validHazardBrief({
      ...brief,
      observations: [{ ...brief.observations[0], kind: "portal" as never }],
    }, "plan-honest")).toBe(false);
    expect(validHazardBrief({
      ...brief,
      samples: [{ ...brief.samples[0], lat: 10, lng: 10 }],
    }, "plan-honest", [-84, 35.9, -83.8, 36])).toBe(false);
    expect(validHazardBrief({ ...brief, expiresAt: brief.generatedAt }, "plan-honest")).toBe(false);
  });

  it("marks the snapshot stale after six hours and never as live weather", () => {
    expect(hazardBriefFreshness(brief, NOW + 60_000).kind).toBe("fresh");
    expect(hazardBriefFreshness(brief, NOW + HAZARD_BRIEF_MAX_AGE_MS + 1)).toMatchObject({
      kind: "stale",
      reason: expect.stringMatching(/older than 6 hours/i),
    });
    expect(describeHazardBrief(brief, NOW + 3_600_000)).toContain(HAZARD_BRIEF_DISCLAIMER);
    expect(describeHazardBrief(brief, NOW + 3_600_000)).toMatch(/not current weather/i);
    expect(describeHazardBrief(brief, NOW + 3_600_000)).not.toMatch(/\bis current weather\b/i);
  });

  it("can seed the pack-time weather snapshot from the first hour", () => {
    const weather = packWeatherFromHazardBrief(brief);
    expect(weather).toMatchObject({
      source: "open-meteo",
      lat: 35.96,
      lng: -83.92,
      tempC: 18,
      note: expect.stringMatching(/not a live forecast/i),
    });
  });
});

describe("hazard brief fetch fail-open", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when Open-Meteo is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    await expect(fetchRouteHazardBrief({
      routeId: "plan-honest",
      geometry: shortRoute(),
      now: NOW,
    })).resolves.toBeNull();
  });

  it("builds a brief from a successful forecast response", async () => {
    const t0 = new Date(NOW).toISOString().slice(0, 16);
    const t1 = new Date(NOW + 3 * 3_600_000).toISOString().slice(0, 16);
    const payload = {
      hourly: {
        time: [t0, t1],
        temperature_2m: [17, 16],
        relative_humidity_2m: [40, 45],
        precipitation: [0, 0],
        precipitation_probability: [5, 10],
        wind_speed_10m: [8, 9],
        wind_gusts_10m: [14, 16],
        weather_code: [1, 2],
      },
      daily: {
        sunrise: [new Date(NOW - 2 * 3_600_000).toISOString().slice(0, 16)],
        sunset: [new Date(NOW + 10 * 3_600_000).toISOString().slice(0, 16)],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      body: null,
      text: async () => JSON.stringify(payload),
    })));
    const brief = await fetchRouteHazardBrief({
      routeId: "plan-honest",
      geometry: shortRoute(),
      now: NOW,
    });
    expect(brief?.routeId).toBe("plan-honest");
    expect(brief?.disclaimer).toBe(HAZARD_BRIEF_DISCLAIMER);
    expect(brief?.sunrise).toBe(payload.daily.sunrise[0]);
    expect(brief?.observations[0]?.severity).toBe("info");
  });
});
