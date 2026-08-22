import { fetchWithTimeout, readJsonCapped } from "@/lib/api/outbound";
import { isUsCoverageCoordinate } from "@/lib/camping/us-coverage";
import { getVerifiedParkAlertSnapshot } from "@/lib/nps/client";

export const OFFICIAL_ALERTS_VERSION = 1;
export const OFFICIAL_ALERTS_STALE_MS = 30 * 60 * 1000;
export const MAX_OFFICIAL_ALERTS = 40;
export const MAX_OFFICIAL_ALERTS_BYTES = 96 * 1024;
const NWS_TIMEOUT_MS = 6_000;

export type OfficialAlertSource = "nws" | "nps";
export type OfficialSourceStatus = "checked" | "partial" | "unavailable" | "not_configured" | "not_applicable";

export interface OfficialAlertSourceState {
  source: OfficialAlertSource;
  status: OfficialSourceStatus;
  checkedAt: string;
  detail: string;
  pointsChecked?: number;
  parkCode?: string;
  parkName?: string;
}

export interface OfficialRouteAlert {
  id: string;
  source: OfficialAlertSource;
  title: string;
  detail?: string;
  instruction?: string;
  severity: "extreme" | "severe" | "moderate" | "minor" | "unknown";
  urgency: "immediate" | "expected" | "future" | "past" | "unknown";
  certainty: "observed" | "likely" | "possible" | "unlikely" | "unknown";
  sentAt?: string;
  effectiveAt?: string;
  expiresAt?: string;
  sourceUrl: string;
  sampleDistanceMeters: number;
}

export interface RouteOfficialAlertSnapshot {
  version: typeof OFFICIAL_ALERTS_VERSION;
  routeId: string;
  retrievedAt: string;
  sources: OfficialAlertSourceState[];
  alerts: OfficialRouteAlert[];
}

interface NwsFeatureCollection {
  features?: Array<{
    id?: unknown;
    properties?: {
      "@id"?: unknown;
      event?: unknown;
      headline?: unknown;
      description?: unknown;
      instruction?: unknown;
      severity?: unknown;
      urgency?: unknown;
      certainty?: unknown;
      sent?: unknown;
      effective?: unknown;
      expires?: unknown;
    };
  }>;
}

function clippedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, max) : undefined;
}

function officialUrl(value: unknown, source: OfficialAlertSource): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (source === "nws" && url.hostname !== "api.weather.gov" && !url.hostname.endsWith(".weather.gov")) return null;
    if (source === "nps" && url.hostname !== "www.nps.gov" && url.hostname !== "nps.gov") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function iso(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function nwsSeverity(value: unknown): OfficialRouteAlert["severity"] {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  return normalized === "extreme" || normalized === "severe" || normalized === "moderate" || normalized === "minor"
    ? normalized
    : "unknown";
}

function nwsUrgency(value: unknown): OfficialRouteAlert["urgency"] {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  return normalized === "immediate" || normalized === "expected" || normalized === "future" || normalized === "past"
    ? normalized
    : "unknown";
}

function nwsCertainty(value: unknown): OfficialRouteAlert["certainty"] {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  return normalized === "observed" || normalized === "likely" || normalized === "possible" || normalized === "unlikely"
    ? normalized
    : "unknown";
}

export function parseNwsAlerts(
  value: unknown,
  sampleDistanceMeters: number,
): OfficialRouteAlert[] {
  if (!value || typeof value !== "object" || !Number.isFinite(sampleDistanceMeters) || sampleDistanceMeters < 0) return [];
  const features = (value as NwsFeatureCollection).features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature) => {
    const properties = feature?.properties;
    if (!properties || typeof properties !== "object") return [];
    const sourceUrl = officialUrl(properties["@id"] ?? feature.id, "nws");
    const title = clippedText(properties.headline, 180) ?? clippedText(properties.event, 120);
    if (!sourceUrl || !title) return [];
    return [{
      id: sourceUrl,
      source: "nws" as const,
      title,
      detail: clippedText(properties.description, 1_200),
      instruction: clippedText(properties.instruction, 800),
      severity: nwsSeverity(properties.severity),
      urgency: nwsUrgency(properties.urgency),
      certainty: nwsCertainty(properties.certainty),
      sentAt: iso(properties.sent),
      effectiveAt: iso(properties.effective),
      expiresAt: iso(properties.expires),
      sourceUrl,
      sampleDistanceMeters,
    }];
  });
}

async function fetchNwsPoint(point: { lat: number; lng: number; distanceMeters: number }): Promise<{
  ok: boolean;
  alerts: OfficialRouteAlert[];
}> {
  if (!isUsCoverageCoordinate(point.lat, point.lng)) return { ok: false, alerts: [] };
  try {
    const url = new URL("https://api.weather.gov/alerts/active");
    url.searchParams.set("point", `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`);
    const response = await fetchWithTimeout(url, {
      cache: "no-store",
      headers: {
        Accept: "application/geo+json",
        "User-Agent": "Klandagi-Hiking-App/1.0 (+https://github.com/CatCorner22/hike)",
      },
    }, NWS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, alerts: [] };
    return {
      ok: true,
      alerts: parseNwsAlerts(await readJsonCapped<NwsFeatureCollection>(response, 1024 * 1024), point.distanceMeters),
    };
  } catch {
    return { ok: false, alerts: [] };
  }
}

function dedupeAlerts(alerts: OfficialRouteAlert[]): OfficialRouteAlert[] {
  const byId = new Map<string, OfficialRouteAlert>();
  for (const alert of alerts) {
    const existing = byId.get(alert.id);
    if (!existing || alert.sampleDistanceMeters < existing.sampleDistanceMeters) byId.set(alert.id, alert);
  }
  return [...byId.values()]
    .sort((a, b) => {
      const rank = { extreme: 5, severe: 4, moderate: 3, minor: 2, unknown: 1 };
      return rank[b.severity] - rank[a.severity] || a.sampleDistanceMeters - b.sampleDistanceMeters;
    })
    .slice(0, MAX_OFFICIAL_ALERTS);
}

export async function fetchOfficialRouteAlerts(input: {
  routeId: string;
  points: Array<{ lat: number; lng: number; distanceMeters: number }>;
  parkCode?: string | null;
  now?: number;
}): Promise<RouteOfficialAlertSnapshot> {
  const now = input.now ?? Date.now();
  const checkedAt = new Date(now).toISOString();
  const points = input.points
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.distanceMeters))
    .filter((point) => isUsCoverageCoordinate(point.lat, point.lng))
    .slice(0, 5);
  const nwsResults = await Promise.all(points.map(fetchNwsPoint));
  const successfulNws = nwsResults.filter((result) => result.ok).length;
  const sources: OfficialAlertSourceState[] = [{
    source: "nws",
    status: points.length === 0
      ? "not_applicable"
      : successfulNws === points.length
        ? "checked"
        : successfulNws > 0
          ? "partial"
          : "unavailable",
    checkedAt,
    detail: points.length === 0
      ? "Route points are outside supported U.S. NWS coverage."
      : successfulNws === points.length
        ? `NWS active alerts checked at ${successfulNws} route sample${successfulNws === 1 ? "" : "s"}.`
        : successfulNws > 0
          ? `NWS answered ${successfulNws} of ${points.length} route samples.`
          : "NWS active alerts could not be checked.",
    pointsChecked: successfulNws,
  }];
  const alerts = nwsResults.flatMap((result) => result.alerts);

  const nps = await getVerifiedParkAlertSnapshot(input.parkCode);
  sources.push({
    source: "nps",
    status: nps.status,
    checkedAt,
    detail: nps.detail,
    parkCode: nps.parkCode,
    parkName: nps.parkName,
  });
  if (nps.status === "checked") {
    for (const alert of nps.alerts) {
      const sourceUrl = officialUrl(alert.url, "nps");
      const title = clippedText(alert.title, 180);
      if (!sourceUrl || !title) continue;
      alerts.push({
        id: `nps:${nps.parkCode}:${sourceUrl}:${title}`,
        source: "nps",
        title,
        detail: clippedText(alert.description, 1_200),
        severity: "unknown",
        urgency: "unknown",
        certainty: "unknown",
        sourceUrl,
        sampleDistanceMeters: 0,
      });
    }
  }

  return {
    version: OFFICIAL_ALERTS_VERSION,
    routeId: input.routeId,
    retrievedAt: checkedAt,
    sources,
    alerts: dedupeAlerts(alerts),
  };
}

function validString(value: unknown, max: number, required = false): value is string | undefined {
  if (value === undefined && !required) return true;
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function validOfficialAlertSnapshot(value: unknown, routeId?: string): value is RouteOfficialAlertSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as RouteOfficialAlertSnapshot;
  if (snapshot.version !== OFFICIAL_ALERTS_VERSION) return false;
  if (!validString(snapshot.routeId, 256, true) || (routeId !== undefined && snapshot.routeId !== routeId)) return false;
  const retrieved = Date.parse(snapshot.retrievedAt);
  if (!Number.isFinite(retrieved) || retrieved < Date.UTC(2020, 0, 1) || retrieved > Date.now() + 5 * 60_000) return false;
  if (!Array.isArray(snapshot.sources) || snapshot.sources.length < 1 || snapshot.sources.length > 2) return false;
  const sourceNames = new Set<OfficialAlertSource>();
  for (const source of snapshot.sources) {
    if (!source || (source.source !== "nws" && source.source !== "nps")) return false;
    if (sourceNames.has(source.source)) return false;
    sourceNames.add(source.source);
    if (!["checked", "partial", "unavailable", "not_configured", "not_applicable"].includes(source.status)) return false;
    if (!validString(source.detail, 300, true) || !iso(source.checkedAt)) return false;
    if (source.pointsChecked !== undefined && (!Number.isInteger(source.pointsChecked) || source.pointsChecked < 0 || source.pointsChecked > 5)) return false;
    if (!validString(source.parkCode, 12) || !validString(source.parkName, 180)) return false;
  }
  if (!Array.isArray(snapshot.alerts) || snapshot.alerts.length > MAX_OFFICIAL_ALERTS) return false;
  for (const alert of snapshot.alerts) {
    if (!alert || (alert.source !== "nws" && alert.source !== "nps")) return false;
    if (!validString(alert.id, 2_048, true) || !validString(alert.title, 180, true)) return false;
    if (!validString(alert.detail, 1_200) || !validString(alert.instruction, 800)) return false;
    if (!["extreme", "severe", "moderate", "minor", "unknown"].includes(alert.severity)) return false;
    if (!["immediate", "expected", "future", "past", "unknown"].includes(alert.urgency)) return false;
    if (!["observed", "likely", "possible", "unlikely", "unknown"].includes(alert.certainty)) return false;
    if (!officialUrl(alert.sourceUrl, alert.source)) return false;
    if (!Number.isFinite(alert.sampleDistanceMeters) || alert.sampleDistanceMeters < 0) return false;
    if (alert.sentAt !== undefined && !iso(alert.sentAt)) return false;
    if (alert.effectiveAt !== undefined && !iso(alert.effectiveAt)) return false;
    if (alert.expiresAt !== undefined && !iso(alert.expiresAt)) return false;
  }
  try {
    return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= MAX_OFFICIAL_ALERTS_BYTES;
  } catch {
    return false;
  }
}

export function officialAlertFreshness(snapshot: RouteOfficialAlertSnapshot, now = Date.now()): "fresh" | "stale" | "clock_error" {
  const retrieved = Date.parse(snapshot.retrievedAt);
  if (!Number.isFinite(retrieved) || retrieved > now) return "clock_error";
  return now - retrieved <= OFFICIAL_ALERTS_STALE_MS ? "fresh" : "stale";
}

export function describeOfficialAlertSnapshot(snapshot: RouteOfficialAlertSnapshot, now = Date.now()): string {
  const freshness = officialAlertFreshness(snapshot, now);
  const checked = snapshot.sources.filter((source) => source.status === "checked" || source.status === "partial");
  const alertCount = snapshot.alerts.length;
  const result = alertCount
    ? `${alertCount} official alert${alertCount === 1 ? "" : "s"} stored.`
    : checked.length
      ? "No active alerts were returned by the sources that answered."
      : "No official alert source completed a check.";
  const age = freshness === "fresh" ? "Snapshot is under 30 minutes old." : freshness === "stale" ? "Snapshot is stale." : "Snapshot time cannot be trusted.";
  return `${result} ${age} This is a cached point check, not complete all-hazards coverage.`;
}
