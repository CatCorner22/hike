import { estimateSunsetUtc } from "@/lib/safety/daylight";

/**
 * "unknown" exists because every other value is a claim about the hiker's
 * situation. Without it, unusable input had to be squeezed into one of the three
 * verdicts, and it consistently came out as "ok" -- an unknown remaining
 * distance reported 527 minutes of daylight margin, and an unreadable clock
 * reported "on-time". This is the logic that tells someone whether to turn
 * around before dark, so it must be able to say "I cannot tell".
 */
export type DecisionSeverity = "ok" | "watch" | "critical" | "unknown";

function usableDate(value: unknown): Date | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

function onGlobe(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export interface DaylightDecision {
  severity: DecisionSeverity;
  eta: Date;
  sunset: Date | "polar-night" | "midnight-sun";
  marginMinutes: number | null;
  message: string;
}

/**
 * Deterministic daylight decision support. This deliberately contains no AI:
 * safety math must remain inspectable, testable and usable offline.
 */
export function assessDaylightMargin(input: {
  now: Date;
  lat: number;
  lng: number;
  remainingMeters: number;
  paceMetersPerHour: number;
  reserveMinutes?: number;
}): DaylightDecision {
  const reserve =
    Number.isFinite(input.reserveMinutes) && (input.reserveMinutes as number) >= 0
      ? (input.reserveMinutes as number)
      : 45;
  const now = usableDate(input.now);
  const unknown = (reason: string): DaylightDecision => ({
    severity: "unknown",
    eta: now ?? new Date(Number.NaN),
    sunset: new Date(Number.NaN),
    marginMinutes: null,
    message: `Daylight margin cannot be calculated: ${reason}. Treat the finish time as unknown and plan for darkness.`,
  });

  if (!now) return unknown("the device clock is unreadable");
  if (!onGlobe(input.lat, input.lng)) return unknown("the start position is not a valid location");
  // A silent 3000 m/h substitution presented a fabricated pace as "the current
  // planning pace".
  if (!Number.isFinite(input.paceMetersPerHour) || input.paceMetersPerHour <= 0) {
    return unknown("no usable planning pace was supplied");
  }
  // Clamping an unknown distance to 0 made the app report the maximum possible
  // daylight margin -- the most reassuring answer available.
  if (!Number.isFinite(input.remainingMeters) || input.remainingMeters < 0) {
    return unknown("the remaining distance is unknown");
  }

  const pace = input.paceMetersPerHour;
  const remaining = input.remainingMeters;
  const travelMinutes = (remaining / pace) * 60;
  const eta = new Date(now.getTime() + travelMinutes * 60_000);
  if (!Number.isFinite(eta.getTime())) return unknown("the estimated finish time is not representable");
  const sunset = estimateSunsetUtc(now, input.lat, input.lng);
  if (sunset instanceof Date && !Number.isFinite(sunset.getTime())) {
    return unknown("sunset could not be determined for this location");
  }

  if (sunset === "polar-night") {
    return { severity: "critical", eta, sunset, marginMinutes: null, message: "No usable daylight window. Navigate as a night movement and carry redundant lighting." };
  }
  if (sunset === "midnight-sun") {
    return { severity: "ok", eta, sunset, marginMinutes: null, message: "No sunset constraint for this solar day." };
  }

  const marginMinutes = Math.round((sunset.getTime() - eta.getTime()) / 60_000);
  if (!Number.isFinite(marginMinutes)) return unknown("sunset could not be compared with the finish time");
  if (marginMinutes < 0) {
    return { severity: "critical", eta, sunset, marginMinutes, message: `At the current planning pace, finish is about ${Math.abs(marginMinutes)} min after sunset.` };
  }
  if (marginMinutes < reserve) {
    return { severity: "watch", eta, sunset, marginMinutes, message: `Only ${marginMinutes} min of daylight margin remains; consider the next safe turnaround or bailout.` };
  }
  return { severity: "ok", eta, sunset, marginMinutes, message: `${marginMinutes} min of daylight margin remains at the current planning pace.` };
}

export interface DecisionPoint {
  id: string;
  name: string;
  distanceMeters: number;
  kind: "turnaround" | "bailout" | "junction" | "shelter" | "water" | "road" | "custom";
  lat?: number;
  lng?: number;
  note?: string;
}

export function nextDecisionPoint(points: DecisionPoint[], distanceTravelledMeters: number): DecisionPoint | null {
  // With a non-finite travelled distance every comparison is false, so the
  // caller silently sees no upcoming bailout at all. Fall back to the first
  // point on the route instead of hiding them.
  if (!Array.isArray(points)) return null;
  if (!Number.isFinite(distanceTravelledMeters)) {
    return [...points]
      .filter((point) => Number.isFinite(point?.distanceMeters))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] ?? null;
  }
  return [...points]
    .filter((point) => Number.isFinite(point.distanceMeters) && point.distanceMeters >= distanceTravelledMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] ?? null;
}

export interface GuardianStatus {
  state: "on-time" | "due-soon" | "overdue" | "unknown";
  minutesToDeadline: number | null;
  message: string;
}

/** Honest overdue logic: absence of an update is never represented as proof of distress. */
export function guardianStatus(now: Date, hardOverdueAt?: Date | null): GuardianStatus {
  if (!hardOverdueAt || !Number.isFinite(hardOverdueAt.getTime())) {
    return { state: "unknown", minutesToDeadline: null, message: "No overdue deadline is configured." };
  }
  // An unreadable clock previously produced "on-time" with "NaN min remain" --
  // reassuring the very person who is checking whether help should be called.
  const reference = usableDate(now);
  if (!reference) {
    return {
      state: "unknown",
      minutesToDeadline: null,
      message: "The device clock is unreadable, so the overdue time cannot be checked. Confirm the time from another source.",
    };
  }
  const minutes = Math.round((hardOverdueAt.getTime() - reference.getTime()) / 60_000);
  if (!Number.isFinite(minutes)) {
    return { state: "unknown", minutesToDeadline: null, message: "The overdue time cannot be compared with the current time." };
  }
  if (minutes < 0) return { state: "overdue", minutesToDeadline: minutes, message: `Trip is ${Math.abs(minutes)} min past the agreed overdue time. Lack of an update does not establish why.` };
  if (minutes <= 60) return { state: "due-soon", minutesToDeadline: minutes, message: `Agreed overdue time is in ${minutes} min.` };
  return { state: "on-time", minutesToDeadline: minutes, message: `${minutes} min remain before the agreed overdue time.` };
}
