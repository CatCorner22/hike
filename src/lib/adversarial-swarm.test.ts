import { describe, expect, it } from "vitest";
import { progressAlongTrail } from "@/lib/geo/navigation";
import { emergencyMessage } from "@/lib/safety/emergency";
import { checkinStatus } from "@/lib/safety/checkin";
import {
  getFixTimestampDiagnostic,
  isTrustedFix,
  isValidLatLng,
  sanitizeFixTimestamp,
} from "@/lib/safety/gps-quality";
import { parseTypedHeading } from "@/lib/safety/landnav";
import { nineLineMedevac } from "@/lib/safety/medevac";
import { isPackWeatherFresh } from "@/lib/offline/pack-weather";
import { buildRoutePack } from "@/lib/offline/route-pack";
import {
  createRouteProgressCache,
  progressWithRouteCache,
  routePackFingerprint,
} from "@/lib/offline/progress-cache";

describe("adversarial swarm: GPS clock and null island", () => {
  const now = Date.parse("2026-08-20T12:00:00Z");

  it("does not trust a live callback whose GPS clock was missing", () => {
    const recordedAt = sanitizeFixTimestamp(0, now);
    expect(recordedAt).toBe(now);
    expect(getFixTimestampDiagnostic()).toBe("invalid-replaced");
    // Production marks that reading stale so isTrustedFix fails even at age 0.
    expect(isTrustedFix(recordedAt, true, now)).toBe(false);
  });

  it("rejects exact (0, 0) as a GPS failure, not a trailhead", () => {
    expect(isValidLatLng(0, 0)).toBe(false);
    expect(isValidLatLng(37.75, -119.54)).toBe(true);
  });

  it("refuses a blank typed heading so DR cannot invent 0° north", () => {
    expect(parseTypedHeading("")).toBeNull();
    expect(parseTypedHeading("   ")).toBeNull();
    expect(Number("")).toBe(0);
    expect(parseTypedHeading("0")).toBe(0);
    expect(parseTypedHeading("225")).toBe(225);
  });
});

describe("adversarial swarm: SOS and 9-line honesty", () => {
  it("does not advertise NaN coordinates as a live GPS fix", () => {
    const msg = emergencyMessage({ lat: Number.NaN, lng: Number.NaN, stale: false });
    expect(msg).toMatch(/No GPS fix/);
    expect(msg).not.toMatch(/NaN/);
    expect(msg).not.toMatch(/offline-capable GPS/);
  });

  it("cannot forge extra SOS lines from a hostile trail or ICE name", () => {
    const msg = emergencyMessage({
      lat: 37.1,
      lng: -119.2,
      trailName: "\r\nRoute: FORGED",
      profile: {
        name: "Pat\r\nHiker: EVIL",
        iceName: "",
        icePhone: "",
        medical: "none\nMedical: ALLERGIC TO EVERYTHING",
        partySize: 1,
      },
    });
    expect(msg.split("\n").some((line) => line === "Route: FORGED")).toBe(false);
    expect(msg.split("\n").some((line) => line === "Hiker: EVIL")).toBe(false);
    expect(msg.split("\n").some((line) => line === "Medical: ALLERGIC TO EVERYTHING")).toBe(false);
  });

  it("labels DR off-trail as dead reckon, not last known", () => {
    const msg = emergencyMessage({
      lat: 37.11,
      lng: -119.22,
      positionSource: "deadReckon",
      stale: true,
      offTrailM: 80,
    });
    expect(msg).toMatch(/DEAD RECKON/);
    expect(msg).not.toMatch(/LAST KNOWN was/);
  });

  it("marks a 9-line from last-known or DR so it is not read as a live grid", () => {
    expect(
      nineLineMedevac({ lat: 37.7, lng: -119.6, positionSource: "lastKnown" }),
    ).toMatch(/LAST KNOWN/);
    expect(
      nineLineMedevac({ lat: 37.7, lng: -119.6, positionSource: "deadReckon" }),
    ).toMatch(/DEAD RECKON/);
    expect(nineLineMedevac({ lat: Number.NaN, lng: Number.NaN })).toMatch(/UNKNOWN/);
  });
});

describe("adversarial swarm: check-in and weather age", () => {
  const now = Date.parse("2026-08-20T12:00:00Z");

  it("overdues an armed interval even if I'm OK was never tapped", () => {
    const status = checkinStatus(null, {
      enabled: true,
      intervalMin: 60,
      armedAt: new Date(now - 75 * 60_000).toISOString(),
    }, now);
    expect(status?.overdue).toBe(true);
    expect(status?.label).toMatch(/OVERDUE/);
  });

  it("refuses heat/cold advice from pack weather older than 18 hours", () => {
    expect(
      isPackWeatherFresh({
        source: "open-meteo",
        cachedAt: "2020-01-01T00:00:00.000Z",
        tempC: 40,
      }, now),
    ).toBe(false);
    expect(
      isPackWeatherFresh({
        source: "open-meteo",
        cachedAt: new Date(now - 60 * 60_000).toISOString(),
        tempC: 12,
      }, now),
    ).toBe(true);
  });
});

describe("adversarial swarm: remaining cache after refresh", () => {
  it("rebuilds when the same pack id gets new geometry", () => {
    const oldGeom: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [
        [-119.56, 37.75],
        [-119.54, 37.75],
        [-119.52, 37.75],
      ],
    };
    const newGeom: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [
        [-119.56, 37.75],
        [-119.54, 37.75],
        [-119.52, 37.75],
        [-119.5, 37.75],
      ],
    };
    const oldPack = buildRoutePack({ id: "x", name: "old", geometry: oldGeom });
    const newPack = buildRoutePack({
      id: "x",
      name: "new",
      geometry: newGeom,
    });
    expect(routePackFingerprint(oldPack)).not.toBe(routePackFingerprint(newPack));

    const stale = createRouteProgressCache(oldPack);
    const rebuilt = createRouteProgressCache(newPack);
    const onNew = { lat: 37.75, lng: -119.51 };
    const reference = progressAlongTrail(onNew, newGeom, [], "forward");
    expect(progressWithRouteCache(stale, onNew, "forward").remainingMeters).not.toBeCloseTo(
      reference.remainingMeters,
      0,
    );
    expect(progressWithRouteCache(rebuilt, onNew, "forward").remainingMeters).toBeCloseTo(
      reference.remainingMeters,
      0,
    );
  });
});
