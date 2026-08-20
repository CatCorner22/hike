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

/** Heat/cold advice from a pack older than this is worse than no number. */
export const PACK_WEATHER_FRESH_MS = 18 * 60 * 60 * 1000;

export function isPackWeatherFresh(weather: PackWeather | null | undefined, now = Date.now()): boolean {
  if (!weather) return false;
  const cachedAt = Date.parse(weather.cachedAt);
  if (!Number.isFinite(cachedAt) || cachedAt > now) return false;
  return now - cachedAt <= PACK_WEATHER_FRESH_MS;
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
