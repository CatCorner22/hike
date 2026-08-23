import { describe, expect, it } from "vitest";
import {
  casevacDecision,
  formatGmtCard,
  lostPersonQuery,
  paceBeads,
  polarisHint,
  solarHour,
  sunVsWatchCheck,
  watchMethodHeading,
} from "./tactics";
import { reconcileTriagePriority } from "./triage-priority";
import { gridConvergence } from "@/lib/safety/declination";
import { sunPosition } from "@/lib/safety/astro";

describe("tactics", () => {
  it("gives a northern watch-method hint", () => {
    const w = watchMethodHeading(15, "north");
    expect(w).not.toBeNull();
    expect(w!.toward).toBe("S");
    expect(w!.hint).toMatch(/south/i);
  });

  /**
   * Regression: the bisector must cross the SMALLER arc between the hour hand and the 12
   * mark. Before noon the hour hand is more than 180 deg clockwise of 12, so the smaller
   * arc is on the other side. Using `hourOn12 / 2` unconditionally pointed exactly
   * backwards for northern mornings, and its reflex did the same for southern afternoons
   * — 180 deg wrong, on the method you reach for when you have no compass.
   *
   * Checked against where the bisector actually points in true degrees, given the sun's
   * true azimuth at that solar hour.
   */
  it("points at the pole it claims, all day, in both hemispheres", () => {
    for (const hemisphere of ["north", "south"] as const) {
      // 04:00-21:00 solar, not 06:30-17:30. The narrow window was the whole reason
      // the `hourOn12 > 180` branch survived: it is correct inside it and 180 deg
      // wrong outside, and high-latitude summer puts the sun well up at both ends.
      for (const hour of [4, 4.5, 5, 5.5, 6, 6.5, 8, 9, 10.5, 12, 13.5, 15, 16, 17.5, 18, 19, 20, 20.5, 21]) {
        const heading = watchMethodHeading(hour, hemisphere);
        expect(heading, `${hemisphere} ${hour}h`).not.toBeNull();
        const { clockAzimuthFrom12, toward } = heading!;
        const hourOn12 = (hour % 12) * 30;

        // Sun azimuth (true, clockwise from north) at this solar hour.
        const sunAzimuth =
          hemisphere === "north"
            ? (180 + 15 * (hour - 12) + 360) % 360
            : (0 - 15 * (hour - 12) + 360) % 360;

        // Northern: the HOUR HAND is aimed at the sun. Southern: the 12 mark is.
        const twelveMarkTrue =
          hemisphere === "north" ? (sunAzimuth - hourOn12 + 720) % 360 : sunAzimuth;
        const bisectorTrue = (twelveMarkTrue + clockAzimuthFrom12) % 360;

        const expected = toward === "S" ? 180 : 0;
        const delta = Math.abs((((bisectorTrue - expected + 180) % 360) + 360) % 360 - 180);
        expect(delta, `${hemisphere} ${hour}h -> ${bisectorTrue.toFixed(0)}deg, wanted ${expected}`).toBeLessThan(1);
      }
    }
  });

  it("reads solar time from longitude, not the device clock", () => {
    // 18:00 UTC at 120 W is 10:00 solar, whatever the phone's zone or DST says.
    expect(solarHour(new Date("2026-08-20T18:00:00Z"), -120)).toBeCloseTo(10, 6);
    expect(solarHour(new Date("2026-08-20T18:00:00Z"), 0)).toBeCloseTo(18, 6);
    expect(solarHour(new Date("2026-08-20T02:00:00Z"), -120)).toBeCloseTo(18, 6);
  });

  it("uses Polaris at mid-latitudes", () => {
    expect(polarisHint(37)).toMatch(/37/);
    expect(polarisHint(-40)).toMatch(/Southern Cross/);
  });

  it("computes a small Sierra grid convergence", () => {
    const g = gridConvergence(37.7, -119.6);
    expect(g).not.toBeNull();
    expect(Math.abs(g!)).toBeLessThan(4);
  });

  it("keeps a non-walker in place", () => {
    expect(casevacDecision({ injured: true, canWalk: false, isDark: false }).choice).toBe("stay");
    expect(casevacDecision({ injured: false, canWalk: true, isDark: false, remainingM: 400, partySize: 2 }).choice).toBe(
      "walk-out",
    );
  });

  it("overrides generic stay-put advice for a time-critical medical evacuation", () => {
    const decision = casevacDecision({
      injured: true,
      canWalk: false,
      isDark: true,
      medicalOverride: "severe-altitude-illness",
    });
    expect(decision.choice).toBe("urgent-assisted-descent");
    expect(decision.reason).toMatch(/generic stay-put rule does not apply/i);
    expect(reconcileTriagePriority({
      altitude: { mustDescend: true, message: "DESCEND NOW" },
      movement: decision,
    })).toMatchObject({ action: "urgent-assisted-descent" });
  });

  it("counts pace beads in 9s", () => {
    expect(paceBeads(9).km).toBe(0);
    expect(paceBeads(9).beads).toBe(9);
    expect(paceBeads(10).beads).toBe(0);
    expect(paceBeads(Number.NaN).label).toMatch(/cannot determine/i);
    expect(watchMethodHeading(Number.POSITIVE_INFINITY, "north")).toBeNull();
    expect(polarisHint(91)).toBeNull();
    expect(gridConvergence(91, 0)).toBeNull();
  });

  it("builds a lost-person query", () => {
    const q = lostPersonQuery({ name: "Alex", clothing: "red jacket", lat: 37.1, lng: -119.2 });
    expect(q).toContain("Alex");
    expect(q).toContain("Your grid now");
  });

  /**
   * Regression: Math.round turned 359.7° into "360° true" — a dial position that
   * exists on no compass card — while the adjacent compass readout showed 0°.
   * All three bearings on the card round through roundBearing.
   */
  it("formatGmtCard never renders 360°", () => {
    const card = formatGmtCard(359.7, 359.6, 37.7, -119.5);
    expect(card).not.toBeNull();
    expect(card!).toMatch(/^0° true/);
    expect(card!).toContain("0° mag");
    expect(card!).not.toContain("360°");
  });
});

describe("pace beads count metres, not beads", () => {
  /**
   * The ninth bead is 900 m — the kilometre bead goes across on the tenth hundred.
   * Dividing by 9 called 900 m "1 km" and 4 500 m "5 km", an 11% overstatement that
   * grows with distance and feeds a GPS-denied dead-reckoning position.
   */
  it("never claims more ground than was walked", () => {
    for (let hundreds = 0; hundreds <= 250; hundreds++) {
      const { km, beads, label } = paceBeads(hundreds);
      expect(km * 1000 + beads * 100, `${hundreds}`).toBe(hundreds * 100);
      expect(beads).toBeLessThan(10);
      expect(label).toContain(`${hundreds * 100} m`);
    }
  });

  it("puts the kilometre on the tenth hundred", () => {
    expect(paceBeads(9)).toMatchObject({ km: 0, beads: 9 });
    expect(paceBeads(10)).toMatchObject({ km: 1, beads: 0 });
    expect(paceBeads(45)).toMatchObject({ km: 4, beads: 5 });
    expect(paceBeads(100)).toMatchObject({ km: 10, beads: 0 });
  });
});

describe("casevac decision on an unmeasured distance", () => {
  /**
   * The two distance branches defaulted a missing `remainingM` in opposite directions,
   * so an unknown distance fell through the first and came back as "Ambulatory and
   * close". The panel's prop is undefined exactly when the route has not been matched.
   */
  it("does not call an unknown distance close", () => {
    for (const remainingM of [undefined, Number.NaN]) {
      const injured = casevacDecision({ injured: true, canWalk: true, isDark: false, remainingM, partySize: 2 });
      expect(injured.reason, `${remainingM}`).not.toMatch(/close/i);
      expect(injured.reason).toMatch(/not known|NOT measured/i);
      expect(injured.choice).toBe("stay");

      const well = casevacDecision({ injured: false, canWalk: true, isDark: false, remainingM, partySize: 2 });
      expect(well.reason).not.toMatch(/\bclose\b/i);
      expect(well.reason).toMatch(/NOT measured/);
      expect(well.choice).toBe("walk-out");
    }
  });

  it("still calls a measured short distance close", () => {
    const near = casevacDecision({ injured: true, canWalk: true, isDark: false, remainingM: 400, partySize: 2 });
    expect(near.choice).toBe("walk-out");
    expect(near.reason).toMatch(/close \(~400 m\)/);
  });
});

describe("sun compass against real ephemeris", () => {
  /**
   * The dial geometry test above uses an idealised sun that sweeps a uniform 15 deg
   * per hour, which is the assumption the watch method itself makes. Against the real
   * sun that assumption breaks in summer at mid-latitude, so the rendered string has
   * to say which day you are having rather than quoting the hint flat.
   */
  const cases = [
    { label: "Yosemite, 21 Jun 09:00 solar", lat: 37.7, lng: -119.6, iso: "2026-06-21T17:00:00Z", dialUsable: false },
    { label: "Yosemite, 21 Dec 09:00 solar", lat: 37.7, lng: -119.6, iso: "2026-12-21T17:00:00Z", dialUsable: true },
    { label: "Anchorage, 21 Jun 05:30 solar", lat: 61.2, lng: -149.9, iso: "2026-06-21T15:30:00Z", dialUsable: true },
    { label: "Patagonia, 21 Dec 15:00 solar", lat: -41.3, lng: -72.9, iso: "2026-12-21T19:52:00Z", dialUsable: false },
  ];

  it("always gives the exact shadow bearing", () => {
    for (const { label, lat, lng, iso } of cases) {
      const note = sunVsWatchCheck(new Date(iso), lat, lng);
      expect(note, label).not.toBeNull();
      const sun = sunPosition(new Date(iso), lat, lng)!;
      const shadow = Math.round((sun.azimuth + 180) % 360);
      expect(note!, label).toContain(`shadow points ${shadow}° true`);
    }
  });

  it("withdraws the dial where the dial is no good, and keeps it where it is", () => {
    for (const { label, lat, lng, iso, dialUsable } of cases) {
      const note = sunVsWatchCheck(new Date(iso), lat, lng)!;
      if (dialUsable) {
        expect(note, label).toMatch(/Watch method: Point/);
        expect(note, label).not.toMatch(/use the shadow, not the dial/);
      } else {
        expect(note, label).toMatch(/use the shadow, not the dial/);
        expect(note, label).not.toMatch(/Watch method: Point/);
      }
    }
  });

  /**
   * Regression: at Anchorage on 21 June at 05:30 solar the sun is 17 deg up and the
   * hint called azimuth 349 deg — north — "south".
   */
  it("does not point 180 deg wrong when the sun is up before 06:00 solar", () => {
    for (const { lat, lng, iso } of cases) {
      const date = new Date(iso);
      const sun = sunPosition(date, lat, lng)!;
      const hemisphere = lat >= 0 ? "north" : "south";
      const hour = solarHour(date, lng);
      const watch = watchMethodHeading(hour, hemisphere)!;
      const dialDeg = (hour % 12) * 30;
      const twelve = hemisphere === "north" ? ((sun.azimuth - dialDeg) % 360 + 360) % 360 : sun.azimuth;
      const bisector = (twelve + watch.clockAzimuthFrom12) % 360;
      const wanted = watch.toward === "S" ? 180 : 0;
      const error = Math.abs((((bisector - wanted + 180) % 360) + 360) % 360 - 180);
      expect(error, `${lat} ${iso}`).toBeLessThan(45);
    }
  });
});

describe("the watch hint has to match the number it quotes", () => {
  /**
   * The dial angle was corrected to the long arc outside 06:00-18:00 solar, but
   * the prose still said "midway ... the short way round". At 05:00 the hour hand
   * is 150 deg from 12: the short-arc midpoint is 75 deg and the answer is 255,
   * so a party following the words walked 180 deg from the south the same
   * sentence promised. One named dial position, no arc to choose.
   */
  it("never tells the party to take the short way round", () => {
    for (const hemisphere of ["north", "south"] as const) {
      for (let hour = 0; hour < 24; hour += 0.25) {
        const heading = watchMethodHeading(hour, hemisphere)!;
        expect(heading.hint, `${hemisphere} ${hour}`).not.toMatch(/short way|midway/i);
        // The hint must quote the value it actually returns.
        expect(heading.hint, `${hemisphere} ${hour}`).toContain(
          `${Math.round(heading.clockAzimuthFrom12)}° clockwise from the 12 mark`,
        );
        expect(heading.hint).toMatch(/o'clock|\d:\d\d/);
      }
    }
  });

  it("names the dial position the angle corresponds to", () => {
    expect(watchMethodHeading(5, "north")!.hint).toContain("255° clockwise from the 12 mark (about the 8:30 mark)");
    expect(watchMethodHeading(12, "north")!.hint).toContain("(about the 12 o'clock mark)");
    expect(watchMethodHeading(20, "north")!.hint).toContain("(about the 4 o'clock mark)");
    expect(watchMethodHeading(15, "south")!.hint).toMatch(/North is then 45°/);
  });
});
