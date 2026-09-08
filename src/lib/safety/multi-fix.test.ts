import { describe, expect, it } from "vitest";
import { partyPicture, triangulateFromBearings, type BearingObservation } from "./multi-fix";
import { rangeAzimuth } from "./landnav";

/** True bearing from an observer to the target, using the app's own geodesy. */
function bearingTo(
  from: { lat: number; lng: number },
  target: { lat: number; lng: number },
): number {
  const ra = rangeAzimuth(from, target);
  if (!ra) throw new Error("bearing could not be computed");
  return ra.trueDeg;
}

const TARGET = { lat: 37.7345, lng: -119.6032 };

/** Three observers ringing the target from genuinely different directions. */
function observersAround(target: { lat: number; lng: number }): BearingObservation[] {
  const points = [
    { label: "A", lat: target.lat - 0.02, lng: target.lng - 0.02 },
    { label: "B", lat: target.lat + 0.018, lng: target.lng - 0.021 },
    { label: "C", lat: target.lat + 0.001, lng: target.lng + 0.026 },
  ];
  return points.map((p) => ({ ...p, bearingTrue: bearingTo(p, target) }));
}

describe("triangulateFromBearings", () => {
  it("recovers the target from three consistent bearings", () => {
    const result = triangulateFromBearings(observersAround(TARGET))!;
    expect(result).not.toBeNull();
    expect(result.cuts).toBe(3);
    expect(result.observationsUsed).toBe(3);

    const error = rangeAzimuth(result.point, TARGET)!.meters;
    expect(error).toBeLessThan(25);
    // Consistent bearings must agree tightly.
    expect(result.spreadM!).toBeLessThan(25);
  });

  /**
   * The reason this module exists. Two rays ALWAYS cross, so a two-observer fix
   * cannot detect a wrong bearing; three can, and the app must say so rather
   * than plot a confident point.
   */
  it("says a two-bearing fix has no cross-check", () => {
    const [a, b] = observersAround(TARGET);
    const result = triangulateFromBearings([a, b])!;
    expect(result.cuts).toBe(1);
    // One pair cannot disagree with itself: "0 m spread" would read as perfect
    // agreement when it is really no evidence.
    expect(result.spreadM).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/no cross-check|third bearing/i);
  });

  it("exposes a bad bearing as disagreement instead of averaging it away", () => {
    const observations = observersAround(TARGET);
    const good = triangulateFromBearings(observations)!;
    // One observer reads their compass 25 degrees wrong.
    observations[2] = {
      ...observations[2],
      bearingTrue: (observations[2].bearingTrue + 25 + 360) % 360,
    };
    const bad = triangulateFromBearings(observations)!;

    expect(bad.spreadM!).toBeGreaterThan(good.spreadM! * 5);
    expect(bad.warnings.join(" ")).toMatch(/disagree/i);
    // And the quoted radius must grow to cover the disagreement — never
    // under-quote a search radius.
    expect(bad.radiusM!).toBeGreaterThanOrEqual(bad.spreadM!);
  });

  it("never quotes a radius smaller than the cut geometry or the spread", () => {
    for (const observations of [observersAround(TARGET), observersAround({ lat: 61.2, lng: -149.9 })]) {
      const result = triangulateFromBearings(observations)!;
      if (result.geometryM != null) expect(result.radiusM!).toBeGreaterThanOrEqual(result.geometryM);
      if (result.spreadM != null) expect(result.radiusM!).toBeGreaterThanOrEqual(result.spreadM);
    }
  });

  it("warns on a shallow cut", () => {
    // Two observers nearly in line with the target: the cut is barely a cut.
    const a = { label: "A", lat: TARGET.lat - 0.05, lng: TARGET.lng };
    const b = { label: "B", lat: TARGET.lat - 0.03, lng: TARGET.lng };
    const result = triangulateFromBearings([
      { ...a, bearingTrue: bearingTo(a, TARGET) },
      { ...b, bearingTrue: bearingTo(b, TARGET) },
    ]);
    // Either refused outright (near-parallel) or quoted with a shallow-cut warning.
    if (result) expect(result.warnings.join(" ")).toMatch(/shallow cut|no cross-check/i);
  });

  it("refuses inputs it cannot honestly answer", () => {
    expect(triangulateFromBearings([])).toBeNull();
    expect(triangulateFromBearings([{ lat: 37, lng: -119, bearingTrue: 90 }])).toBeNull();
    expect(
      triangulateFromBearings([
        { lat: Number.NaN, lng: -119, bearingTrue: 90 },
        { lat: 37, lng: -119, bearingTrue: 91 },
      ]),
    ).toBeNull();
    // Parallel bearings from two points cross nowhere usable.
    expect(
      triangulateFromBearings([
        { lat: 37.0, lng: -119.0, bearingTrue: 0 },
        { lat: 37.1, lng: -119.0, bearingTrue: 0 },
      ]),
    ).toBeNull();
  });

  it("works across the antimeridian instead of averaging to the far side of the planet", () => {
    const target = { lat: 0.2, lng: 179.95 };
    const result = triangulateFromBearings(observersAround(target));
    expect(result).not.toBeNull();
    const error = rangeAzimuth(result!.point, target)!.meters;
    expect(error).toBeLessThan(200);
    expect(Math.abs(result!.point.lng)).toBeGreaterThan(179);
  });
});

describe("partyPicture", () => {
  const me = { lat: 37.7345, lng: -119.6032 };

  it("gives range and bearing to every member and flags a spread party", () => {
    const picture = partyPicture(
      me,
      [
        { label: "Sam", lat: 37.7405, lng: -119.6032, atMs: Date.now() - 5 * 60_000 },
        { label: "Kim", lat: 37.7346, lng: -119.6031, atMs: Date.now() - 60_000 },
      ],
      Date.now(),
    );

    expect(picture.entries).toHaveLength(2);
    expect(picture.entries[0].vector!.meters).toBeGreaterThan(500);
    expect(picture.entries[0].ageMinutes).toBe(5);
    expect(picture.spreadM!).toBeGreaterThan(PARTY_SPREAD_TRIGGER);
    expect(picture.warnings.join(" ")).toMatch(/Party spread/);
  });

  /**
   * A scanned position is a snapshot from whenever that phone made it. Treating
   * a 40-minute-old fix of a moving hiker as "where they are" is how a search
   * starts in the wrong place.
   */
  it("states the age of stale positions and refuses to assume unknown ages are fresh", () => {
    const picture = partyPicture(
      me,
      [
        { label: "Old", lat: 37.7346, lng: -119.6033, atMs: Date.now() - 45 * 60_000 },
        { label: "NoStamp", lat: 37.7347, lng: -119.6034, atMs: null },
      ],
      Date.now(),
    );
    expect(picture.warnings.join(" ")).toMatch(/over 30 minutes old/);
    expect(picture.warnings.join(" ")).toMatch(/no timestamp/);
    expect(picture.entries[1].ageMinutes).toBeNull();
  });

  it("still builds a picture when the reader has no fix of their own", () => {
    const picture = partyPicture(null, [
      { label: "Sam", lat: 37.7405, lng: -119.6032, atMs: Date.now() },
    ]);
    expect(picture.entries[0].vector).toBeNull();
    expect(picture.centroid).not.toBeNull();
  });

  it("ignores unusable member coordinates rather than plotting them", () => {
    const picture = partyPicture(me, [
      { label: "Bad", lat: Number.NaN, lng: -119.6, atMs: Date.now() },
      { label: "OffPlanet", lat: 99, lng: -119.6, atMs: Date.now() },
      { label: "Good", lat: 37.7346, lng: -119.6033, atMs: Date.now() },
    ]);
    expect(picture.entries.map((e) => e.label)).toEqual(["Good"]);
  });
});

const PARTY_SPREAD_TRIGGER = 500;
