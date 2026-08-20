import { estimateSunsetUtc } from "@/lib/safety/daylight";

export type DecisionSeverity = "ok" | "watch" | "critical";

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
  const reserveMinutes = input.reserveMinutes ?? 45;
  const pace = Number.isFinite(input.paceMetersPerHour) && input.paceMetersPerHour > 0
    ? input.paceMetersPerHour
    : 3000;
  const remaining = Math.max(0, Number.isFinite(input.remainingMeters) ? input.remainingMeters : 0);
  const travelMinutes = (remaining / pace) * 60;
  const eta = new Date(input.now.getTime() + travelMinutes * 60_000);
  const sunset = estimateSunsetUtc(input.now, input.lat, input.lng);

  if (sunset === "polar-night") {
    return { severity: "critical", eta, sunset, marginMinutes: null, message: "No usable daylight window. Navigate as a night movement and carry redundant lighting." };
  }
  if (sunset === "midnight-sun") {
    return { severity: "ok", eta, sunset, marginMinutes: null, message: "No sunset constraint for this solar day." };
  }

  const marginMinutes = Math.round((sunset.getTime() - eta.getTime()) / 60_000);
  if (marginMinutes < 0) {
    return { severity: "critical", eta, sunset, marginMinutes, message: `At the current planning pace, finish is about ${Math.abs(marginMinutes)} min after sunset.` };
  }
  if (marginMinutes < reserveMinutes) {
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
  const minutes = Math.round((hardOverdueAt.getTime() - now.getTime()) / 60_000);
  if (minutes < 0) return { state: "overdue", minutesToDeadline: minutes, message: `Trip is ${Math.abs(minutes)} min past the agreed overdue time. Lack of an update does not establish why.` };
  if (minutes <= 60) return { state: "due-soon", minutesToDeadline: minutes, message: `Agreed overdue time is in ${minutes} min.` };
  return { state: "on-time", minutesToDeadline: minutes, message: `${minutes} min remain before the agreed overdue time.` };
}
