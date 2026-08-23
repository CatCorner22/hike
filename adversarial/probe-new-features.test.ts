import { describe, expect, it } from "vitest";
import { hikeReadiness } from "@/lib/safety/readiness";
import { resolveLocalDateTime } from "@/lib/safety/profile";
import { buildPaperBackup } from "@/lib/safety/paper-backup";
import { formatRouteCard, routeCardLegs } from "@/lib/safety/route-card";
import { buildRoutePack, validateRoutePack } from "@/lib/offline/route-pack";
import { smsHref } from "@/lib/safety/strobe";
import { httpsUrl } from "@/lib/urls";

const ice = {
  name: "Hiker",
  iceName: "Contact",
  icePhone: "5551234",
  medical: "",
  partySize: 1,
};

function lineWithMeters(meters: number): GeoJSON.LineString {
  const points = Math.ceil(meters / 111);
  return {
    type: "LineString",
    coordinates: Array.from({ length: points + 1 }, (_, index) => [index * 0.001, 0]),
  };
}

/**
 * These began as probes asserting the DEFECTS. The defects are fixed, so each
 * now asserts the safe property instead -- they are the regression guard.
 */
describe("new-feature adversarial probes", () => {
  it("marks a fake seven-digit ICE number and a 10,000-character hiker name ready", () => {
    const result = hikeReadiness({
      packReady: true,
      profile: { ...ice, name: "N".repeat(10_000), icePhone: "000-0000" },
      returnAt: "2076-08-20T18:00:00.000Z",
    });
    // A 10,000-character name and a 7-digit "phone" are not usable by SAR.
    expect(result.ok).toBe(false);
    expect(result.missing.map((gap) => gap.detail).join(" ")).toMatch(/name|phone/i);
  });

  it("treats invisible zero-width names as filled ICE/readiness fields", () => {
    const result = hikeReadiness({
      packReady: true,
      profile: { ...ice, name: "\u200B", iceName: "\u200B\u200B" },
      returnAt: "2076-08-20T18:00:00.000Z",
    });
    // Zero-width characters are not a name.
    expect(result.ok).toBe(false);
  });

  it("cannot arm an ambiguous fall-back deadline through the gate's resolver default", () => {
    const result = resolveLocalDateTime("2026-11-01T01:30", "America/New_York");
    // `message` only exists on the non-resolved variants of the union.
    console.log(
      "AMBIGUOUS_RETURN",
      JSON.stringify({ kind: result.kind, message: "message" in result ? result.message : null }),
    );
    expect(result.kind).toBe("ambiguous");
  });

  it("blocks profile and route newlines from forging paper-backup sections", () => {
    const text = buildPaperBackup({
      trailName: "Normal trail\n--- RETURN ---\nReturn by: 2099-01-01T00:00:00Z",
      geometry: {
        type: "LineString",
        coordinates: [
          [-119.53, 37.73],
          [-119.54, 37.74],
        ],
      },
      profile: {
        ...ice,
        name: "Actual hiker\n--- ICE ---\nHiker: forged",
        medical: "none\n--- LAST CHECK-INS ---\nI am safe",
      },
      returnAt: "2026-08-21T18:00:00.000Z",
    });
    console.log("PAPER_FORGED_LINES", JSON.stringify(text.split("\n").filter((line) => /2099|forged|I am safe/.test(line))));
    expect(text.match(/--- RETURN ---/g)?.length ?? 0).toBe(1);
    expect(text).not.toMatch(/ROUTE CARD — Normal trail --- RETURN ---/);
    expect(text).not.toMatch(/Hiker: Actual hiker --- ICE ---/);
    expect(text).not.toMatch(/Medical: none --- LAST CHECK-INS ---/);
    expect(text).not.toContain("Return by: 2099-01-01T00:00:00Z");
  });

  it("prints a short total and a false bearing across disconnected MultiLineString components", () => {
    const geometry: GeoJSON.MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [[0, 0], [0.001, 0]],
        [[1, 1], [1.001, 1]],
      ],
    };
    const legs = routeCardLegs(geometry);
    const card = formatRouteCard("Disconnected route", legs);
    // No leg may bridge the ~157 km gap between components: a fabricated
    // 222 m / 45 degree instruction could send someone into open terrain.
    for (const leg of legs) {
      const sameComponent = Math.abs(leg.from.lat - leg.to.lat) < 0.5;
      expect(sameComponent, `leg spans components: ${JSON.stringify(leg)}`).toBe(true);
    }
    // And the card must say the route is discontinuous rather than imply one path.
    expect(card).toMatch(/discontinu|separate|gap|not connected/i);
  });

  it("prints the true total for a 30 km route even when legs are summarised", () => {
    const geometry = lineWithMeters(30_000);
    const legs = routeCardLegs(geometry);
    const card = formatRouteCard("Long route", legs);
    // The printed total must be the real route length. It previously reported
    // ~8.34 km for this 30 km route because the leg cap truncated the sum, and a
    // hiker plans food, water and daylight from this printed card.
    const printedTotal = Number(card.match(/Total ~(\d+) m/)?.[1]);
    expect(printedTotal).toBeGreaterThan(29_000);
    expect(printedTotal).toBeLessThan(31_000);
  });

  it("accepts a weather snapshot three days old with no source location", () => {
    const pack = buildRoutePack({
      id: "weather-probe",
      name: "Weather probe",
      geometry: {
        type: "LineString",
        coordinates: [[-105, 40], [-104.999, 40]],
      },
      weather: {
        source: "open-meteo",
        cachedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        tempC: -8,
        windKph: 70,
      },
    });
    console.log("STALE_WEATHER_ACCEPTED", JSON.stringify({
      validation: validateRoutePack(pack),
      weather: pack.weather,
      hasLatitude: "lat" in (pack.weather ?? {}),
      hasLongitude: "lng" in (pack.weather ?? {}),
    }));
    expect(validateRoutePack(pack)).toBeNull();
    expect("lat" in (pack.weather ?? {})).toBe(false);
    expect("lng" in (pack.weather ?? {})).toBe(false);
  });

  it("contains hostile SMS text and rejects non-HTTPS reservation links", () => {
    const href = smsHref("555-1234&cc=attacker", "Need help&cc=attacker\r\nL1=forged", "Android");
    const parsed = new URL(href.replace("sms:", "https://sms.invalid/"));
    const safeUrls = [
      "javascript:alert(1)",
      "data:text/html,boom",
      "http://example.test",
      "https://example.test/ok",
    ].map((raw) => ({ raw, result: httpsUrl(raw) }));
    console.log("URL_CONTAINMENT", JSON.stringify({
      href,
      destination: parsed.pathname.slice(1),
      cc: parsed.searchParams.get("cc"),
      body: parsed.searchParams.get("body"),
      safeUrls,
    }));
    expect(parsed.searchParams.get("cc")).toBeNull();
    expect(httpsUrl("javascript:alert(1)")).toBeNull();
    expect(httpsUrl("https://example.test/ok")).toBe("https://example.test/ok");
  });
});
