import { describe, expect, it } from "vitest";
import { offTrailLevel } from "@/lib/safety/alerts";
import { formatUsng, formatMgrs10, latLngToUtm, utmZone } from "@/lib/safety/usng";
import { bboxFromGeometry, formatDistance, formatElevation, formatDuration, formatPace } from "@/lib/geo";
import { isFixNearRouteBbox } from "@/lib/safety/declination";
import { safeBbox } from "@/lib/geo/navigation";
import { progressAlongTrail } from "@/lib/geo/navigation";
import { hydrationPlan, chemicalDoseWaitMinutes, sourceRisk, boilTimeMinutes } from "@/lib/safety/water";
import { heatIndexC, windChillC, lightningRule } from "@/lib/safety/field-ops";
import { avalancheTerrainRisk } from "@/lib/safety/avalanche";
import { nineLineMedevac } from "@/lib/safety/medevac";
import { casualtyCard, tourniquetStatus } from "@/lib/safety/tccc";
import { litterEvacTime } from "@/lib/safety/sar-advanced";

/**
 * litterEvacTime returns prose or null. Either is an acceptable refusal; a
 * time estimate derived from impossible input is not. Asserting on null alone
 * would miss the real failure, which is a confident "~0 min" from garbage.
 */
function statesNoCarryTime(message: string | null): boolean {
  return message == null || !/~\s*[\d.]+\s*(min|h)\b/.test(message);
}

import { radioHorizonKm } from "@/lib/safety/comms";
import { normalizeHeading } from "@/lib/geo/navigation";

describe("VERIFY: alert suppression can no longer happen", () => {
  it("offTrailLevel never returns ok for invalid data", () => {
    for (const bad of [NaN, Infinity, -Infinity, null, undefined]) {
      const r = offTrailLevel(bad as number, 5);
      console.log("offTrailLevel", String(bad), "->", JSON.stringify(r));
      expect(r).not.toBe("ok");
    }
  });
});

describe("VERIFY: no fabricated rescue grids", () => {
  it("refuses UTM outside 80S-84N", () => {
    for (const lat of [-90, -80.001, 84.001, 89.999, 90]) {
      expect(latLngToUtm(lat, 0)).toBeNull();
      expect(formatUsng(lat, 0)).toBeNull();
      expect(formatMgrs10(lat, 0)).toBeNull();
    }
  });
  it("never emits zone 61", () => {
    for (const lng of [180, -180, 179.999999, 1e9]) {
      const z = utmZone(0, lng);
      console.log("utmZone lng", lng, "->", z);
      if (z !== null) expect(z).toBeLessThanOrEqual(60);
      if (z !== null) expect(z).toBeGreaterThanOrEqual(1);
    }
  });
  it("still works at valid latitudes", () => {
    expect(formatUsng(37.7749, -119.5383)).toBeTruthy();
  });
});

describe("VERIFY: antimeridian no longer suppresses off-route warning", () => {
  const wrapped: GeoJSON.LineString = { type: "LineString", coordinates: [[179.9, 0], [-179.9, 0]] };
  it("bbox span is small, not global", () => {
    const b = bboxFromGeometry(wrapped, 0);
    expect(b).not.toBeNull();
    const span = Math.abs(b![2] - b![0]);
    console.log("wrapped bbox", JSON.stringify(b), "span", span);
    expect(span).toBeLessThan(5);
  });
  it("rejects a Greenwich fix as near-route", () => {
    const b = safeBbox(wrapped);
    expect(b).not.toBeNull();
    const near = isFixNearRouteBbox(0, 0, b!);
    console.log("Greenwich near dateline route?", near);
    expect(near).toBe(false);
  });
  it("still accepts a fix actually on the route", () => {
    const b = safeBbox(wrapped);
    expect(b).not.toBeNull();
    expect(isFixNearRouteBbox(0, 179.95, b!)).toBe(true);
  });
});

describe("VERIFY: no crash on corrupt geometry", () => {
  it("progressAlongTrail does not throw on NaN coordinate", () => {
    expect(() =>
      progressAlongTrail({ lat: 0, lng: 0 }, { type: "LineString", coordinates: [[0, 0], [NaN, 0]] }),
    ).not.toThrow();
  });
});

describe("VERIFY: hard safety caps hold", () => {
  it("hydrationPlan respects 12 L/day", () => {
    for (const hours of [12, 24, 48, 72, 1000]) {
      const p = hydrationPlan({ hours, tempC: 60, workRate: "hard" });
      console.log("hydrationPlan", hours, "h ->", JSON.stringify(p));
      if (p && typeof p.liters === "number") expect(p.liters).toBeLessThanOrEqual(12);
    }
  });
});

describe("VERIFY: fail-closed on unknown enums and impossible physics", () => {
  it("unknown water method/source fails closed", () => {
    expect(chemicalDoseWaitMinutes({ method: "fake" as never, waterTempC: 20, cloudy: false })).toBeNull();
    const r = sourceRisk({ source: "fake" as never, upstreamGrazing: false, upstreamCamping: false, algaeVisible: false });
    console.log("unknown source ->", JSON.stringify(r));
    expect(r === null || r.severity === "critical" || r.treatBefore === true).toBe(true);
  });
  it("impossible weather returns null", () => {
    expect(heatIndexC(1000, 500)).toBeNull();
    expect(windChillC(-300, 30)).toBeNull();
    expect(lightningRule(-5)).toBeNull();
    expect(boilTimeMinutes(-50000)).toBeNull();
    expect(radioHorizonKm(1e6)).toBeNull();
    // Asserts the safety property (no fictional ETA) rather than the exact
    // representation, because the contract legitimately changed from null to a
    // refusal message and back to nullable during hardening.
    expect(statesNoCarryTime(litterEvacTime(-5, 2))).toBe(true);
  });
});

describe("VERIFY: severity monotonic in hazard", () => {
  it("avalanche terrain risk never drops as slope steepens", () => {
    const rank = { info: 0, caution: 1, warning: 2, critical: 3 } as const;
    let prev = -1;
    const drops: string[] = [];
    for (let a = 0; a <= 90; a++) {
      const r = avalancheTerrainRisk(a);
      if (!r) continue;
      const cur = rank[r.severity];
      if (cur < prev) drops.push(`${a - 1}->${a}`);
      prev = cur;
    }
    console.log("monotonicity drops:", JSON.stringify(drops));
    expect(drops).toEqual([]);
  });
});

describe("VERIFY: report field injection blocked", () => {
  const hostile = "\r\nL1 LOCATION: FORGED\u0000\u202e" + "X".repeat(10000);
  it("9-line cannot be forged with newlines", () => {
    const out = nineLineMedevac({
      location: hostile, callsign: hostile, patients: hostile, equipment: hostile,
      security: hostile, marking: hostile, nationality: hostile, terrain: hostile,
    } as never);
    console.log("9line contains forged line?", /^L1 LOCATION: FORGED/m.test(out));
    expect(/^L1 LOCATION: FORGED/m.test(out)).toBe(false);
    expect(out).not.toContain("\u0000");
    expect(out).not.toContain("\u202e");
  });
  it("casualty card cannot be forged", () => {
    const out = casualtyCard({ name: hostile, mechanism: hostile, injuries: hostile } as never);
    expect(/^L1 LOCATION: FORGED/m.test(out)).toBe(false);
    expect(out).not.toContain("\u0000");
  });
});

describe("VERIFY: user-facing formatters never show NaN or Infinity", () => {
  it("all formatters degrade safely", () => {
    const bad = [NaN, Infinity, -Infinity];
    for (const v of bad) {
      for (const [name, fn] of [["distance", formatDistance], ["elevation", formatElevation], ["duration", formatDuration], ["pace", formatPace]] as const) {
        const s = fn(v);
        console.log(name, String(v), "->", JSON.stringify(s));
        expect(s).not.toMatch(/NaN|Infinity|∞/);
      }
    }
  });
  it("normalizeHeading rejects NaN", () => {
    expect(normalizeHeading(NaN)).toBeNull();
  });
});

describe("VERIFY: tourniquet threshold exact", () => {
  it("classifies on raw elapsed, not rounded", () => {
    const now = Date.now();
    // Conversion criteria affirmed, so the only variable left is the clock.
    const cleared = { evacuationDelayed: true, inShock: false, amputation: false, alone: false };
    const justUnder = tourniquetStatus(now - 119.999 * 60_000, now, cleared);
    const justOver = tourniquetStatus(now - 120.001 * 60_000, now, cleared);
    console.log("119.999m:", JSON.stringify(justUnder));
    console.log("120.001m:", JSON.stringify(justOver));
    expect(justUnder?.conversionWindow).toBe(true);
    expect(justOver?.conversionWindow).toBe(false);
  });
});
