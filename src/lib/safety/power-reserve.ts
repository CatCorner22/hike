/**
 * Trading position quality for hours of battery, deliberately and out loud.
 *
 * A phone that dies is the failure that ends a hike badly: no map, no grid
 * reference to read to a rescuer, no SOS text, no overdue alarm. The app warned
 * about the battery and did nothing about it — a hiker watching 12% tick down
 * had no lever to pull except closing the app, which stops the breadcrumb and
 * the off-route alerting too.
 *
 * Power reserve is that lever. It is never automatic: an app that quietly made
 * its own position worse would be doing the one thing the rest of this codebase
 * refuses to do. The hiker turns it on, the screen says exactly what changed,
 * and everything safety-critical keeps running on coarser fixes rather than
 * stopping.
 */

export type PowerMode = "full" | "reserve";

export interface GeoWatchTuning {
  enableHighAccuracy: boolean;
  /** How old a cached fix may be before the platform must go and get a new one. */
  maximumAge: number;
  timeout: number;
}

/**
 * Full accuracy keeps the GNSS receiver working continuously, which is the most
 * expensive thing an app can ask a phone to do.
 *
 * Reserve lets the platform answer from a cached fix up to a minute old and from
 * the cheap position sources — cell towers and wifi — instead of holding the
 * satellite receiver open. The timeout grows with it, because a coarse fix
 * without a clear sky can genuinely take longer to arrive and giving up early
 * would only make the app ask again.
 */
export function geoWatchTuning(mode: PowerMode): GeoWatchTuning {
  return mode === "reserve"
    ? { enableHighAccuracy: false, maximumAge: 60_000, timeout: 45_000 }
    : { enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 };
}

/** Whether the screen should be held awake. In reserve it is the single biggest saving. */
export function shouldHoldScreenAwake(mode: PowerMode): boolean {
  return mode === "full";
}

/**
 * How often the moving map may redraw.
 *
 * Redrawing the canvas on a timer keeps the GPU and the display busy between
 * fixes for no new information. In reserve the map is drawn when a fix arrives
 * and not otherwise.
 */
export function mapRedrawIntervalMs(mode: PowerMode): number | null {
  return mode === "reserve" ? null : 1_000;
}

/**
 * What the hiker is giving up, in their words, on the screen where they turn it
 * on. Every line is something they would otherwise discover in the field.
 */
export function powerReserveTradeoffs(): string[] {
  return [
    "Your position gets coarser — tens of metres instead of a few — because the phone stops holding the satellite receiver open.",
    "Fixes arrive less often, so the distance remaining and the off-route warning update more slowly.",
    "The screen sleeps normally instead of being held awake. Wake it when you need the map.",
    "Everything else keeps running: the breadcrumb, off-route alerts, the check-in timer, and the return-time alarm.",
  ];
}

/** Below this the app offers reserve. Above it, it says nothing. */
export const POWER_RESERVE_SUGGEST_AT_PERCENT = 25;

export interface PowerSuggestion {
  suggest: boolean;
  /** Null when there is nothing to say. */
  message: string | null;
}

/**
 * Whether to offer power reserve, given what is known about the battery.
 *
 * Offered, never taken. And not while charging: a phone on a power bank in a
 * pack does not need its position degraded, and suggesting it there teaches the
 * hiker to dismiss the prompt.
 */
export function powerReserveSuggestion(input: {
  mode: PowerMode;
  batteryPercent: number | null | undefined;
  charging?: boolean | null;
  /** Hours of walking still ahead, when the app has an estimate. */
  hoursRemaining?: number | null;
}): PowerSuggestion {
  if (input.mode === "reserve") return { suggest: false, message: null };
  if (input.charging) return { suggest: false, message: null };
  const percent = input.batteryPercent;
  if (percent == null || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { suggest: false, message: null };
  }
  if (percent > POWER_RESERVE_SUGGEST_AT_PERCENT) return { suggest: false, message: null };

  const hours = input.hoursRemaining;
  const ahead =
    hours != null && Number.isFinite(hours) && hours > 0
      ? ` with about ${hours < 1 ? "an hour" : `${Math.round(hours)} h`} of walking left`
      : "";
  return {
    suggest: true,
    message:
      `Battery ${Math.round(percent)}%${ahead}. Power reserve trades position accuracy for hours ` +
      "of run time and keeps the breadcrumb, the alerts and the return-time alarm working.",
  };
}

/**
 * The line the navigate screen shows while reserve is on.
 *
 * A degraded position must never look like a good one, so this is stated
 * continuously rather than once at the moment of the tap.
 */
export function powerReserveBanner(mode: PowerMode): string | null {
  return mode === "reserve"
    ? "Power reserve on — position is coarser and updates less often. Tap to return to full accuracy."
    : null;
}
