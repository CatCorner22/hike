import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OFFICIAL_ALERTS_STALE_MS,
  describeOfficialAlertSnapshot,
  fetchOfficialRouteAlerts,
  officialAlertFreshness,
  parseNwsAlerts,
  validOfficialAlertSnapshot,
} from "./official-alerts";

const NOW = Date.parse("2026-08-22T12:00:00.000Z");
const NWS_ALERT = {
  features: [{
    id: "https://api.weather.gov/alerts/urn:oid:example",
    properties: {
      event: "Flash Flood Warning",
      headline: "Flash Flood Warning issued for the route area",
      description: "Move away from streams.",
      instruction: "Do not cross flooded roads or trails.",
      severity: "Severe",
      urgency: "Immediate",
      certainty: "Observed",
      sent: "2026-08-22T11:45:00.000Z",
      effective: "2026-08-22T11:45:00.000Z",
      expires: "2026-08-22T14:00:00.000Z",
      "@id": "https://api.weather.gov/alerts/urn:oid:example",
    },
  }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("NWS alert parsing", () => {
  it("preserves official evidence and normalizes CAP certainty fields", () => {
    expect(parseNwsAlerts(NWS_ALERT, 1_500)).toEqual([expect.objectContaining({
      source: "nws",
      title: "Flash Flood Warning issued for the route area",
      severity: "severe",
      urgency: "immediate",
      certainty: "observed",
      sampleDistanceMeters: 1_500,
      sourceUrl: "https://api.weather.gov/alerts/urn:oid:example",
    })]);
  });

  it("drops untrusted links and does not upgrade unknown severity", () => {
    const forged = {
      features: [{
        id: "https://evil.example/alert",
        properties: { headline: "Forged", severity: "catastrophic" },
      }],
    };
    expect(parseNwsAlerts(forged, 0)).toEqual([]);
    const unknown = structuredClone(NWS_ALERT);
    unknown.features[0].properties.severity = "catastrophic";
    expect(parseNwsAlerts(unknown, 0)[0].severity).toBe("unknown");
  });
});

describe("official route alert snapshot", () => {
  it("keeps a successful zero-alert check distinct from an outage", async () => {
    vi.stubEnv("NPS_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }), {
      status: 200,
      headers: { "Content-Type": "application/geo+json" },
    })));
    const checked = await fetchOfficialRouteAlerts({
      routeId: "plan-1",
      points: [{ lat: 38.9, lng: -77.04, distanceMeters: 0 }],
      now: NOW,
    });
    expect(checked.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "nws", status: "checked", pointsChecked: 1 }),
      expect.objectContaining({ source: "nps", status: "not_applicable" }),
    ]));
    expect(checked.alerts).toEqual([]);
    expect(describeOfficialAlertSnapshot(checked, NOW)).toMatch(/No active alerts were returned/i);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const unavailable = await fetchOfficialRouteAlerts({
      routeId: "plan-2",
      points: [{ lat: 38.9, lng: -77.04, distanceMeters: 0 }],
      now: NOW,
    });
    expect(unavailable.sources[0]).toMatchObject({ source: "nws", status: "unavailable" });
    expect(describeOfficialAlertSnapshot(unavailable, NOW)).toMatch(/No official alert source completed/i);
  });

  it("deduplicates the same alert across route samples and validates the cache boundary", async () => {
    vi.stubEnv("NPS_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(NWS_ALERT), {
      status: 200,
      headers: { "Content-Type": "application/geo+json" },
    })));
    const snapshot = await fetchOfficialRouteAlerts({
      routeId: "trail-1",
      points: [
        { lat: 38.9, lng: -77.04, distanceMeters: 5_000 },
        { lat: 38.91, lng: -77.03, distanceMeters: 1_000 },
      ],
      now: NOW,
    });
    expect(snapshot.alerts).toHaveLength(1);
    expect(snapshot.alerts[0].sampleDistanceMeters).toBe(1_000);
    expect(validOfficialAlertSnapshot(snapshot, "trail-1")).toBe(true);
    expect(validOfficialAlertSnapshot({
      ...snapshot,
      alerts: [{ ...snapshot.alerts[0], sourceUrl: "https://evil.example/alert" }],
    }, "trail-1")).toBe(false);
    expect(officialAlertFreshness(snapshot, NOW + OFFICIAL_ALERTS_STALE_MS)).toBe("fresh");
    expect(officialAlertFreshness(snapshot, NOW + OFFICIAL_ALERTS_STALE_MS + 1)).toBe("stale");
  });
});
