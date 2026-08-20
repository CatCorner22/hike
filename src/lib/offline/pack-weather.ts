export interface PackWeather {
  tempC?: number;
  windKph?: number;
  rhPct?: number;
  source: "open-meteo" | "manual";
  cachedAt: string;
  note?: string;
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
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,wind_speed_10m");
    url.searchParams.set("wind_speed_unit", "kmh");
    url.searchParams.set("timezone", "auto");
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
      };
    };
    const c = data.current;
    if (!c) return null;
    return {
      tempC: c.temperature_2m,
      windKph: c.wind_speed_10m,
      rhPct: c.relative_humidity_2m,
      source: "open-meteo",
      cachedAt: new Date().toISOString(),
      note: "Snapshot at pack time — not a live forecast.",
    };
  } catch {
    return null;
  }
}
