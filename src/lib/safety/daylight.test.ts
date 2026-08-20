import { describe, expect, it } from "vitest";
import { daylightStatus, daylightWarning, minutesUntilSunset } from "./daylight";

// Yosemite Valley. Sunset on 2026-08-20 is about 19:45 PDT (02:45Z on the 21st).
const YOSEMITE = { lat: 37.75, lng: -119.6 };
const pdt = (day: number, hour: number) =>
  new Date(Date.UTC(2026, 7, day + (hour + 7 >= 24 ? 1 : 0), (hour + 7) % 24, 0));

describe("daylightStatus", () => {
  it("treats mid-afternoon in California as daylight", () => {
    const status = daylightStatus(new Date("2026-06-21T21:00:00Z"), 37.77, -122.42);
    expect(status.isDark).toBe(false);
    expect(status.minutesUntilSunset).toBeGreaterThan(60);
    expect(status.warning).toBeNull();
  });

  it("warns after local sunset", () => {
    const status = daylightStatus(new Date("2026-06-22T06:00:00Z"), 37.77, -122.42);
    expect(status.isDark).toBe(true);
    expect(status.warning).toMatch(/dark/i);
  });

  it("warns in the hour before sunset", () => {
    expect(daylightWarning(45, false)).toMatch(/sunset/i);
    expect(daylightWarning(10, false)).toMatch(/turnaround/i);
  });

  /**
   * Regression. The solar day used to be taken from `getUTCDate()`, so once local time
   * crossed 00:00 UTC — 17:00 PDT — the calculation switched to *tomorrow's* sunrise and
   * sunset. Every Californian evening reported "It is dark" with almost three hours of
   * daylight left, and `minutesUntilSunset` read about 1600.
   */
  it("stays light through the evening it is actually light", () => {
    for (const hour of [14, 15, 16, 17, 18, 19]) {
      const status = daylightStatus(pdt(20, hour), YOSEMITE.lat, YOSEMITE.lng);
      expect(status.isDark, `${hour}:00 PDT`).toBe(false);
      expect(status.minutesUntilSunset, `${hour}:00 PDT`).toBeGreaterThan(0);
      expect(status.minutesUntilSunset, `${hour}:00 PDT`).toBeLessThan(6 * 60);
    }
  });

  it("goes dark after the sun actually sets", () => {
    for (const hour of [20, 21, 22, 23]) {
      const status = daylightStatus(pdt(20, hour), YOSEMITE.lat, YOSEMITE.lng);
      expect(status.isDark, `${hour}:00 PDT`).toBe(true);
    }
  });

  it("counts down rather than jumping to tomorrow's sunset", () => {
    const at16 = daylightStatus(pdt(20, 16), YOSEMITE.lat, YOSEMITE.lng);
    const at18 = daylightStatus(pdt(20, 18), YOSEMITE.lat, YOSEMITE.lng);
    expect(at18.minutesUntilSunset).toBeLessThan(at16.minutesUntilSunset);
    expect(at16.minutesUntilSunset - at18.minutesUntilSunset).toBeCloseTo(120, -1);
  });

  it("reports negative minutes once the sun is down", () => {
    expect(minutesUntilSunset(pdt(20, 21), YOSEMITE.lat, YOSEMITE.lng)).toBeLessThan(0);
  });

  // The bug was longitude-driven, so it hit every US time zone at a different hour.
  it("holds across US longitudes at the hour each one crossed 00:00 UTC", () => {
    const places = [
      { name: "Pacific", lat: 37.75, lng: -119.6, localHour: 17 },
      { name: "Mountain", lat: 39.6, lng: -106.0, localHour: 18 },
      { name: "Central", lat: 35.5, lng: -92.0, localHour: 19 },
      { name: "Eastern", lat: 38.5, lng: -78.4, localHour: 19 },
    ];
    for (const place of places) {
      const utcHour = place.localHour + Math.round(-place.lng / 15);
      const when = new Date(Date.UTC(2026, 5, 15 + Math.floor(utcHour / 24), utcHour % 24, 0));
      const status = daylightStatus(when, place.lat, place.lng);
      // Mid-June: all four are comfortably in daylight at these local hours.
      expect(status.isDark, place.name).toBe(false);
      expect(status.minutesUntilSunset, place.name).toBeGreaterThan(0);
      expect(status.minutesUntilSunset, place.name).toBeLessThan(6 * 60);
    }
  });

  it("still reports polar night and midnight sun", () => {
    const polar = daylightStatus(new Date("2026-12-21T12:00:00Z"), 78.2, 15.6);
    expect(polar.isDark).toBe(true);
    expect(polar.warning).toMatch(/Polar night/);

    const midnightSun = daylightStatus(new Date("2026-06-21T12:00:00Z"), 78.2, 15.6);
    expect(midnightSun.isDark).toBe(false);
  });
});
