import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POWER_RESERVE_SUGGEST_AT_PERCENT,
  geoWatchTuning,
  mapRedrawIntervalMs,
  powerReserveBanner,
  powerReserveSuggestion,
  powerReserveTradeoffs,
  shouldHoldScreenAwake,
} from "./power-reserve";

/**
 * A dead phone is the failure that ends a hike badly: no map, no grid reference
 * to read to a rescuer, no SOS text, no overdue alarm. The app warned about the
 * battery and offered nothing to do about it.
 */
describe("power reserve actually asks the platform for less", () => {
  it("stops holding the satellite receiver open", () => {
    expect(geoWatchTuning("reserve").enableHighAccuracy).toBe(false);
    expect(geoWatchTuning("full").enableHighAccuracy).toBe(true);
  });

  it("lets the platform answer from a cached fix instead of taking a new one", () => {
    expect(geoWatchTuning("reserve").maximumAge).toBeGreaterThan(
      geoWatchTuning("full").maximumAge * 5,
    );
  });

  it("waits longer before giving up, because asking again costs more than waiting", () => {
    expect(geoWatchTuning("reserve").timeout).toBeGreaterThan(geoWatchTuning("full").timeout);
  });

  it("lets the screen sleep, which is the single biggest saving", () => {
    expect(shouldHoldScreenAwake("reserve")).toBe(false);
    expect(shouldHoldScreenAwake("full")).toBe(true);
  });

  it("stops redrawing the map between fixes", () => {
    expect(mapRedrawIntervalMs("reserve")).toBeNull();
    expect(mapRedrawIntervalMs("full")).toBeGreaterThan(0);
  });
});

/**
 * The offer is an offer. An app that quietly degraded its own position to save
 * battery would be doing the one thing the rest of this codebase refuses to do.
 */
describe("reserve is offered, never taken", () => {
  const low = { mode: "full" as const, batteryPercent: 12 };

  it("offers below the threshold and says what the trade is", () => {
    const suggestion = powerReserveSuggestion(low);
    expect(suggestion.suggest).toBe(true);
    expect(suggestion.message).toMatch(/Battery 12%/);
    expect(suggestion.message).toMatch(/trades position accuracy/);
    expect(suggestion.message).toMatch(/breadcrumb, the alerts and the return-time alarm/);
  });

  it("says nothing above the threshold", () => {
    expect(
      powerReserveSuggestion({ ...low, batteryPercent: POWER_RESERVE_SUGGEST_AT_PERCENT + 1 })
        .suggest,
    ).toBe(false);
  });

  it("says nothing to a phone on a power bank", () => {
    expect(powerReserveSuggestion({ ...low, charging: true }).suggest).toBe(false);
  });

  it("says nothing when reserve is already on", () => {
    expect(powerReserveSuggestion({ ...low, mode: "reserve" }).suggest).toBe(false);
  });

  it("says nothing when the battery level is unknown or nonsense", () => {
    for (const batteryPercent of [null, undefined, Number.NaN, -1, 101]) {
      expect(powerReserveSuggestion({ ...low, batteryPercent }).suggest).toBe(false);
    }
  });

  it("names the walking still ahead when the app has an estimate", () => {
    expect(powerReserveSuggestion({ ...low, hoursRemaining: 3.4 }).message).toMatch(
      /about 3 h of walking left/,
    );
    expect(powerReserveSuggestion({ ...low, hoursRemaining: 1 }).message).toMatch(
      /about an hour of walking left/,
    );
    // Six minutes is not "about an hour". Rounding a short walk up to one is
    // exactly the false comfort the rest of this app spends its time removing.
    expect(powerReserveSuggestion({ ...low, hoursRemaining: 0.1 }).message).toMatch(
      /under half an hour of walking left/,
    );
    // No estimate, no invented one.
    expect(powerReserveSuggestion({ ...low, hoursRemaining: null }).message).not.toMatch(
      /walking left/,
    );
  });
});

/**
 * A degraded position must never look like a good one.
 */
describe("the screen keeps saying what reserve costs", () => {
  it("stands for as long as reserve is on, not once at the tap", () => {
    expect(powerReserveBanner("reserve")).toMatch(/coarser and updates less often/);
    expect(powerReserveBanner("full")).toBeNull();
  });

  it("lists the trade before the hiker takes it, including what keeps working", () => {
    const lines = powerReserveTradeoffs().join(" ");
    expect(lines).toMatch(/tens of metres instead of a few/);
    expect(lines).toMatch(/screen sleeps/);
    expect(lines).toMatch(/breadcrumb, off-route alerts, the check-in timer, and the return-time alarm/);
  });

  it("is wired to the watch and the wake lock, not just to a label", () => {
    const gps = readFileSync(resolve(process.cwd(), "src/hooks/use-gps.ts"), "utf8");
    expect(gps).toMatch(/\.\.\.geoWatchTuning\(mode\)/);
    // A mode change has to re-subscribe, or the platform never hears about it.
    expect(gps).toMatch(/\}, \[mode\]\);/);

    const page = readFileSync(resolve(process.cwd(), "src/app/navigate/page.tsx"), "utf8");
    expect(page).toMatch(/useGps\(powerMode\)/);
    expect(page).toMatch(/shouldHoldScreenAwake\(powerMode\)/);
    expect(page).toMatch(/key: "power-reserve"/);
  });
});
