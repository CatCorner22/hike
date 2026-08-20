import { describe, expect, it } from "vitest";
import { bearingBetween, bboxFromGeometry, formatDistance, formatDuration, formatElevation, formatPace } from "@/lib/geo";
import { unwrapLongitude } from "@/lib/geo/antimeridian";
import {
  isValidGeometry,
  normalizeHeading,
  progressAlongTrail,
  safeBbox,
  trailLengthMeters,
} from "@/lib/geo/navigation";
import { gridConvergence, isFixNearRouteBbox, magneticDeclination } from "@/lib/safety/declination";
import {
  formatMgrs10,
  formatUsng,
  latLngToUtm,
  latitudeBand,
  parseUsng,
  utmToLatLng,
  utmZone,
} from "@/lib/safety/usng";
import {
  daylightStatus,
  estimateSunriseUtc,
  estimateSunsetUtc,
  minutesUntilSunset,
} from "@/lib/safety/daylight";
import { sunCompassHint, sunPosition } from "@/lib/safety/astro";
import { polarisHint } from "@/lib/safety/tactics";
import {
  formatZulu,
  intersection,
  milRelationRange,
  rangeAzimuth,
  resection,
  smallestAngle,
  timeSpeedDistance,
} from "@/lib/safety/landnav";
import {
  fixAgeMs,
  formatFixAge,
  isTrustedFix,
  sanitizeFixTimestamp,
} from "@/lib/safety/gps-quality";
import { tourniquetStatus } from "@/lib/safety/tccc";
import { backtrackProgress, reverseTrackLine } from "@/lib/safety/backtrack";
import { naismithMinutes, slopePercent } from "@/lib/safety/field-ops";

const DATELINE_LINE: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [[179.9, 0], [-179.9, 0]],
};
const NOW = Date.parse("2026-08-20T14:00:00Z");

/** This duplicates the antimeridian-aware project() arithmetic in safety-nav-map.tsx. */
function safetyMapProjectX(lng: number, bbox: [number, number, number, number], width = 400, padding = 28) {
  const [minLng, , maxLng] = bbox;
  const xSpan = Math.max(maxLng - minLng, 0.0001);
  const unwrapped = unwrapLongitude(lng, { minLng, maxLng })!;
  return padding + ((unwrapped - minLng) / xSpan) * (width - padding * 2);
}

describe("antimeridian controls", () => {
  it("keeps geodesic length and bearing short across ±180°", () => {
    expect(trailLengthMeters(DATELINE_LINE)).toBeGreaterThan(22_000);
    expect(trailLengthMeters(DATELINE_LINE)).toBeLessThan(23_000);
    expect(bearingBetween({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 })).toBeCloseTo(90, 5);
    const ra = rangeAzimuth({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    expect(ra.meters).toBeGreaterThan(22_000);
    expect(ra.meters).toBeLessThan(23_000);
    expect(ra.trueDeg).toBeCloseTo(90, 5);
  });

  it("keeps a dateline bbox and SVG projection local", () => {
    const bbox = bboxFromGeometry(DATELINE_LINE, 0)!;
    const safe = safeBbox(DATELINE_LINE)!;
    const projectedSpan = Math.abs(safetyMapProjectX(179.9, safe) - safetyMapProjectX(-179.9, safe));
    expect(bbox[2] - bbox[0]).toBeLessThan(1);
    expect(safe[2] - safe[0]).toBeLessThan(1);
    // In a tight local bbox, route endpoints correctly fill the viewport.
    // The safety property is that projection is finite and bounded, not that
    // distinct route endpoints collapse onto one pixel.
    expect(projectedSpan).toBeGreaterThan(0);
    expect(projectedSpan).toBeLessThanOrEqual(344);
  });

  it("rejects a Greenwich fix for a dateline route", () => {
    expect(isFixNearRouteBbox(0, 0, safeBbox(DATELINE_LINE)!)).toBe(false);
  });

  it("snaps a position on the date line onto the short geodesic route", () => {
    const progress = progressAlongTrail({ lat: 0, lng: 180 }, DATELINE_LINE);
    expect(progress.offsetMeters).toBeLessThan(10);
    expect(progress.traveledMeters).toBeGreaterThan(10_000);
    expect(progress.remainingMeters).toBeGreaterThan(10_000);
  });
});

describe("UTM/USNG validity boundaries", () => {
  it("uses expected zones at ordinary boundary longitudes", () => {
    expect(utmZone(0, -180)).toBe(1);
    expect(utmZone(0, -174)).toBe(2);
    expect(utmZone(0, 0)).toBe(31);
    expect(utmZone(0, 6)).toBe(32);
    expect(utmZone(0, 174)).toBe(60);
  });

  it("maps 180° longitude to zone 60, never zone 61", () => {
    expect(utmZone(0, 180)).toBe(60);
    expect(formatUsng(0, 180)).not.toMatch(/^61/);
  });

  it("refuses polar coordinates outside the UTM domain", () => {
    for (const lat of [-90, -80.001, 84.001, 89.999, 90]) {
      expect(latLngToUtm(lat, 0)).toBeNull();
      expect(formatUsng(lat, 0)).toBeNull();
      expect(formatMgrs10(lat, 0)).toBeNull();
    }
  });

  it("round-trips valid high-latitude and zone-boundary positions within 25 m when hinted", () => {
    for (const origin of [
      { lat: 83.999, lng: -180 },
      { lat: 83.999, lng: -174 },
      { lat: 83.999, lng: 0 },
      { lat: 83.999, lng: 6 },
      { lat: 83.999, lng: 174 },
      { lat: -79.999, lng: 0 },
    ]) {
      const parsed = parseUsng(formatMgrs10(origin.lat, origin.lng)!, origin);
      expect(parsed).not.toBeNull();
      expect(rangeAzimuth(origin, parsed!).meters).toBeLessThan(25);
    }
  });

  it("does not offer declination outside its North America grid and describes celestial poles safely", () => {
    expect(magneticDeclination(90, 0)).toBeNull();
    expect(magneticDeclination(89.999, 0)).toBeNull();
    expect(gridConvergence(90, 0)).toBeCloseTo(-3, 8);
    expect(polarisHint(-30)).toMatch(/Southern Cross/i);
    expect(polarisHint(0)).toMatch(/equator/i);
  });

  it("labels valid UTM latitude bands at the limits", () => {
    expect(latitudeBand(-80)).toBe("C");
    expect(latitudeBand(84)).toBe("X");
    expect(utmToLatLng(latLngToUtm(83.999, 0)!).lat).toBeCloseTo(83.999, 4);
  });
});

describe("polar daylight and solar navigation", () => {
  it("returns explicit polar-day and polar-night states instead of bogus dates", () => {
    const june = new Date("2026-06-21T12:00:00Z");
    const december = new Date("2026-12-21T12:00:00Z");
    expect(estimateSunsetUtc(june, 78, 15)).toBe("midnight-sun");
    expect(estimateSunriseUtc(june, 78, 15)).toBe("midnight-sun");
    expect(minutesUntilSunset(june, 78, 15)).toBe(1440);
    expect(daylightStatus(june, 78, 15)).toMatchObject({ isDark: false, minutesUntilSunset: 1440, warning: null });
    expect(estimateSunsetUtc(december, 78, 15)).toBe("polar-night");
    expect(estimateSunriseUtc(december, 78, 15)).toBe("polar-night");
    expect(daylightStatus(december, 78, 15)).toMatchObject({ isDark: true, minutesUntilSunset: -1 });
    expect(daylightStatus(december, 78, 15).warning).toMatch(/Polar night/i);
  });

  it("handles the Southern Hemisphere inverse seasons plus Arctic-circle and equatorial control cases", () => {
    const june = new Date("2026-06-21T12:00:00Z");
    const december = new Date("2026-12-21T12:00:00Z");
    expect(daylightStatus(june, -78, 15).isDark).toBe(true);
    expect(daylightStatus(december, -78, 15).isDark).toBe(false);
    expect(estimateSunsetUtc(june, 66.6, 15)).toBe("midnight-sun");
    expect(estimateSunriseUtc(new Date("2026-03-20T12:00:00Z"), 0, 0)).toBeInstanceOf(Date);
    const polarSun = sunPosition(june, 78, 15);
    expect(polarSun).not.toBeNull();
    expect(Number.isFinite(polarSun!.azimuth)).toBe(true);
    expect(sunCompassHint(june, 78, 15)).not.toMatch(/too low/i);
  });
});

describe("time, clock-skew, and treatment timing", () => {
  it("rejects a nonexistent America/New_York return time instead of normalizing it", async () => {
    const { resolveLocalDateTime } = await import("@/lib/safety/profile");
    expect(resolveLocalDateTime("2026-03-08T02:30", "America/New_York")).toMatchObject({ kind: "nonexistent" });
  });

  it("normalizes epoch, invalid, and materially future fixes instead of displaying an age in the future", () => {
    expect(sanitizeFixTimestamp(0, NOW)).toBe(NOW);
    expect(sanitizeFixTimestamp(-1, NOW)).toBe(NOW);
    expect(sanitizeFixTimestamp(Number.NaN, NOW)).toBe(NOW);
    expect(sanitizeFixTimestamp(NOW + 3 * 60 * 60_000, NOW)).toBe(NOW);
    expect(fixAgeMs(NOW + 3 * 60 * 60_000, NOW)).toBe(0);
    expect(formatFixAge(NOW + 3 * 60 * 60_000, NOW)).toBe("just now");
  });

  it("clamps every future GPS timestamp and never trusts it", () => {
    const skewed = NOW + 60_000;
    expect(sanitizeFixTimestamp(skewed, NOW)).toBe(NOW);
    expect(isTrustedFix(skewed, false, NOW)).toBe(false);
  });

  it("formats Zulu correctly at UTC midnight and on leap day", () => {
    expect(formatZulu(new Date("2028-02-29T00:00:00Z"))).toBe("0000Z 29 FEB 2028");
    expect(formatZulu(new Date("2028-03-01T00:00:00Z"))).toBe("0000Z 1 MAR 2028");
  });

  it("refuses a tourniquet elapsed-time claim after the device clock jumps backward", () => {
    expect(tourniquetStatus(NOW, NOW - 60_000)).toBeNull();
  });
});

describe("degenerate geometry and numeric guards", () => {
  it("has safe fallbacks for empty/stub geometry and short backtracks", () => {
    const empty: GeoJSON.MultiLineString = { type: "MultiLineString", coordinates: [[], [[0, 0]]] };
    const emptyProgress = progressAlongTrail({ lat: 0, lng: 0 }, empty);
    expect(emptyProgress.traveledMeters).toBe(0);
    expect(Number.isFinite(emptyProgress.offsetMeters)).toBe(false);
    expect(reverseTrackLine([])).toBeNull();
    expect(reverseTrackLine([{ lat: 0, lng: 0 }])).toBeNull();
    expect(backtrackProgress({ lat: 0, lng: 0 }, [])).toBeNull();
    expect(backtrackProgress({ lat: 0, lng: 0 }, [{ lat: 0, lng: 0 }])).toBeNull();
    expect(isValidGeometry({ type: "LineString", coordinates: [[0, 0], [Number.NaN, 0]] })).toBe(false);
  });

  it("returns a safe invalid progress result for corrupt LineString coordinates", () => {
    const corrupt = { type: "LineString", coordinates: [[0, 0], [Number.NaN, 0]] } as unknown as GeoJSON.LineString;
    expect(() => progressAlongTrail({ lat: 0, lng: 0 }, corrupt)).not.toThrow();
  });

  it("guards zero divisors, negative route distance, and parallel lines", () => {
    expect(naismithMinutes(-1, 100)).toBe(0);
    expect(slopePercent(10, 0)).toBeNull();
    expect(milRelationRange(2, 0)).toBeNull();
    expect(timeSpeedDistance({ distanceM: 1000, speedKph: 0 })).toBeNull();
    expect(resection({ lat: 0, lng: 0 }, 90, { lat: 1, lng: 0 }, 90)).toBeNull();
    expect(intersection({ lat: 0, lng: 0 }, 90, { lat: 1, lng: 0 }, 90)).toBeNull();
  });

  it("rejects malformed headings rather than propagating NaN", () => {
    expect(normalizeHeading(Number.NaN)).toBeNull();
    expect(smallestAngle(Number.NaN, 90)).toBeNull();
  });

  it("never renders non-finite telemetry literally", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatDistance(value)).not.toMatch(/NaN|Infinity|∞/);
      expect(formatElevation(value)).not.toMatch(/NaN|Infinity|∞/);
      expect(formatDuration(value)).not.toMatch(/NaN|Infinity|∞/);
      expect(formatPace(value)).not.toMatch(/NaN|Infinity|∞/);
    }
  });
});

/**
 * The gps-adversarial probe found a dateline route reported as on-route, which
 * was correct behaviour hidden by a bad assertion. Lock the real property in a
 * unit test so it cannot regress without the probe running.
 */
describe("antimeridian route progress (regression from probe false positive)", () => {
  const crossing: GeoJSON.LineString = {
    type: "LineString",
    coordinates: [
      [179.9, 0],
      [-179.9, 0],
    ],
  };

  it("treats a fix between the endpoints as on route, not 20,000 km away", () => {
    const onRoute = progressAlongTrail({ lat: 0, lng: 179.95 }, crossing);
    expect(onRoute.valid).toBe(true);
    expect(onRoute.offsetMeters).toBeLessThan(100);
  });

  it("still reports a genuinely distant fix as off route", () => {
    const faraway = progressAlongTrail({ lat: 0, lng: 0 }, crossing);
    expect(faraway.valid).toBe(true);
    // Greenwich is ~20,000 km from a dateline route; the old 359.8-degree bbox
    // accepted it as on route and suppressed the off-trail warning.
    expect(faraway.offsetMeters).toBeGreaterThan(10_000_000);
  });
});
