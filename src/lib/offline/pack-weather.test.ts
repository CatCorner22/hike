import { describe, expect, it } from "vitest";
import { PACK_WEATHER_MAX_AGE_MS, formatPackWeatherNote, packWeatherFreshness } from "./pack-weather";

const fetchedAt = "2026-08-20T12:00:00.000Z";
const weather = {
  source: "open-meteo" as const,
  cachedAt: fetchedAt,
  fetchedAt,
  lat: 40,
  lng: -105,
  tempC: -8,
  windKph: 70,
};

describe("pack weather provenance and freshness", () => {
  it("returns explicit stale state after the documented six-hour maximum age", () => {
    const result = packWeatherFreshness(weather, Date.parse(fetchedAt) + PACK_WEATHER_MAX_AGE_MS + 1);

    expect(result).toMatchObject({
      kind: "stale",
      lat: 40,
      lng: -105,
      reason: expect.stringMatching(/older than 6 hours/i),
    });
  });

  it("retains fetch coordinates and timestamp in a fresh state", () => {
    expect(packWeatherFreshness(weather, Date.parse(fetchedAt) + 60_000)).toEqual({
      kind: "fresh",
      ageMs: 60_000,
      fetchedAt,
      lat: 40,
      lng: -105,
    });
  });

  it("does not call a future-dated snapshot fresh when the clock is behind", () => {
    expect(packWeatherFreshness(weather, Date.parse(fetchedAt) - 3_600_000)).toMatchObject({
      kind: "unavailable",
      reason: expect.stringMatching(/clock/i),
    });
  });

  it("does not treat legacy weather without a location as usable current conditions", () => {
    expect(packWeatherFreshness({ ...weather, lat: undefined, lng: undefined })).toMatchObject({
      kind: "unavailable",
      reason: expect.stringMatching(/source location/i),
    });
  });

  it("formats fresh weather with age and coordinates", () => {
    const note = formatPackWeatherNote(weather, Date.parse(fetchedAt) + 3_600_000);
    expect(note).toMatch(/1h ago/);
    expect(note).toMatch(/40\.00/);
  });
});
