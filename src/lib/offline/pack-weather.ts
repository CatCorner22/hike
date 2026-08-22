import { fetchWithTimeout, readJsonCapped } from "@/lib/api/outbound";

/** Weather is an enhancement, never a blocker for preparing a route. */
const WEATHER_TIMEOUT_MS = 6_000;
export interface PackWeather {
  tempC?: number;
  windKph?: number;
  rhPct?: number;
  source: "open-meteo" | "manual";
  /** Time this snapshot was fetched onto the device. */
  fetchedAt?: string;
  /** Coordinates used for the weather request; absent only on legacy/manual entries. */
  lat?: number;
  lng?: number;
  cachedAt: string;
  /** Provider's observation timestamp when available. */
  observedAt?: string;
  note?: string;
}

export interface DecisionGradePackWeather {
  tempC?: number;
  windKph?: number;
  rhPct?: number;
  source: PackWeather["source"];
  fetchedAt: string;
}

/** A pack-time weather snapshot is not decision-grade after six hours. */
export const PACK_WEATHER_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type PackWeatherFreshness =
  | { kind: "fresh"; ageMs: number; fetchedAt: string; lat: number; lng: number }
  | { kind: "stale"; ageMs: number; fetchedAt: string; lat: number; lng: number; reason: string }
  | { kind: "unavailable"; reason: string };

/**
 * Legacy snapshots without a source location are deliberately unavailable:
 * presenting them as current weather could make a hiker plan for another
 * trail's conditions. Callers can still show the values as historical notes.
 */
export function packWeatherFreshness(
  weather: PackWeather | null | undefined,
  now = Date.now(),
): PackWeatherFreshness {
  if (!weather || !Number.isFinite(now)) {
    return { kind: "unavailable", reason: "Weather snapshot time is unavailable." };
  }
  const fetchedAt = weather.fetchedAt ?? weather.cachedAt;
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) {
    return { kind: "unavailable", reason: "Weather snapshot has no usable fetched-at time." };
  }
  const lat = weather.lat;
  const lng = weather.lng;
  if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { kind: "unavailable", reason: "Weather snapshot has no usable source location." };
  }
  if (fetchedMs > now) {
    return {
      kind: "unavailable",
      reason: "Device clock is behind the snapshot time. Do not treat this as current weather.",
    };
  }
  const ageMs = Math.max(0, now - fetchedMs);
  if (now - fetchedMs > PACK_WEATHER_MAX_AGE_MS) {
    return {
      kind: "stale",
      ageMs,
      fetchedAt,
      lat,
      lng,
      reason: "Weather snapshot is older than 6 hours.",
    };
  }
  return { kind: "fresh", ageMs, fetchedAt, lat, lng };
}

export function isPackWeatherFresh(weather: PackWeather | null | undefined, now = Date.now()): boolean {
  return packWeatherFreshness(weather, now).kind === "fresh";
}

function finiteInRange(value: number | undefined, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

/**
 * Values that may seed deterministic field calculators.
 *
 * This is deliberately the only decision-grade boundary for cached weather.
 * Missing, future-dated, locationless, or older-than-six-hour snapshots return
 * null. The UI may still display their provenance as history, but must not copy
 * their numbers into heat, cold, survival, or field-observation calculations.
 */
export function decisionGradePackWeather(
  weather: PackWeather | null | undefined,
  now = Date.now(),
): DecisionGradePackWeather | null {
  const freshness = packWeatherFreshness(weather, now);
  if (!weather || freshness.kind !== "fresh") return null;
  const values: DecisionGradePackWeather = {
    source: weather.source,
    fetchedAt: freshness.fetchedAt,
    tempC: finiteInRange(weather.tempC, -90, 60),
    windKph: finiteInRange(weather.windKph, 0, 300),
    rhPct: finiteInRange(weather.rhPct, 0, 100),
  };
  return values.tempC == null && values.windKph == null && values.rhPct == null ? null : values;
}

/** Human-readable pack weather provenance for the safety panel. */
export function formatPackWeatherNote(
  weather: PackWeather | null | undefined,
  now = Date.now(),
): string | null {
  if (!weather) return null;
  const freshness = packWeatherFreshness(weather, now);
  const displayTemp = finiteInRange(weather.tempC, -90, 60);
  const temp = displayTemp != null ? ` · ${displayTemp}°C` : "";
  if (freshness.kind === "fresh") {
    const hours = Math.max(1, Math.round(freshness.ageMs / 3_600_000));
    const where =
      Number.isFinite(freshness.lat) && Number.isFinite(freshness.lng)
        ? ` near ${freshness.lat.toFixed(2)}°, ${freshness.lng.toFixed(2)}°`
        : "";
    return `Pack-time snapshot from ${hours}h ago${where} (${weather.source}${temp}). Not a live forecast.`;
  }
  if (freshness.kind === "stale") {
    const hours = Math.max(1, Math.round(freshness.ageMs / 3_600_000));
    return `Pack weather is ${hours}h old — do not use for heat or cold decisions. Enter current conditions below.`;
  }
  return `${freshness.reason} Pack values are historical only; enter current field observations below.`;
}

export async function fetchPackWeather(
  lat: number,
  lng: number,
): Promise<PackWeather | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,wind_speed_10m");
    url.searchParams.set("wind_speed_unit", "kmh");
    url.searchParams.set("timezone", "auto");
    // Bounded like the other third-party calls: a bare fetch had no timeout and
    // no size cap, so a stalled weather service could hold up offline
    // preparation at the trailhead. Weather is an enhancement -- fail fast.
    const res = await fetchWithTimeout(url.toString(), { cache: "no-store" }, WEATHER_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await readJsonCapped<{
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
        time?: string;
      };
    }>(res);
    const c = data.current;
    if (!c) return null;
    const fetchedAt = new Date().toISOString();
    return {
      tempC: c.temperature_2m,
      windKph: c.wind_speed_10m,
      rhPct: c.relative_humidity_2m,
      source: "open-meteo",
      fetchedAt,
      lat,
      lng,
      cachedAt: fetchedAt,
      observedAt: typeof c.time === "string" && Number.isFinite(Date.parse(c.time)) ? c.time : undefined,
      note: "Snapshot at pack time — not a live forecast.",
    };
  } catch {
    return null;
  }
}
