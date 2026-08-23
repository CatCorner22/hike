import { describe, expect, it } from "vitest";
import { parseScannedPosition, parseZuluStamp } from "./decode-handoff";
import { buildSarHandoff } from "./handoff";
import { formatZulu } from "@/lib/safety/landnav";

describe("parseScannedPosition", () => {
  /** The loop this closes: what one phone shows, another must read back. */
  it("round-trips this app's own SAR handoff", () => {
    const payload = buildSarHandoff({
      trailName: "Cathedral Lakes",
      lat: 37.7345,
      lng: -119.6032,
      recordedAt: Date.parse("2026-08-23T13:00:00Z"),
      positionSource: "gps",
      returnAtIso: "2026-08-23T22:00:00.000Z",
      profile: { name: "Alex", iceName: "Sam", icePhone: "5550100", medical: "", partySize: 2 },
    });

    const parsed = parseScannedPosition(payload)!;
    expect(parsed.kind).toBe("sar-handoff");
    expect(parsed.lat).toBeCloseTo(37.7345, 4);
    expect(parsed.lng).toBeCloseTo(-119.6032, 4);
    expect(parsed.label).toBe("Cathedral Lakes");
    expect(parsed.provenance).toMatch(/live GPS/);
  });

  /**
   * Provenance must survive the hop. A dead-reckoned position relayed to
   * another phone that then calls it a GPS fix is the exact laundering this
   * app's payload format exists to prevent.
   */
  it("carries dead-reckon provenance across the scan", () => {
    const payload = buildSarHandoff({
      lat: 37.7345,
      lng: -119.6032,
      recordedAt: Date.parse("2026-08-23T13:00:00Z"),
      positionSource: "deadReckon",
    });
    expect(parseScannedPosition(payload)!.provenance).toMatch(/DEAD RECKON/);
  });

  /**
   * A handoff that declares no fix must not become a plotted point. Inventing
   * a position from a document that says it has none is the dishonesty the
   * whole app is built against.
   */
  it("refuses a handoff whose position is UNKNOWN", () => {
    const payload = buildSarHandoff({ trailName: "Somewhere", lat: null, lng: null });
    expect(payload).toMatch(/Position UNKNOWN/);
    expect(parseScannedPosition(payload)).toBeNull();
  });

  it("reads geo: URIs", () => {
    const parsed = parseScannedPosition("geo:37.73450,-119.60320")!;
    expect(parsed.kind).toBe("geo-uri");
    expect(parsed.lat).toBeCloseTo(37.7345, 4);
    expect(parsed.lng).toBeCloseTo(-119.6032, 4);
    expect(parseScannedPosition("geo:37.7345,-119.6032;u=35")!.lat).toBeCloseTo(37.7345, 4);
  });

  it("reads a bare decimal pair", () => {
    const parsed = parseScannedPosition("37.7345, -119.6032")!;
    expect(parsed.kind).toBe("coordinates");
    expect(parsed.lat).toBeCloseTo(37.7345, 4);
  });

  /**
   * A coordinate-looking substring inside an unrelated document (a URL, a
   * product label) must not be mistaken for someone's position.
   */
  it("does not mine coordinates out of arbitrary long text", () => {
    const url = `https://example.com/tracking?a=37.7345,-119.6032&${"x".repeat(200)}`;
    expect(parseScannedPosition(url)).toBeNull();
    expect(parseScannedPosition("https://example.com")).toBeNull();
    expect(parseScannedPosition("WIFI:S:trailhead;T:WPA;P:hunter2;;")).toBeNull();
  });

  it("rejects out-of-range and malformed values", () => {
    expect(parseScannedPosition("geo:99.5,-119.6")).toBeNull();
    expect(parseScannedPosition("37.7345, -200.1")).toBeNull();
    expect(parseScannedPosition("")).toBeNull();
    expect(parseScannedPosition("   ")).toBeNull();
    expect(parseScannedPosition("x".repeat(5000))).toBeNull();
    expect(parseScannedPosition(null as unknown as string)).toBeNull();
    expect(parseScannedPosition(123 as unknown as string)).toBeNull();
  });

  /**
   * The scan time is NOT the fix time. A relayed position can be an hour old,
   * and reading the age off the payload is what lets the party picture say so
   * instead of presenting every scanned fix as current.
   */
  it("recovers the fix time the payload states, not the moment of the scan", () => {
    const takenAt = Date.parse("2026-08-23T13:00:00Z");
    const payload = buildSarHandoff({
      lat: 37.7345,
      lng: -119.6032,
      recordedAt: takenAt,
      positionSource: "gps",
    });
    expect(parseScannedPosition(payload)!.fixAtMs).toBe(takenAt);
  });

  it("round-trips every Zulu stamp the app can emit, and rejects impossible ones", () => {
    for (const iso of [
      "2026-01-01T00:00:00Z",
      "2026-08-23T13:00:00Z",
      "2026-12-31T23:59:00Z",
      "2028-02-29T06:07:00Z",
    ]) {
      const ms = Date.parse(iso);
      expect(parseZuluStamp(`Fix at ${formatZulu(new Date(ms))} · live GPS`)).toBe(ms);
    }
    // Rolled-over dates must be refused, not silently accepted as March.
    expect(parseZuluStamp("Fix at 1300Z 31 FEB 2026")).toBeNull();
    expect(parseZuluStamp("Fix at 2500Z 23 AUG 2026")).toBeNull();
    expect(parseZuluStamp("Fix at 1360Z 23 AUG 2026")).toBeNull();
    expect(parseZuluStamp("Fix at 1300Z 23 XXX 2026")).toBeNull();
    expect(parseZuluStamp("time UNKNOWN")).toBeNull();
  });

  it("leaves the fix time unknown when the handoff could not state one", () => {
    const payload = buildSarHandoff({ lat: 37.7345, lng: -119.6032, recordedAt: Number.NaN });
    expect(payload).toMatch(/time UNKNOWN/);
    expect(parseScannedPosition(payload)!.fixAtMs).toBeNull();
    expect(parseScannedPosition("geo:37.7345,-119.6032")!.fixAtMs).toBeNull();
  });

  it("keeps the trail name out of the label when the handoff has none", () => {
    const payload = buildSarHandoff({ lat: 37.7345, lng: -119.6032, positionSource: "gps" });
    const parsed = parseScannedPosition(payload)!;
    expect(parsed.kind).toBe("sar-handoff");
    expect(parsed.label).toBe("");
  });
});
