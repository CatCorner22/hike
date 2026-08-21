import { fetchWithTimeout, readJsonCapped } from "@/lib/api/outbound";
import { isLongitudeInInterval } from "@/lib/geo/antimeridian";
import type { BboxLngLat } from "@/lib/geo/bbox";
import { heatIndexC, windChillC } from "@/lib/safety/field-ops";
import type { PackWeather } from "@/lib/offline/pack-weather";
import {
  sampleRouteByDistance,
  summarizeHazards,
  type HazardObservation,
  type RouteSamplePoint,
} from "@/lib/offline/route-hazard";

export const HAZARD_BRIEF_SOURCE = "open-meteo" as const;
export const HAZARD_BRIEF_DISCLAIMER =
  "Forecast snapshot at prepare time. Not current weather. Smoke, AQI, and land-manager alerts are not included.";

export const HAZARD_BRIEF_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const MAX_HAZARD_SAMPLES = 5;
export const MAX_HAZARD_HOURS = 8;
export const MAX_HAZARD_OBSERVATIONS = 24;
export const MAX_HAZARD_BRIEF_BYTES = 32 * 1024;
export const HAZARD_SAMPLE_INTERVAL_M = 15_000;
export const HAZARD_FETCH_CLUSTER_M = 20_000;
const HAZARD_TIMEOUT_MS = 6_000;
const HOUR_STEP = 3;

/** Air-temperature and index thresholds. These are snapshot flags, not a forecast service. */
export const HEAT_WATCH_C = 32;
export const HEAT_CRITICAL_C = 38;
export const HEAT_INDEX_WATCH_C = 32;
export const HEAT_INDEX_CRITICAL_C = 41;
export const COLD_WATCH_C = 0;
export const COLD_CRITICAL_C = -15;
export const WIND_CHILL_WATCH_C = -10;
export const WIND_CHILL_CRITICAL_C = -28;
export const GUST_WATCH_KPH = 50;
export const GUST_CRITICAL_KPH = 75;
export const PRECIP_WATCH_MM = 5;
export const PRECIP_CRITICAL_MM = 15;
export const PRECIP_PROB_WATCH = 70;
export const PRECIP_PROB_CRITICAL = 90;

const HAZARD_KINDS = new Set<HazardObservation["kind"]>([
  "weather",
  "heat",
  "cold",
  "wind",
  "lightning",
  "smoke",
  "closure",
  "water",
  "custom",
]);
const HAZARD_SEVERITIES = new Set<HazardObservation["severity"]>(["info", "watch", "critical"]);

export interface HazardHourSlot {
  time: string;
  tempC: number | null;
  rhPct: number | null;
  precipMm: number | null;
  precipProb: number | null;
  windKph: number | null;
  gustKph: number | null;
  weatherCode: number | null;
}

export interface HazardSampleForecast {
  distanceMeters: number;
  lat: number;
  lng: number;
  hours: HazardHourSlot[];
}

export interface RouteHazardBrief {
  routeId: string;
  generatedAt: string;
  expiresAt: string;
  source: typeof HAZARD_BRIEF_SOURCE;
  disclaimer: string;
  samples: HazardSampleForecast[];
  observations: HazardObservation[];
  sunrise?: string;
  sunset?: string;
}

export type HazardBriefFreshness =
  | { kind: "fresh"; ageMs: number; generatedAt: string }
  | { kind: "stale"; ageMs: number; generatedAt: string; reason: string }
  | { kind: "unavailable"; reason: string };

interface OpenMeteoForecast {
  hourly?: {
    time?: unknown;
    temperature_2m?: unknown;
    relative_humidity_2m?: unknown;
    precipitation?: unknown;
    precipitation_probability?: unknown;
    wind_speed_10m?: unknown;
    wind_gusts_10m?: unknown;
    weather_code?: unknown;
  };
  daily?: {
    sunrise?: unknown;
    sunset?: unknown;
  };
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hourlyNumber(series: unknown, index: number): number | null {
  return Array.isArray(series) ? optionalNumber(series[index]) : null;
}

function parseClock(value: string): number {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) return Date.parse(value);
  return Date.parse(`${value}Z`);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validClock(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 40 && Number.isFinite(parseClock(value));
}

function pointInBbox(lng: number, lat: number, bbox: BboxLngLat, epsilon = 0.02): boolean {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(epsilon) || epsilon < 0) {
    return false;
  }
  if (lat < bbox[1] - epsilon || lat > bbox[3] + epsilon) return false;
  return isLongitudeInInterval(lng, { minLng: bbox[0], maxLng: bbox[2] }, epsilon);
}

function isThunderCode(code: number | null): "watch" | "critical" | null {
  if (code == null || !Number.isInteger(code)) return null;
  if (code === 96 || code === 99) return "critical";
  if (code === 95 || code === 97 || code === 98) return "watch";
  return null;
}

export function selectHazardSamplePoints(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): RouteSamplePoint[] {
  const raw = sampleRouteByDistance(geometry, HAZARD_SAMPLE_INTERVAL_M);
  if (raw.length <= MAX_HAZARD_SAMPLES) return raw;
  const picked: RouteSamplePoint[] = [];
  for (let index = 0; index < MAX_HAZARD_SAMPLES; index += 1) {
    const sourceIndex = Math.round((index / (MAX_HAZARD_SAMPLES - 1)) * (raw.length - 1));
    const point = raw[sourceIndex];
    if (!picked.some((existing) => existing.distanceMeters === point.distanceMeters)) {
      picked.push(point);
    }
  }
  return picked;
}

export function clusterHazardSamples(samples: RouteSamplePoint[]): RouteSamplePoint[][] {
  const clusters: RouteSamplePoint[][] = [];
  for (const sample of samples) {
    const existing = clusters.find((cluster) => haversineMeters(cluster[0], sample) <= HAZARD_FETCH_CLUSTER_M);
    if (existing) existing.push(sample);
    else clusters.push([sample]);
  }
  return clusters;
}

export function parseOpenMeteoForecast(data: unknown, now = Date.now()): {
  hours: HazardHourSlot[];
  sunrise?: string;
  sunset?: string;
} | null {
  if (!data || typeof data !== "object") return null;
  const forecast = data as OpenMeteoForecast;
  const times = forecast.hourly?.time;
  if (!Array.isArray(times) || times.length === 0) return null;

  const hours: HazardHourSlot[] = [];
  for (let index = 0; index < times.length && hours.length < MAX_HAZARD_HOURS; index += 1) {
    const time = times[index];
    if (typeof time !== "string" || !validClock(time)) continue;
    const at = parseClock(time);
    if (!Number.isFinite(at) || at < now - 45 * 60_000) continue;
    const slotIndex = times.indexOf(time);
    if (hours.length > 0) {
      const previous = parseClock(hours[hours.length - 1].time);
      if (at - previous < HOUR_STEP * 3_600_000 - 60_000) continue;
    }
    hours.push({
      time,
      tempC: hourlyNumber(forecast.hourly?.temperature_2m, slotIndex),
      rhPct: hourlyNumber(forecast.hourly?.relative_humidity_2m, slotIndex),
      precipMm: hourlyNumber(forecast.hourly?.precipitation, slotIndex),
      precipProb: hourlyNumber(forecast.hourly?.precipitation_probability, slotIndex),
      windKph: hourlyNumber(forecast.hourly?.wind_speed_10m, slotIndex),
      gustKph: hourlyNumber(forecast.hourly?.wind_gusts_10m, slotIndex),
      weatherCode: hourlyNumber(forecast.hourly?.weather_code, slotIndex),
    });
  }
  if (!hours.length) return null;

  const sunrise = Array.isArray(forecast.daily?.sunrise) && typeof forecast.daily.sunrise[0] === "string"
    ? forecast.daily.sunrise[0]
    : undefined;
  const sunset = Array.isArray(forecast.daily?.sunset) && typeof forecast.daily.sunset[0] === "string"
    ? forecast.daily.sunset[0]
    : undefined;
  return {
    hours,
    sunrise: sunrise && validClock(sunrise) ? sunrise : undefined,
    sunset: sunset && validClock(sunset) ? sunset : undefined,
  };
}

function worse(a: HazardObservation["severity"] | null, b: HazardObservation["severity"]): HazardObservation["severity"] {
  const rank = { info: 1, watch: 2, critical: 3 };
  if (!a) return b;
  return rank[b] >= rank[a] ? b : a;
}

export function deriveHazardObservations(samples: HazardSampleForecast[]): HazardObservation[] {
  const best = new Map<HazardObservation["kind"], HazardObservation>();

  const remember = (observation: HazardObservation) => {
    const existing = best.get(observation.kind);
    if (!existing || worse(existing.severity, observation.severity) === observation.severity) {
      best.set(observation.kind, observation);
    }
  };

  for (const sample of samples) {
    for (const hour of sample.hours) {
      const heatIndex = hour.tempC != null && hour.rhPct != null ? heatIndexC(hour.tempC, hour.rhPct) : null;
      const heatValue = heatIndex ?? hour.tempC;
      if (heatValue != null) {
        const critical = heatIndex != null ? heatValue >= HEAT_INDEX_CRITICAL_C : heatValue >= HEAT_CRITICAL_C;
        const watch = heatIndex != null ? heatValue >= HEAT_INDEX_WATCH_C : heatValue >= HEAT_WATCH_C;
        if (critical || watch) {
          remember({
            sampleDistanceMeters: sample.distanceMeters,
            kind: "heat",
            severity: critical ? "critical" : "watch",
            title: critical ? "Hot forecast snapshot" : "Warm forecast snapshot",
            detail: heatIndex != null
              ? `Heat index ${Math.round(heatIndex)}°C at ${hour.time} (${Math.round(sample.distanceMeters / 1000)} km into the route). Air temperature is not WBGT.`
              : `Air temperature ${Math.round(hour.tempC ?? heatValue)}°C at ${hour.time}. Heat index was not available.`,
            observedAt: hour.time,
            source: HAZARD_BRIEF_SOURCE,
          });
        }
      }

      const windChill = hour.tempC != null && hour.windKph != null ? windChillC(hour.tempC, hour.windKph) : null;
      const coldSeverity =
        (windChill != null && windChill <= WIND_CHILL_CRITICAL_C) || (hour.tempC != null && hour.tempC <= COLD_CRITICAL_C)
          ? "critical"
          : (windChill != null && windChill <= WIND_CHILL_WATCH_C) || (hour.tempC != null && hour.tempC <= COLD_WATCH_C)
            ? "watch"
            : null;
      if (coldSeverity) {
        remember({
          sampleDistanceMeters: sample.distanceMeters,
          kind: "cold",
          severity: coldSeverity,
          title: coldSeverity === "critical" ? "Severe cold snapshot" : "Freezing forecast snapshot",
          detail: windChill != null
            ? `Wind chill ${Math.round(windChill)}°C at ${hour.time} (${Math.round(sample.distanceMeters / 1000)} km into the route).`
            : `Air temperature ${Math.round(hour.tempC ?? 0)}°C at ${hour.time}.`,
          observedAt: hour.time,
          source: HAZARD_BRIEF_SOURCE,
        });
      }

      const gust = hour.gustKph ?? hour.windKph;
      if (gust != null && gust >= GUST_WATCH_KPH) {
        remember({
          sampleDistanceMeters: sample.distanceMeters,
          kind: "wind",
          severity: gust >= GUST_CRITICAL_KPH ? "critical" : "watch",
          title: gust >= GUST_CRITICAL_KPH ? "Severe gust snapshot" : "High wind snapshot",
          detail: `Gusts ${Math.round(gust)} km/h at ${hour.time}.`,
          observedAt: hour.time,
          source: HAZARD_BRIEF_SOURCE,
        });
      }

      const precipCritical =
        (hour.precipMm != null && hour.precipMm >= PRECIP_CRITICAL_MM) ||
        (hour.precipProb != null && hour.precipProb >= PRECIP_PROB_CRITICAL);
      const precipWatch =
        (hour.precipMm != null && hour.precipMm >= PRECIP_WATCH_MM) ||
        (hour.precipProb != null && hour.precipProb >= PRECIP_PROB_WATCH);
      if (precipCritical || precipWatch) {
        remember({
          sampleDistanceMeters: sample.distanceMeters,
          kind: "weather",
          severity: precipCritical ? "critical" : "watch",
          title: precipCritical ? "Heavy precip snapshot" : "Wet forecast snapshot",
          detail: `Precip ${hour.precipMm ?? "—"} mm, probability ${hour.precipProb ?? "—"}% at ${hour.time}.`,
          observedAt: hour.time,
          source: HAZARD_BRIEF_SOURCE,
        });
      }

      const thunder = isThunderCode(hour.weatherCode);
      if (thunder) {
        remember({
          sampleDistanceMeters: sample.distanceMeters,
          kind: "lightning",
          severity: thunder,
          title: thunder === "critical" ? "Thunderstorm with hail snapshot" : "Thunderstorm snapshot",
          detail: `WMO weather code ${hour.weatherCode} at ${hour.time}. This is a model code, not a warning product.`,
          observedAt: hour.time,
          source: HAZARD_BRIEF_SOURCE,
        });
      }
    }
  }

  const observations = [...best.values()];
  if (!observations.length && samples.length) {
    observations.push({
      sampleDistanceMeters: samples[0].distanceMeters,
      kind: "weather",
      severity: "info",
      title: "No stored forecast thresholds crossed",
      detail: "The 24-hour snapshot did not meet heat, cold, wind, precip, or thunderstorm thresholds. That is not a guarantee of safe weather.",
      source: HAZARD_BRIEF_SOURCE,
    });
  }
  return observations.slice(0, MAX_HAZARD_OBSERVATIONS);
}

export function buildHazardBrief(input: {
  routeId: string;
  samples: HazardSampleForecast[];
  sunrise?: string;
  sunset?: string;
  now?: number;
}): RouteHazardBrief {
  const now = input.now ?? Date.now();
  const generatedAt = new Date(now).toISOString();
  return {
    routeId: input.routeId,
    generatedAt,
    expiresAt: new Date(now + HAZARD_BRIEF_MAX_AGE_MS).toISOString(),
    source: HAZARD_BRIEF_SOURCE,
    disclaimer: HAZARD_BRIEF_DISCLAIMER,
    samples: input.samples,
    observations: deriveHazardObservations(input.samples),
    sunrise: input.sunrise,
    sunset: input.sunset,
  };
}

function validHour(hour: unknown): hour is HazardHourSlot {
  if (!hour || typeof hour !== "object") return false;
  const candidate = hour as HazardHourSlot;
  if (!validClock(candidate.time)) return false;
  for (const key of ["tempC", "rhPct", "precipMm", "precipProb", "windKph", "gustKph", "weatherCode"] as const) {
    const value = candidate[key];
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) return false;
  }
  if (candidate.rhPct != null && (candidate.rhPct < 0 || candidate.rhPct > 100)) return false;
  if (candidate.precipProb != null && (candidate.precipProb < 0 || candidate.precipProb > 100)) return false;
  if (candidate.weatherCode != null && (!Number.isInteger(candidate.weatherCode) || candidate.weatherCode < 0 || candidate.weatherCode > 99)) {
    return false;
  }
  return true;
}

function validObservation(value: unknown): value is HazardObservation {
  if (!value || typeof value !== "object") return false;
  const observation = value as HazardObservation;
  if (!HAZARD_KINDS.has(observation.kind) || !HAZARD_SEVERITIES.has(observation.severity)) return false;
  if (typeof observation.title !== "string" || observation.title.length === 0 || observation.title.length > 120) return false;
  if (observation.detail !== undefined && (typeof observation.detail !== "string" || observation.detail.length > 400)) return false;
  if (observation.observedAt !== undefined && !validClock(observation.observedAt)) return false;
  if (observation.source !== HAZARD_BRIEF_SOURCE) return false;
  if (!Number.isFinite(observation.sampleDistanceMeters) || observation.sampleDistanceMeters < 0) return false;
  return true;
}

function validSample(value: unknown, bbox?: BboxLngLat): value is HazardSampleForecast {
  if (!value || typeof value !== "object") return false;
  const sample = value as HazardSampleForecast;
  if (!Number.isFinite(sample.distanceMeters) || sample.distanceMeters < 0) return false;
  if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) return false;
  if (sample.lat < -90 || sample.lat > 90 || sample.lng < -180 || sample.lng > 180) return false;
  if (bbox && !pointInBbox(sample.lng, sample.lat, bbox)) return false;
  if (!Array.isArray(sample.hours) || sample.hours.length === 0 || sample.hours.length > MAX_HAZARD_HOURS) return false;
  return sample.hours.every(validHour);
}

export function validHazardBrief(
  value: unknown,
  expectedRouteId?: string,
  bbox?: BboxLngLat,
): value is RouteHazardBrief {
  if (!value || typeof value !== "object") return false;
  const brief = value as RouteHazardBrief;
  if (!validId(brief.routeId)) return false;
  if (expectedRouteId !== undefined && brief.routeId !== expectedRouteId) return false;
  if (brief.source !== HAZARD_BRIEF_SOURCE) return false;
  if (brief.disclaimer !== HAZARD_BRIEF_DISCLAIMER) return false;
  if (!validIso(brief.generatedAt) || !validIso(brief.expiresAt)) return false;
  const generatedAt = Date.parse(brief.generatedAt);
  const expiresAt = Date.parse(brief.expiresAt);
  if (generatedAt < Date.UTC(2020, 0, 1) || generatedAt > Date.now() + 5 * 60_000) return false;
  if (expiresAt <= generatedAt) return false;
  if (brief.sunrise !== undefined && !validClock(brief.sunrise)) return false;
  if (brief.sunset !== undefined && !validClock(brief.sunset)) return false;
  if (!Array.isArray(brief.samples) || brief.samples.length === 0 || brief.samples.length > MAX_HAZARD_SAMPLES) return false;
  if (!brief.samples.every((sample) => validSample(sample, bbox))) return false;
  if (!Array.isArray(brief.observations) || brief.observations.length > MAX_HAZARD_OBSERVATIONS) return false;
  if (!brief.observations.every(validObservation)) return false;
  try {
    if (new TextEncoder().encode(JSON.stringify(brief)).byteLength > MAX_HAZARD_BRIEF_BYTES) return false;
  } catch {
    return false;
  }
  return true;
}

export function hazardBriefFreshness(
  brief: RouteHazardBrief | null | undefined,
  now = Date.now(),
): HazardBriefFreshness {
  if (!brief || !Number.isFinite(now)) {
    return { kind: "unavailable", reason: "Forecast snapshot is unavailable." };
  }
  const generatedAt = Date.parse(brief.generatedAt);
  if (!Number.isFinite(generatedAt)) {
    return { kind: "unavailable", reason: "Forecast snapshot has no usable time." };
  }
  if (generatedAt > now) {
    return {
      kind: "unavailable",
      reason: "Device clock is behind the snapshot time. Do not treat this as current weather.",
    };
  }
  const ageMs = Math.max(0, now - generatedAt);
  if (now - generatedAt > HAZARD_BRIEF_MAX_AGE_MS) {
    return {
      kind: "stale",
      ageMs,
      generatedAt: brief.generatedAt,
      reason: "Forecast snapshot is older than 6 hours.",
    };
  }
  return { kind: "fresh", ageMs, generatedAt: brief.generatedAt };
}

export function describeHazardBrief(brief: RouteHazardBrief, now = Date.now()): string {
  const summary = summarizeHazards(brief.observations);
  const freshness = hazardBriefFreshness(brief, now);
  const age = freshness.kind === "unavailable"
    ? "time unknown"
    : `${Math.max(1, Math.round(freshness.ageMs / 3_600_000))}h old`;
  const highest = summary.highest === "none" ? "no threshold crossings" : `${summary.highest} highest`;
  return `${brief.samples.length} forecast sample${brief.samples.length === 1 ? "" : "s"}, ${highest}, ${age}. ${HAZARD_BRIEF_DISCLAIMER}`;
}

export function packWeatherFromHazardBrief(brief: RouteHazardBrief): PackWeather | null {
  const sample = brief.samples[0];
  const hour = sample?.hours[0];
  if (!sample || !hour) return null;
  return {
    tempC: hour.tempC ?? undefined,
    windKph: hour.windKph ?? undefined,
    rhPct: hour.rhPct ?? undefined,
    source: "open-meteo",
    fetchedAt: brief.generatedAt,
    lat: sample.lat,
    lng: sample.lng,
    cachedAt: brief.generatedAt,
    observedAt: hour.time,
    note: "Snapshot at pack time — not a live forecast.",
  };
}

async function fetchForecast(lat: number, lng: number): Promise<unknown | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set(
      "hourly",
      "temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,weather_code",
    );
    url.searchParams.set("daily", "sunrise,sunset");
    url.searchParams.set("forecast_days", "2");
    url.searchParams.set("wind_speed_unit", "kmh");
    url.searchParams.set("timezone", "GMT");
    const response = await fetchWithTimeout(url.toString(), { cache: "no-store" }, HAZARD_TIMEOUT_MS);
    if (!response.ok) return null;
    return await readJsonCapped<OpenMeteoForecast>(response);
  } catch {
    return null;
  }
}

export async function fetchRouteHazardBrief(input: {
  routeId: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  now?: number;
}): Promise<RouteHazardBrief | null> {
  const now = input.now ?? Date.now();
  const samples = selectHazardSamplePoints(input.geometry);
  if (!samples.length) return null;
  const clusters = clusterHazardSamples(samples);
  const parsedClusters = await Promise.all(
    clusters.map(async (cluster) => {
      const data = await fetchForecast(cluster[0].lat, cluster[0].lng);
      const parsed = parseOpenMeteoForecast(data, now);
      return parsed ? { cluster, parsed } : null;
    }),
  );

  const forecastSamples: HazardSampleForecast[] = [];
  let sunrise: string | undefined;
  let sunset: string | undefined;
  for (const result of parsedClusters) {
    if (!result) continue;
    sunrise ??= result.parsed.sunrise;
    sunset ??= result.parsed.sunset;
    for (const sample of result.cluster) {
      forecastSamples.push({
        distanceMeters: sample.distanceMeters,
        lat: sample.lat,
        lng: sample.lng,
        hours: result.parsed.hours,
      });
    }
  }
  if (!forecastSamples.length) return null;
  const brief = buildHazardBrief({
    routeId: input.routeId,
    samples: forecastSamples,
    sunrise,
    sunset,
    now,
  });
  return validHazardBrief(brief, input.routeId) ? brief : null;
}
