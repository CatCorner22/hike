import { describe, expect, it } from "vitest";
import {
  moonPhase,
  roundBearing,
  shadowLengthCm,
  shadowStickHeading,
  sunCompassHint,
  sunPosition,
} from "./astro";
import { sunVsWatchCheck } from "./tactics";

describe("moonPhase", () => {
  it("calls a new moon nearly dark", () => {
    const phase = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14)));
    expect(phase.illumination).toBeLessThan(0.05);
    expect(phase.name).toMatch(/New/);
  });

  it("calls ~15 days later a full moon", () => {
    const phase = moonPhase(new Date(Date.UTC(2000, 0, 21, 18, 14)));
    expect(phase.illumination).toBeGreaterThan(0.9);
    expect(phase.name).toMatch(/Full/);
  });

  it("puts the noon sun in the southern sky in California", () => {
    const pos = sunPosition(new Date(Date.UTC(2026, 5, 21, 20, 0)), 37.7, -119.6);
    expect(pos).not.toBeNull();
    expect(pos!.elevation).toBeGreaterThan(20);
    expect(pos!.azimuth).toBeGreaterThan(90);
    expect(pos!.azimuth).toBeLessThan(270);
  });

  it("points the shadow opposite the sun", () => {
    expect(shadowStickHeading(180).shadowToward).toBe(0);
  });
});

/** Same low-precision solar algorithm, but anchored at J2000 rather than day-of-year. */
function referenceSun(date: Date, lat: number, lng: number) {
  const rad = Math.PI / 180;
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const meanLng = (280.46 + 0.9856474 * n) % 360;
  const anomaly = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (meanLng + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * rad;
  const obliquity = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = ((gmst * 15 + lng) * rad + 8 * Math.PI) % (2 * Math.PI);
  const ha = lst - ra;
  const phi = lat * rad;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = (Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha)) * 180) / Math.PI;
  return { azimuth: ((az % 360) + 360) % 360, elevation: (elevation * 180) / Math.PI };
}

const bearingDelta = (a: number, b: number) =>
  Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);

describe("solar position accuracy", () => {
  /**
   * `sunPosition` drops the year and works from day-of-year, which only holds because
   * the mean motion constants nearly close over a year. The residual is the leap cycle,
   * so it has to be measured across one rather than assumed.
   */
  it("tracks a correct-epoch reference across a leap cycle", () => {
    const sites = [
      [37.7, -119.6],
      [61.2, -149.9],
      [25.1, -80.4],
      [-41.3, 174.8],
    ] as const;
    let worstAzimuth = 0;
    let worstElevation = 0;
    for (const year of [2024, 2025, 2026, 2027, 2028, 2030, 2035]) {
      for (const [lat, lng] of sites) {
        for (const monthDay of ["01-15", "03-20", "06-21", "09-22", "12-21"]) {
          for (const hour of ["00", "04", "08", "12", "16", "20"]) {
            const date = new Date(`${year}-${monthDay}T${hour}:30:00Z`);
            const actual = sunPosition(date, lat, lng)!;
            const expected = referenceSun(date, lat, lng);
            if (expected.elevation < 5) continue;
            worstAzimuth = Math.max(worstAzimuth, bearingDelta(actual.azimuth, expected.azimuth));
            worstElevation = Math.max(worstElevation, Math.abs(actual.elevation - expected.elevation));
          }
        }
      }
    }
    expect(worstAzimuth).toBeLessThan(2);
    expect(worstElevation).toBeLessThan(1);
  });

  it("puts midsummer noon in London due south and 62 degrees up", () => {
    const noon = sunPosition(new Date("2026-06-21T12:00:00Z"), 51.5, 0)!;
    expect(bearingDelta(noon.azimuth, 180)).toBeLessThan(2);
    expect(noon.elevation).toBeCloseTo(61.9, 0);
  });
});

describe("the sun as a direction reference", () => {
  /**
   * At Key West on 21 June at noon the sun is 88.9 degrees up: a one-metre stick throws
   * a 2 cm shadow whose bearing sweeps 11 degrees a minute. Both readouts still said to
   * lay a stick along it and read directions off it.
   */
  const overhead = [
    { label: "Key West, 21 Jun noon", lat: 24.55, lng: -81.8, iso: "2026-06-21T17:30:00Z" },
    { label: "Maui, Lahaina Noon", lat: 20.8, lng: -156.3, iso: "2026-05-24T22:33:00Z" },
  ];

  it("withdraws the shadow line when the sun is nearly overhead", () => {
    for (const { label, lat, lng, iso } of overhead) {
      const date = new Date(iso);
      expect(sunPosition(date, lat, lng)!.elevation, label).toBeGreaterThan(85);
      for (const note of [sunCompassHint(date, lat, lng), sunVsWatchCheck(date, lat, lng)]) {
        expect(note, label).toMatch(/nearly overhead/);
        expect(note, label).not.toMatch(/lay a stick|Shadow points/);
        expect(note, label).toMatch(/Use the compass, or wait an hour/);
      }
    }
  });

  it("keeps the shadow line when the shadow is long enough to read", () => {
    const date = new Date("2026-06-21T20:00:00Z");
    expect(sunPosition(date, 37.7, -119.6)!.elevation).toBeGreaterThan(70);
    expect(sunCompassHint(date, 37.7, -119.6)).toMatch(/Shadow points/);
    expect(sunVsWatchCheck(date, 37.7, -119.6)).toMatch(/shadow points/);
  });

  it("never renders a bearing of 360", () => {
    // Yosemite midsummer noon rounded 359.6 up to "shadow points ~360 deg".
    expect(sunCompassHint(new Date("2026-06-21T20:00:00Z"), 37.7, -119.6)).not.toMatch(/360°/);
    expect(roundBearing(359.6)).toBe(0);
    expect(roundBearing(-0.4)).toBe(0);
    expect(roundBearing(720.7)).toBe(1);
    for (let deg = -720; deg <= 720; deg += 0.37) {
      expect(roundBearing(deg)).toBeGreaterThanOrEqual(0);
      expect(roundBearing(deg)).toBeLessThan(360);
    }
  });

  it("measures the shadow a stick would actually throw", () => {
    expect(shadowLengthCm(80)!).toBeCloseTo(17.6, 1);
    expect(shadowLengthCm(88.87)!).toBeCloseTo(1.97, 1);
    expect(shadowLengthCm(45)!).toBeCloseTo(100, 1);
    expect(shadowLengthCm(0)).toBeNull();
    expect(shadowLengthCm(90)).toBeNull();
  });
});
