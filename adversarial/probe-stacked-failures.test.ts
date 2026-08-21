import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { offTrailLevel } from "@/lib/safety/alerts";
import { assessDaylightMargin, guardianStatus, nextDecisionPoint } from "@/lib/safety/decision-support";
import { emergencyMessage } from "@/lib/safety/emergency";
import { isTrustedFix } from "@/lib/safety/gps-quality";
import { progressAlongTrail } from "@/lib/geo/navigation";
import { isFixNearRouteBbox } from "@/lib/safety/declination";
import { deriveCorridorBailouts } from "@/lib/offline/corridor-decisions";
import { parseBailoutGpx } from "@/lib/offline/bailout-routes";
import { buildHazardBrief, hazardBriefFreshness, validHazardBrief } from "@/lib/offline/hazard-brief";
import { packWeatherFreshness } from "@/lib/offline/pack-weather";
import { parseCorridorOverpassResponse } from "@/lib/osm/corridor-overpass";
import { enrichRoutePack, loadCachedRoutePack } from "@/lib/offline/load-route-pack";
import {
  backupParseError,
  parseRoutePackBackup,
  serializeRoutePackBackup,
} from "@/lib/offline/pack-backup";
import {
  ROUTE_PACK_DB_VERSION,
  buildRoutePack,
  getRoutePack,
  getRoutePackStatus,
  hasRoutePack,
  listRoutePacks,
  resetRoutePackDbForTests,
  sanitizeRoutePackForUse,
  saveRoutePack,
  validateRoutePack,
  type RoutePack,
} from "@/lib/offline/route-pack";

const DB_NAME = "hike-nav-packs";

/** A prepared Fiji walk that actually crosses 180°. */
const DATELINE: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [179.8, -16.5],
    [179.95, -16.5],
    [-179.95, -16.5],
    [-179.8, -16.5],
  ],
};

const SIERRA: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [-119.5, 37.7],
    [-119.4, 37.7],
  ],
};

function deleteDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function overwriteStoredPack(pack: RoutePack) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, ROUTE_PACK_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["routePacks", "aliases"], "readwrite");
      tx.objectStore("routePacks").put(pack);
      for (const alias of pack.aliases) {
        tx.objectStore("aliases").put({ alias, canonicalId: pack.id });
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  await resetRoutePackDbForTests();
}

function poisonEveryExtra(pack: RoutePack): RoutePack {
  const brief = buildHazardBrief({
    routeId: pack.id,
    samples: [{
      distanceMeters: 0,
      lat: pack.geometry.type === "LineString" ? pack.geometry.coordinates[0][1] : 0,
      lng: pack.geometry.type === "LineString" ? pack.geometry.coordinates[0][0] : 0,
      hours: [{
        time: "2026-08-21T12:00",
        tempC: 12,
        rhPct: 40,
        precipMm: 0,
        precipProb: 5,
        windKph: 8,
        gustKph: 12,
        weatherCode: 1,
      }],
    }],
    now: Date.now() - 60_000,
  });
  return {
    ...pack,
    weather: { source: "open-meteo", cachedAt: "not-a-date", tempC: Number.NaN },
    corridor: pack.corridor
      ? { ...pack.corridor, routeId: "foreign-trail" }
      : pack.corridor,
    corridorFeatures: {
      routeId: "foreign-trail",
      fetchedAt: new Date().toISOString(),
      source: "openstreetmap-overpass",
      bboxes: pack.corridor?.bboxes ?? [[0, 0, 1, 1]],
      layersIncluded: ["water"],
      featureCount: 1,
      disclaimer: "safe to drink",
      features: { type: "FeatureCollection", features: [] },
    },
    hazardBrief: {
      ...brief,
      routeId: "foreign-trail",
      disclaimer: "Current weather. You are safe.",
    },
    bailoutRoutes: [{
      id: "invented",
      routeId: "nope",
      name: "Invented connector",
      disclaimer: "shortcut",
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
      join: { lat: 0, lng: 0, alongMeters: 0, offsetMeters: 0 },
      lengthMeters: 100,
    }],
  };
}

beforeEach(async () => {
  await resetRoutePackDbForTests();
  await deleteDatabase();
});

afterEach(async () => {
  await resetRoutePackDbForTests();
});

describe("stacked failures: extras must not kill a prepared route", () => {
  it("still loads, lists, and backs up a pack when every optional extra is poisoned at once", async () => {
    const honest = buildRoutePack({ id: "plan-stack", name: "Dateline walk", geometry: DATELINE });
    await saveRoutePack(honest);
    await overwriteStoredPack(poisonEveryExtra(honest));

    expect(validateRoutePack(poisonEveryExtra(honest))).not.toBeNull();

    const lookup = await getRoutePackStatus("plan-stack");
    expect(lookup.status).toBe("ready");
    expect(lookup.pack?.geometry).toEqual(honest.geometry);
    expect(lookup.pack?.lengthMeters).toBeGreaterThan(0);
    expect(lookup.pack?.hazardBrief).toBeUndefined();
    expect(lookup.pack?.corridor).toBeUndefined();
    expect(lookup.pack?.corridorFeatures).toBeUndefined();
    expect(lookup.pack?.bailoutRoutes).toBeUndefined();
    expect(lookup.pack?.weather).toBeUndefined();
    expect(lookup.strippedExtras).toEqual(expect.arrayContaining([
      "weather",
      "corridor",
      "corridorFeatures",
      "hazardBrief",
      "bailoutRoutes",
    ]));

    await expect(hasRoutePack("plan-stack")).resolves.toBe(true);
    await expect(loadCachedRoutePack("plan-stack")).resolves.toMatchObject({ id: "plan-stack" });
    expect((await listRoutePacks()).map((pack) => pack.id)).toContain("plan-stack");

    const listed = (await listRoutePacks()).find((pack) => pack.id === "plan-stack");
    expect(listed).toBeTruthy();
    const backup = parseRoutePackBackup(serializeRoutePackBackup(listed!));
    expect(backupParseError(backup)).toBeNull();
    if ("pack" in backup) {
      expect(backup.pack.geometry).toEqual(honest.geometry);
      expect(backup.pack.hazardBrief).toBeUndefined();
    }
  });

  it("still rejects a pack whose core geometry is gone", async () => {
    const honest = buildRoutePack({ id: "plan-core", name: "Core", geometry: SIERRA });
    await saveRoutePack(honest);
    await overwriteStoredPack({ ...honest, geometry: { type: "LineString", coordinates: [] } });
    await expect(getRoutePack("plan-core")).resolves.toBeNull();
    await expect(getRoutePackStatus("plan-core")).resolves.toMatchObject({ status: "invalid" });
    await expect(loadCachedRoutePack("plan-core")).rejects.toThrow(/corrupt|invalid|geometry/i);
  });

  it("imports a backup after stripping a foreign corridor instead of discarding the route", () => {
    const pack = buildRoutePack({ id: "plan-backup", name: "Backup", geometry: SIERRA });
    const wrapper = JSON.parse(serializeRoutePackBackup(pack)) as { pack: RoutePack };
    wrapper.pack = { ...wrapper.pack, corridor: { ...wrapper.pack.corridor!, routeId: "someone-else" } };
    const parsed = parseRoutePackBackup(JSON.stringify(wrapper));
    expect(backupParseError(parsed)).toBeNull();
    if ("pack" in parsed) {
      expect(parsed.pack.geometry).toEqual(pack.geometry);
      expect(parsed.pack.corridor).toBeUndefined();
    }
  });
});

describe("stacked failures: clock + weather + forecast must not claim freshness", () => {
  it("treats a snapshot from the future as unavailable, not fresh", () => {
    const now = Date.parse("2026-08-21T12:00:00.000Z");
    const future = "2026-08-21T18:00:00.000Z";
    expect(packWeatherFreshness({
      source: "open-meteo",
      cachedAt: future,
      fetchedAt: future,
      lat: 37.7,
      lng: -119.5,
      tempC: 33,
    }, now)).toMatchObject({
      kind: "unavailable",
      reason: expect.stringMatching(/clock/i),
    });

    const brief = buildHazardBrief({
      routeId: "plan-clock",
      samples: [{
        distanceMeters: 0,
        lat: 37.7,
        lng: -119.5,
        hours: [{
          time: "2026-08-21T18:00",
          tempC: 33,
          rhPct: 20,
          precipMm: 0,
          precipProb: 0,
          windKph: 5,
          gustKph: 8,
          weatherCode: 0,
        }],
      }],
      now: Date.parse(future),
    });
    const freshness = hazardBriefFreshness(brief, now);
    expect(freshness.kind).toBe("unavailable");
    expect(freshness.kind === "unavailable" ? freshness.reason : "").toMatch(/clock|current weather/i);
    expect(JSON.stringify(freshness)).not.toMatch(/fresh/i);
  });
});

describe("stacked failures: dateline + stale GPS + extras + invented exits", () => {
  it("keeps the trail, refuses invented exits, and never says ok/fresh/on-time", () => {
    const pack = buildRoutePack({ id: "plan-fiji", name: "Fiji coast", geometry: DATELINE });
    expect(pack.bbox[2]).toBeGreaterThan(180);
    expect(isFixNearRouteBbox(-16.5, 179.9, pack.bbox)).toBe(true);
    expect(isFixNearRouteBbox(-16.5, -179.9, pack.bbox)).toBe(true);
    const westSample = buildHazardBrief({
      routeId: pack.id,
      samples: [{
        distanceMeters: 0,
        lat: -16.5,
        lng: -179.9,
        hours: [{
          time: "2026-08-21T12:00",
          tempC: 26,
          rhPct: 70,
          precipMm: 0,
          precipProb: 10,
          windKph: 12,
          gustKph: 18,
          weatherCode: 1,
        }],
      }],
      now: Date.now() - 60_000,
    });
    expect(validHazardBrief(westSample, pack.id, pack.bbox)).toBe(true);
    expect(validHazardBrief({
      ...westSample,
      samples: [{ ...westSample.samples[0], lat: 51.5, lng: 0 }],
    }, pack.id, pack.bbox)).toBe(false);

    const fromWorldBbox = buildRoutePack({
      id: "plan-fiji-osm",
      name: "OSM world box",
      geometry: DATELINE,
      bbox: [-180, -90, 180, 90],
    });
    expect(fromWorldBbox.bbox[2] - fromWorldBbox.bbox[0]).toBeLessThan(180);
    expect(isFixNearRouteBbox(51.5, 0, fromWorldBbox.bbox)).toBe(false);
    const poisoned = poisonEveryExtra(pack);
    const { pack: usable, stripped } = sanitizeRoutePackForUse(poisoned);
    expect(validateRoutePack(usable)).toBeNull();
    expect(usable.geometry).toEqual(DATELINE);
    expect(stripped.length).toBeGreaterThanOrEqual(4);

    const greenwich = { lat: 51.5, lng: 0 };
    const progress = progressAlongTrail(greenwich, usable.geometry);
    expect(progress.valid).toBe(true);
    expect(progress.offsetMeters).toBeGreaterThan(1_000_000);
    expect(isFixNearRouteBbox(greenwich.lat, greenwich.lng, usable.bbox)).toBe(false);

    const staleAt = Date.now() - 30 * 60_000;
    expect(isTrustedFix(staleAt, true)).toBe(false);
    expect(offTrailLevel(progress.offsetMeters, 8, { trustedFix: false })).toBe("unknown");
    expect(offTrailLevel(progress.offsetMeters, 8, { trustedFix: true })).toBe("critical");

    const water = parseCorridorOverpassResponse({
      routeId: pack.id,
      bboxes: pack.corridor!.bboxes,
      elements: [
        { type: "way", id: 9, tags: { waterway: "stream", name: "Creek" }, geometry: [
          { lat: -16.5, lon: 179.9 },
          { lat: -16.5, lon: 179.91 },
        ] },
      ],
    });
    expect(deriveCorridorBailouts({ geometry: DATELINE, features: water })).toEqual([]);

    const distant = parseBailoutGpx({
      routeId: pack.id,
      name: "London.gpx",
      gpx: `<gpx><trk><trkseg><trkpt lat="51.5" lon="-0.12"></trkpt><trkpt lat="51.51" lon="-0.11"></trkpt></trkseg></trk></gpx>`,
      main: DATELINE,
    });
    expect(distant).toMatchObject({ error: expect.stringMatching(/will not invent a connector/i) });

    const daylight = assessDaylightMargin({
      now: new Date("nonsense"),
      lat: -16.5,
      lng: 179.9,
      remainingMeters: Number.NaN,
      paceMetersPerHour: 0,
    });
    const guardian = guardianStatus(new Date("nonsense"), new Date("2026-08-21T22:00:00.000Z"));
    const sos = emergencyMessage({
      lat: greenwich.lat,
      lng: greenwich.lng,
      stale: true,
      recordedAt: staleAt,
      positionSource: "lastKnown",
      trailName: pack.name,
    });

    expect(daylight.severity).toBe("unknown");
    expect(daylight.message).not.toMatch(/NaN|ok/i);
    expect(guardian.state).toBe("unknown");
    expect(guardian.message).not.toMatch(/on-time|distress/i);
    expect(sos).toMatch(/LAST KNOWN POSITION/i);
    expect(sos).not.toMatch(/current weather|you are safe/i);
    expect(nextDecisionPoint([], Number.NaN)).toBeNull();
  });
});

describe("stacked failures: plan-page enrich + invalid weather", () => {
  it("drops poisoned weather instead of throwing and wiping extras", () => {
    const geometry = SIERRA;
    const honest = buildRoutePack({ id: "plan-enrich", name: "Enrich", geometry });
    const existing = {
      ...honest,
      weather: { source: "open-meteo" as const, cachedAt: "bogus", tempC: Number.NaN },
    };
    const rebuilt = buildRoutePack({ id: "plan-enrich", name: "Rebuilt", geometry });
    const merged = enrichRoutePack(rebuilt, existing);
    expect(merged.weather).toBeUndefined();
    expect(merged.geometry).toEqual(geometry);
    expect(merged.name).toBe("Rebuilt");
  });
});
