import { describe, expect, it } from "vitest";
import { distanceToTrailMeters, lineLengthMeters, parseGpx } from "@/lib/geo";
import { progressAlongTrail } from "@/lib/geo/navigation";
import { gainLastHourM } from "@/lib/safety/backtrack";
import { checkinStatus } from "@/lib/safety/checkin";
import { gmAngleCard, magneticDeclination } from "@/lib/safety/declination";
import { emergencyMessage } from "@/lib/safety/emergency";
import { heatIndexC } from "@/lib/safety/field-ops";
import { isTrustedFix, sanitizeFixTimestamp } from "@/lib/safety/gps-quality";
import { deadReckon, deadReckonUncertaintyM, distanceFromPaces, intersection } from "@/lib/safety/landnav";
import { nineLineMedevac } from "@/lib/safety/medevac";
import { overdueStatus } from "@/lib/safety/profile";
import { sunVsWatchCheck, watchMethodHeading } from "@/lib/safety/tactics";
import { formatUsng, formatUtm, parseUsng } from "@/lib/safety/usng";
import { verifyRegroup } from "@/lib/safety/verify";
import { amsAssessment, avalancheTerrainWarning } from "@/lib/safety/wilderness";

describe("adversarial-break: GPS timestamps stay honest", () => {
  const now = Date.parse("2026-08-20T12:00:00Z");

  it("does not re-stamp a 48h-old fix as now, and does not trust it", () => {
    const ancient = now - 48 * 60 * 60 * 1000;
    expect(sanitizeFixTimestamp(ancient, now)).toBe(ancient);
    expect(isTrustedFix(ancient, false, now)).toBe(false);
  });

  it("never trusts a stale / IDB-hydrated fix, even if 90s old", () => {
    expect(isTrustedFix(now - 90_000, true, now)).toBe(false);
  });
});

describe("adversarial-break: USNG / UTM", () => {
  it("keeps Sydney in Australia without a hint", () => {
    const sydney = { lat: -33.8688, lng: 151.2093 };
    const grid = formatUsng(sydney.lat, sydney.lng);
    const parsed = parseUsng(grid);
    expect(parsed).not.toBeNull();
    expect(parsed!.lat).toBeGreaterThan(-45);
    expect(parsed!.lat).toBeLessThan(-20);
    expect(parsed!.lng).toBeGreaterThan(140);
  });

  it("refuses a Sydney grid when given a Yosemite hint", () => {
    const sydney = { lat: -33.8688, lng: 151.2093 };
    const grid = formatUsng(sydney.lat, sydney.lng);
    expect(parseUsng(grid, { lat: 37.7459, lng: -119.5936 })).toBeNull();
  });

  it("parses formatUtm back near the origin", () => {
    const origin = { lat: 37.7459, lng: -119.5936 };
    const parsed = parseUsng(formatUtm(origin.lat, origin.lng));
    expect(parsed).not.toBeNull();
    expect(parsed!.lat).toBeCloseTo(origin.lat, 2);
    expect(parsed!.lng).toBeCloseTo(origin.lng, 2);
  });
});

describe("adversarial-break: trail geometry", () => {
  it("does not treat the gap between MultiLineString segments as on-trail", () => {
    const trail: GeoJSON.MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [-119.0, 37.0],
          [-119.0, 37.001],
        ],
        [
          [-119.0, 37.01],
          [-119.0, 37.011],
        ],
      ],
    };
    const midGap = { lat: 37.0055, lng: -119.0 };
    const d = distanceToTrailMeters(midGap, trail);
    expect(d).toBeGreaterThan(200);
    expect(progressAlongTrail(midGap, trail).offsetMeters).toBeGreaterThan(200);
  });

  it("imports lon-before-lat GPX", () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lon="-119.0" lat="37.0"></trkpt>
      <trkpt lon="-119.0" lat="37.01"><ele>1200</ele></trkpt>
    </trkseg></trk></gpx>`;
    const geo = parseGpx(gpx);
    expect(geo).not.toBeNull();
    expect(geo!.type).toBe("LineString");
    expect(geo!.coordinates[0][0]).toBeCloseTo(-119);
    expect(geo!.coordinates[0][1]).toBeCloseTo(37);
    expect(geo!.coordinates[1][2]).toBeCloseTo(1200);
  });

  it("keeps two trkseg as MultiLineString without an 11 km phantom connector", () => {
    const gpx = `<?xml version="1.0"?><gpx><trk>
      <trkseg>
        <trkpt lat="37.0" lon="-119.0"></trkpt>
        <trkpt lat="37.001" lon="-119.0"></trkpt>
      </trkseg>
      <trkseg>
        <trkpt lat="37.1" lon="-119.0"></trkpt>
        <trkpt lat="37.101" lon="-119.0"></trkpt>
      </trkseg>
    </trk></gpx>`;
    const geo = parseGpx(gpx);
    expect(geo?.type).toBe("MultiLineString");
    expect(lineLengthMeters(geo!)).toBeLessThan(500);
  });
});

describe("adversarial-break: land-nav honesty", () => {
  it("uses the same half-angle for the southern watch method (15:00 → ~45°)", () => {
    const south = watchMethodHeading(15, "south");
    // watchMethodHeading is nullable now: it refuses a non-finite or
    // out-of-range hour rather than returning a confident heading. 15:00 is
    // valid, so a null here is itself a failure.
    expect(south).not.toBeNull();
    expect(south!.toward).toBe("N");
    expect(south!.clockAzimuthFrom12).toBeCloseTo(45, 0);
    expect(south!.clockAzimuthFrom12).not.toBeCloseTo(225, 0);
  });

  it("does not claim the sun azimuth agrees with a watch-dial angle", () => {
    // The hour argument was removed: the solar hour is derived from longitude
    // inside the function, because a device clock carries DST and zone error
    // worth up to 15 degrees of heading.
    const note = sunVsWatchCheck(new Date("2026-06-21T22:00:00Z"), 37.7, -119.6);
    if (note) {
      expect(note).not.toMatch(/agree|within 20/i);
      expect(note).toMatch(/do not compare/i);
    }
  });

  it("includes grid convergence on the G-M card and refuses silent magnetic outside NA", () => {
    const sierra = gmAngleCard(37.7, -119.6);
    expect(sierra).not.toBeNull();
    expect(sierra!.gridToMagnetic).toMatch(/conv/);
    expect(magneticDeclination(21.3, -157.8)).toBeNull();
    expect(gmAngleCard(21.3, -157.8)!.gridToMagnetic).toMatch(/unavailable/i);
  });

  it("sorts an unsorted altitude track before last-hour gain", () => {
    const now = Date.parse("2026-08-20T12:00:00Z");
    const points = [
      { lat: 37, lng: -119, altitude: 2400, recordedAt: now },
      { lat: 37, lng: -119, altitude: 2000, recordedAt: now - 50 * 60_000 },
    ];
    expect(gainLastHourM(points, now)).toBeCloseTo(400);
  });

  it("labels 9-line L3 as Urgent Surgical, not 2B (Priority)", () => {
    const text = nineLineMedevac({
      lat: 37.7459,
      lng: -119.5936,
      precedence: "B",
    });
    expect(text).not.toMatch(/2B \(Priority\)/);
    expect(text).toMatch(/Urgent Surgical/);
  });

  it("does not call fatigue at 1500 m mild AMS", () => {
    const r = amsAssessment({ altitudeM: 1500, symptoms: ["fatigue"] });
    expect(r.level).toBe("none");
    expect(r.warning).toBeNull();
  });

  it("does not call a north aspect leeward", () => {
    // aspectDeg is no longer an input: a route elevation profile cannot
    // establish slope aspect, so accepting it invited an authoritative
    // leeward/windward claim that the data could not support. The assertion
    // below still holds -- and now holds by construction.
    const note = avalancheTerrainWarning({
      slopePct: 35,
      month: 1,
      snowOnGround: true,
    });
    expect(note ?? "").not.toMatch(/leeward/i);
  });

  it("fails closed on invalid return and check-in times", () => {
    // An unparseable deadline fails closed as overdue: callers that render only
    // on `overdue` would otherwise show nothing, leaving a hiker unmonitored
    // while believing the alarm was armed. `valid` records why.
    const invalid = overdueStatus("not-a-date");
    expect(invalid.overdue).toBe(true);
    expect(invalid.valid).toBe(false);
    expect(invalid.remainingMin).toBeNull();
    expect(invalid.label).toMatch(/invalid/i);
    expect(checkinStatus("bogus", { enabled: true, intervalMin: 60 })?.overdue).toBe(true);
  });

  it("verifies regroup on the password reply only", () => {
    const r = verifyRegroup({
      challengeResponse: "wrong-spoken-challenge",
      passwordResponse: "Blue",
      expectedChallenge: "Eagle",
      expectedPassword: "Blue",
    });
    expect(r.ok).toBe(true);
  });

  it("puts DR coordinates in the SOS block and does not claim a live GPS fix", () => {
    const msg = emergencyMessage({
      lat: 37.11,
      lng: -119.22,
      positionSource: "deadReckon",
      offTrailM: 80,
    });
    expect(msg).toContain("37.11000");
    expect(msg).toContain("119.22000°W");
    expect(msg).toContain("q=37.11,-119.22");
    expect(msg).toMatch(/DEAD RECKON/);
    expect(msg).not.toMatch(/offline-capable GPS/);
  });

  it("does not report a heat index cooler than the air at the 27 °C / 40 % edge", () => {
    expect(heatIndexC(27, 40)).toBeNull();
  });

  it("does not invent DR distance without paces", () => {
    const start = { lat: 37, lng: -119 };
    const dest = deadReckon(start, 0, distanceFromPaces(0, 65))!;
    expect(dest.lat).toBeCloseTo(37, 6);
    expect(dest.lng).toBeCloseTo(-119, 6);
    expect(deadReckonUncertaintyM({ distanceM: 0, lastAccuracyM: 10 })).toBeCloseTo(10);
    expect(deadReckonUncertaintyM({ distanceM: 690, lastAccuracyM: 10 })).toBeGreaterThan(80);
  });

  it("warns when an intersection cut is poor instead of sounding confident", () => {
    const west = { lat: 37.0, lng: -119.01 };
    const almostWest = { lat: 37.0, lng: -119.009 };
    const hit = intersection(west, 90, almostWest, 91);
    if (hit) expect(hit.warning).toMatch(/Poor cut/i);
  });
});
