export const GUARDIAN_LIVE_WINDOW_MS = 5 * 60 * 1000;
export const GUARDIAN_MAX_SHARE_HOURS = 72;
export const GUARDIAN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type GuardianStatusPayload = {
  progressPercent?: number | null;
  etaAt?: string | null;
  batteryPercent?: number | null;
  deviationMeters?: number | null;
};

export type GuardianDataState = "live" | "cached" | "unknown";
export type GuardianDeadlineState = "on_time" | "overdue" | "unknown";
export type GuardianDisplayState = GuardianDataState | "overdue";

export type GuardianPublicStatus = {
  routeName: string;
  expiresAt: string;
  overdueAt: string | null;
  lastUpdateAt: string | null;
  serverCheckedAt: string;
  status: GuardianStatusPayload | null;
  dataState: GuardianDataState;
  deadlineState: GuardianDeadlineState;
  displayState: GuardianDisplayState;
};

function validTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * "Live" means a status write was acknowledged by the server in the last five
 * minutes. It deliberately does not mean a continuous GPS connection.
 */
export function classifyGuardianStatus(input: {
  now?: Date;
  lastUpdateAt?: Date | string | null;
  overdueAt?: Date | string | null;
}): Pick<GuardianPublicStatus, "dataState" | "deadlineState" | "displayState"> {
  const now = (input.now ?? new Date()).getTime();
  const lastUpdate = validTime(input.lastUpdateAt);
  const overdueAt = validTime(input.overdueAt);

  const dataState: GuardianDataState =
    lastUpdate == null || lastUpdate > now + 60_000
      ? "unknown"
      : now - lastUpdate <= GUARDIAN_LIVE_WINDOW_MS
        ? "live"
        : "cached";
  const deadlineState: GuardianDeadlineState =
    overdueAt == null ? "unknown" : now > overdueAt ? "overdue" : "on_time";
  return {
    dataState,
    deadlineState,
    displayState: deadlineState === "overdue" ? "overdue" : dataState,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 256-bit bearer token. Its fragment form is not sent in HTTP URLs or Referer. */
export function newGuardianToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

/** Store only this digest, never the bearer token. */
export async function guardianTokenHash(token: string): Promise<string> {
  if (!GUARDIAN_TOKEN_PATTERN.test(token)) throw new Error("Guardian token is malformed");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function guardianProgressPercent(
  traveledMeters: number | null | undefined,
  remainingMeters: number | null | undefined,
): number | null {
  if (
    traveledMeters == null ||
    remainingMeters == null ||
    !Number.isFinite(traveledMeters) ||
    !Number.isFinite(remainingMeters) ||
    traveledMeters < 0 ||
    remainingMeters < 0 ||
    traveledMeters + remainingMeters <= 0
  ) return null;
  return Math.round((traveledMeters / (traveledMeters + remainingMeters)) * 1000) / 10;
}

/**
 * A conservative pace-based ETA. No ETA is better than one inferred from a few
 * seconds of GPS jitter, so require ten minutes and 250 m of observed travel.
 */
export function estimateGuardianEta(input: {
  nowMs: number;
  startedAtMs: number | null | undefined;
  traveledMeters: number | null | undefined;
  remainingMeters: number | null | undefined;
}): string | null {
  const { nowMs, startedAtMs, traveledMeters, remainingMeters } = input;
  if (
    startedAtMs == null ||
    traveledMeters == null ||
    remainingMeters == null ||
    ![nowMs, startedAtMs, traveledMeters, remainingMeters].every(Number.isFinite) ||
    startedAtMs > nowMs ||
    traveledMeters < 250 ||
    remainingMeters < 0
  ) return null;
  const elapsedSeconds = (nowMs - startedAtMs) / 1000;
  if (elapsedSeconds < 10 * 60) return null;
  const speedMetersPerSecond = traveledMeters / elapsedSeconds;
  if (speedMetersPerSecond < 0.15 || speedMetersPerSecond > 4.5) return null;
  const remainingSeconds = remainingMeters / speedMetersPerSecond;
  if (!Number.isFinite(remainingSeconds) || remainingSeconds > GUARDIAN_MAX_SHARE_HOURS * 3600) {
    return null;
  }
  return new Date(nowMs + remainingSeconds * 1000).toISOString();
}
