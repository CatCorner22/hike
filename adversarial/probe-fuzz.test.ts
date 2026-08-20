import { describe, expect, it } from "vitest";
import * as geo from "@/lib/geo";
import * as antimeridian from "@/lib/geo/antimeridian";
import * as bbox from "@/lib/geo/bbox";
import * as elevationGain from "@/lib/geo/elevation-gain";
import * as navigation from "@/lib/geo/navigation";
import * as project from "@/lib/geo/project";
import * as alerts from "@/lib/safety/alerts";
import * as briefs from "@/lib/safety/briefs";
import * as checkin from "@/lib/safety/checkin";
import * as dossier from "@/lib/safety/dossier";
import * as altitude from "@/lib/safety/altitude";
import * as astro from "@/lib/safety/astro";
import * as avalanche from "@/lib/safety/avalanche";
import * as backtrack from "@/lib/safety/backtrack";
import * as comms from "@/lib/safety/comms";
import * as daylight from "@/lib/safety/daylight";
import * as declination from "@/lib/safety/declination";
import * as emergency from "@/lib/safety/emergency";
import * as fieldOps from "@/lib/safety/field-ops";
import * as field from "@/lib/safety/field";
import * as medevac from "@/lib/safety/medevac";
import * as navlog from "@/lib/safety/navlog";
import * as paperBackup from "@/lib/safety/paper-backup";
import * as profile from "@/lib/safety/profile";
import * as readiness from "@/lib/safety/readiness";
import * as reportField from "@/lib/safety/report-field";
import * as reports from "@/lib/safety/reports";
import * as routeCard from "@/lib/safety/route-card";
import * as strobe from "@/lib/safety/strobe";
import * as tqStore from "@/lib/safety/tq-store";
import * as triagePriority from "@/lib/safety/triage-priority";
import * as verify from "@/lib/safety/verify";
import * as wildlife from "@/lib/safety/wildlife";
import * as gps from "@/lib/safety/gps-quality";
import * as landnav from "@/lib/safety/landnav";
import * as load from "@/lib/safety/load";
import * as pace from "@/lib/safety/pace";
import * as sar from "@/lib/safety/sar-advanced";
import * as search from "@/lib/safety/search";
import * as sere from "@/lib/safety/sere";
import * as tactics from "@/lib/safety/tactics";
import * as tccc from "@/lib/safety/tccc";
import * as thermal from "@/lib/safety/thermal";
import * as usng from "@/lib/safety/usng";
import * as water from "@/lib/safety/water";
import * as wilderness from "@/lib/safety/wilderness";

/** This list is deliberately hostile: exact boundaries, adjacent float values, signed zero, and corrupt telemetry. */
const N = [
  Number.NaN, Infinity, -Infinity, -0, Number.MIN_VALUE, -Number.MIN_VALUE,
  Number.MAX_VALUE, -Number.MAX_VALUE, -1e308, 1e308, -90, -80, -0.000001,
  0, 0.000001, 1, 5, 8, 10, 20, 25, 25.6, 27.8, 29.4, 30, 31.1, 32.2,
  35, 45, 50, 80, 84, 90, 100, 500, 1000, 2500, 3000, 9000,
] as const;
const NEXT = (n: number, direction: -1 | 1) => n === 0 ? direction * Number.MIN_VALUE : n + direction * Math.abs(n) * Number.EPSILON;
// `-0` must be a complete rendered number. The old broad matcher also caught
// ordinary ISO dates such as `1970-01-01`, rather than an unsafe numeric render.
const BAD_TEXT = /(?:NaN|Infinity|undefined|null|-0(?:\.0+)?(?=\D|$)|\b\d+(?:\.\d+)?e[+-]\d+)/i;
const rank = { info: 0, caution: 1, warning: 2, critical: 3 } as const;
const NOW = Date.parse("2026-08-20T12:00:00Z");

/** Runtime inventory makes new exported functions visible to this probe immediately. */
const MODULES = {
  "geo/index": geo, "geo/antimeridian": antimeridian, "geo/bbox": bbox,
  "geo/elevation-gain": elevationGain, "geo/navigation": navigation, "geo/project": project,
  "safety/alerts": alerts, "safety/altitude": altitude, "safety/astro": astro,
  "safety/briefs": briefs, "safety/checkin": checkin, "safety/dossier": dossier,
  "safety/avalanche": avalanche, "safety/backtrack": backtrack, "safety/comms": comms,
  "safety/daylight": daylight, "safety/declination": declination, "safety/emergency": emergency,
  "safety/field-ops": fieldOps, "safety/gps-quality": gps, "safety/landnav": landnav,
  "safety/field": field, "safety/medevac": medevac, "safety/navlog": navlog,
  "safety/paper-backup": paperBackup, "safety/profile": profile, "safety/readiness": readiness,
  "safety/report-field": reportField, "safety/reports": reports, "safety/route-card": routeCard,
  "safety/strobe": strobe, "safety/tq-store": tqStore, "safety/triage-priority": triagePriority,
  "safety/verify": verify, "safety/wildlife": wildlife,
  "safety/load": load, "safety/pace": pace, "safety/sar-advanced": sar,
  "safety/search": search, "safety/sere": sere, "safety/tactics": tactics,
  "safety/tccc": tccc, "safety/thermal": thermal, "safety/usng": usng,
  "safety/water": water, "safety/wilderness": wilderness,
} as const;
const discovered = Object.fromEntries(Object.entries(MODULES).map(([name, mod]) => [
  name, Object.keys(mod).filter((key) => typeof (mod as Record<string, unknown>)[key] === "function").sort(),
]));

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}
function noBadText(label: string, value: unknown, failures: string[]) {
  for (const text of strings(value)) if (BAD_TEXT.test(text)) failures.push(`${label}: ${JSON.stringify(text)}`);
}
function doesNotThrow(label: string, fn: () => unknown, failures: string[]) {
  try { return fn(); } catch (error) { failures.push(`${label}: threw ${error instanceof Error ? error.message : String(error)}`); return undefined; }
}

// Every probe below is reusable with all hostile values. Each calculation accepts only valid
// shapes where required; invalid scalar telemetry is supplied at every scalar boundary.
describe("AGENT-FUZZ exported safety and geo calculation sweep", () => {
  it("discovers exported calculation functions across the complete scoped module list", () => {
    expect(Object.keys(discovered)).toHaveLength(46);
    for (const [module, names] of Object.entries(discovered)) {
      expect(names.length, `${module} has no discovered callable exports`).toBeGreaterThan(0);
    }
  });

  it("never leaks hostile scalar telemetry into rendered safety text", () => {
    const failures: string[] = [];
    for (const n of N) {
      const cases: Array<[string, () => unknown]> = [
        [`geo.formatDistance(${n})`, () => geo.formatDistance(n)],
        [`geo.formatElevation(${n})`, () => geo.formatElevation(n)],
        [`geo.formatDuration(${n})`, () => geo.formatDuration(n)],
        [`geo.formatPace(${n})`, () => geo.formatPace(n)],
        [`navigation.gpsAccuracyLabel(${n})`, () => navigation.gpsAccuracyLabel(n)],
        [`emergency.formatCoords(${n},40,${n})`, () => emergency.formatCoords(n, 40, n)],
        [`emergency.emergencyMessage(recordedAt=${n})`, () => emergency.emergencyMessage({ lat: 40, lng: -105, recordedAt: n })],
        [`fieldOps.batterySafetyAdvice(${n},false)`, () => fieldOps.batterySafetyAdvice(n, false)],
        [`pace.formatNaismith(${n})`, () => pace.formatNaismith(n)],
        [`declination.formatWalkBearing(${n},40,-105)`, () => declination.formatWalkBearing(n, 40, -105)],
        [`landnav.formatTsd(${n})`, () => landnav.formatTsd({ distanceM: n, speedKph: n, minutes: n })],
        [`astro.sunCompassHint(invalid,${n},${n})`, () => astro.sunCompassHint(new Date(NaN), n, n)],
      ];
      for (const [label, fn] of cases) noBadText(label, doesNotThrow(label, fn, failures), failures);
    }
    // Refusals are part of the safety contract, not merely the absence of a bad token.
    expect(navigation.gpsAccuracyLabel(Number.NaN)).toBe("GPS accuracy unknown");
    expect(navigation.gpsAccuracyLabel(-Infinity)).toBe("GPS accuracy unknown");
    expect(pace.formatNaismith(Infinity)).toBe("Naismith unavailable");
    expect(astro.sunCompassHint(new Date(NaN), Number.NaN, Number.NaN))
      .toBe("Sun position unavailable — use a compass.");
    expect(fieldOps.batterySafetyAdvice(-Infinity, false)).toBeNull();
    expect(geo.formatDistance(Number.MAX_VALUE)).toBe("—");
    expect(geo.formatElevation(-Number.MIN_VALUE)).toBe("0 ft");
    expect(geo.formatPace(Number.MAX_VALUE)).toBe("—");
    expect(landnav.formatTsd({ distanceM: Number.MAX_VALUE, speedKph: 1, minutes: 1 })).toBe("—");
    expect(failures).toEqual([]);
  });

  it("refuses non-finite geographic fixes rather than throwing or calculating a position", () => {
    const failures: string[] = [];
    const cleanLine = { type: "LineString", coordinates: [[-105, 40], [-104.99, 40.01]] } as GeoJSON.LineString;
    for (const n of N) {
      const point = { lat: n, lng: -105 };
      const calls: Array<[string, () => unknown]> = [
        [`geo.distanceToTrailMeters(${n})`, () => geo.distanceToTrailMeters(point, cleanLine)],
        [`geo.nearestPointOnTrail(${n})`, () => geo.nearestPointOnTrail(point, cleanLine)],
        [`geo.bearingBetween(${n})`, () => geo.bearingBetween(point, { lat: 40, lng: -105 })],
        [`landnav.rangeAzimuth(${n})`, () => landnav.rangeAzimuth(point, { lat: 40, lng: -105 })],
        [`landnav.deadReckon(${n})`, () => landnav.deadReckon(point, 90, 100)],
        [`search.expandingSquareLine(${n})`, () => search.expandingSquareLine(point, 10)],
        [`project.followWindow(${n})`, () => project.followWindow(point)],
      ];
      for (const [label, fn] of calls) {
        const value = doesNotThrow(label, fn, failures);
        if (!Number.isFinite(n) || n < -90 || n > 90) {
          if (value != null && !(typeof value === "number" && Number.isNaN(value))) {
            failures.push(`${label}: calculated ${JSON.stringify(value)} from invalid latitude`);
          }
        }
      }
    }
    expect(geo.distanceToTrailMeters({ lat: 100, lng: -105 }, cleanLine)).toSatisfy(Number.isNaN);
    expect(geo.nearestPointOnTrail({ lat: 100, lng: -105 }, cleanLine)).toBeNull();
    expect(geo.bearingBetween({ lat: 100, lng: -105 }, { lat: 40, lng: -105 })).toSatisfy(Number.isNaN);
    expect(landnav.rangeAzimuth({ lat: 100, lng: -105 }, { lat: 40, lng: -105 })).toBeNull();
    expect(landnav.deadReckon({ lat: 100, lng: -105 }, 90, 100)).toBeNull();
    expect(search.expandingSquareLine({ lat: 100, lng: -105 }, 10)).toBeNull();
    expect(project.followWindow({ lat: Number.NaN, lng: -105 })).toBeNull();
    expect(failures).toEqual([]);
  });

  it("is deterministic when an explicit time is supplied and handles degenerate arrays", () => {
    const failures: string[] = [];
    const arrays = [[], [{ lat: 40, lng: -105 }], [{ lat: Number.NaN, lng: -105 }, { lat: 40, lng: -105 }]];
    for (const points of arrays) {
      for (const [label, fn] of [
        [`backtrack.stationaryMinutes(${points.length})`, () => backtrack.stationaryMinutes(points, NOW)],
        [`backtrack.rapidAscentWarning(${points.length})`, () => backtrack.rapidAscentWarning(points, NOW)],
        [`backtrack.gainLastHourM(${points.length})`, () => backtrack.gainLastHourM(points, NOW)],
      ] as const) doesNotThrow(label, fn, failures);
    }
    const deterministic: Array<[string, () => unknown]> = [
      ["alerts.shouldRepeatAlert", () => alerts.shouldRepeatAlert(0, "warn", NOW)],
      ["sar.commsWindowReminder", () => sar.commsWindowReminder(0, NOW)],
      ["tccc.tourniquetStatus", () => tccc.tourniquetStatus(0, NOW)],
      ["gps.formatFixAge", () => gps.formatFixAge(0, NOW)],
      ["backtrack.stationaryMinutes", () => backtrack.stationaryMinutes([{ lat: 40, lng: -105, recordedAt: 0 }, { lat: 40, lng: -105, recordedAt: NOW }], NOW)],
    ];
    for (const [label, fn] of deterministic) expect(fn(), label).toEqual(fn());
    expect(backtrack.stationaryMinutes([
      { lat: Number.NaN, lng: -105, recordedAt: NOW - 60_000 },
      { lat: 40, lng: -105, recordedAt: NOW },
    ], NOW)).toBe(0);
    expect(failures).toEqual([]);
  });

  it("keeps all graded hazards monotonic through thresholds and one ULP either side", () => {
    const failures: string[] = [];
    const grade = (label: string, values: number[], f: (n: number) => keyof typeof rank | null) => {
      let previous = -1;
      for (const n of values) {
        const severity = f(n);
        if (severity == null) continue;
        const current = rank[severity];
        if (current < previous) failures.push(`${label}: severity fell at ${n}, rank ${previous} -> ${current}`);
        previous = current;
      }
    };
    const around = (boundaries: number[]) => boundaries.flatMap((x) => [NEXT(x, -1), x, NEXT(x, 1)]).sort((a, b) => a - b);
    grade("avalanche slope", [0, ...around([25, 30, 45, 50]), 90], n => avalanche.avalancheTerrainRisk(n)?.severity ?? null);
    grade("heat WBGT", [-20, ...around([25.6, 27.8, 29.4, 31.1, 32.2]), 60], n => {
      const c = thermal.heatCategory(n); return c == null ? null : (["info", "info", "caution", "warning", "critical"][c.category - 1] as keyof typeof rank);
    });
    grade("load fraction", around([20, 30]), n => load.packWeightAdvice({ bodyMassKg: 100, packKg: n })?.severity ?? null);
    grade("ascent gain", around([500]), n => altitude.ascentRateAdvice({ previousNightElevationM: 3000, currentElevationM: 3000 + n })?.severity ?? null);
    grade("ascent altitude", [2499.9999999999995, 2500, 2500.0000000000005, 2999.9999999999995, 3000, 3000.0000000000005, 3000.1, 3500],
      n => altitude.ascentRateAdvice({ previousNightElevationM: 3000, currentElevationM: n })?.severity ?? null);
    expect(failures).toEqual([]);
  });

  it("keeps unit conversions and same-quantity renderings consistent", () => {
    // m -> ft shown by formatElevation; the known factor must round identically.
    for (const metres of [0, 1, 100, 1609.344, 3000, 8848]) {
      expect(geo.formatElevation(metres)).toBe(`${Math.round(metres * 3.28084).toLocaleString()} ft`);
      const paces = landnav.distanceFromPaces(100, 100, "flat");
      expect(paces).toBe(100);
      expect(landnav.timeSpeedDistance({ distanceM: 1000, speedKph: 60 })?.minutes).toBeCloseTo(1);
    }
    const at = { lat: 40.12345, lng: -105.12345 };
    expect(usng.formatUsng(at.lat, at.lng)).toEqual(usng.formatUsng(at.lat, at.lng));
    expect(usng.utmToLatLng(usng.latLngToUtm(at.lat, at.lng)!)).toMatchObject({ lat: expect.closeTo(at.lat, 4), lng: expect.closeTo(at.lng, 4) });
  });

  it("keeps severe action modules free of movement and fluid contradictions", () => {
    const altitudeEmergency = altitude.descentImperative({ hasAtaxia: true, alteredMental: false, breathlessAtRest: false });
    const move = tactics.casevacDecision({ injured: true, canWalk: false, isDark: true, partySize: 2, medicalOverride: "severe-altitude-illness" });
    expect(altitudeEmergency.mustDescend).toBe(true);
    expect(move.choice).toBe("urgent-assisted-descent");
    const heat = thermal.heatIllnessTriage({ alteredMental: true, sweating: true, crampsOnly: false, coreTempC: 41 })!;
    expect(heat.actions.join(" ")).toMatch(/do not force fluids/i);
    expect(water.sourceRisk({ source: "lake", algaeVisible: true, upstreamCamping: false, upstreamGrazing: false }).message).toMatch(/Do not drink/i);
    expect(sar.litterEvacAdvice(1000, 2).message).toMatch(/shelter in place/i);
    expect(wilderness.foodStorageReminder(true)).toMatch(/No food in tent/i);
  });
});
