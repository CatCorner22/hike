import { APP_NAME } from "@/lib/brand";
import { guardianStatus } from "@/lib/safety/decision-support";
import { formatCoords, type PositionSource } from "@/lib/safety/emergency";
import type { IceProfile } from "@/lib/safety/profile";
import { formatReport, reportField } from "@/lib/safety/report-field";
import { smsHref } from "@/lib/safety/strobe";
import { formatDeadlineForPerson, type StoredDeadlineLocal } from "@/lib/safety/deadline-text";

export type GuardianMessageKind = "departing" | "ok" | "overdue";

export const GUARDIAN_NO_DISTRESS =
  "This is not proof of distress. Silence or a late check-in does not by itself mean a rescue is needed.";

export function formatGuardianMessage(input: {
  kind: GuardianMessageKind;
  trailName: string;
  profile?: IceProfile | null;
  returnAt?: string | null;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  offTrailM?: number;
  batteryPct?: number | null;
  positionSource?: PositionSource;
  lastUpdateAt?: number | string | null;
  /** The stored local form of the deadline, so the contact can read it. */
  returnLocal?: StoredDeadlineLocal | null;
  now?: Date;
}): string {
  const deadline = input.returnAt && Number.isFinite(Date.parse(input.returnAt))
    ? new Date(input.returnAt)
    : null;
  const status = guardianStatus(input.now ?? new Date(), deadline);
  const hiker = input.profile?.name ? reportField(input.profile.name) : "A hiker";
  const kindLine =
    input.kind === "departing"
      ? `${hiker} is departing on ${reportField(input.trailName)}.`
      : input.kind === "ok"
        ? `${hiker} checked in OK from ${reportField(input.trailName)}.`
        : `${hiker} is past the agreed overdue time on ${reportField(input.trailName)}.`;

  const lastUpdate =
    input.lastUpdateAt == null
      ? null
      : typeof input.lastUpdateAt === "number"
        ? Number.isFinite(input.lastUpdateAt)
          ? new Date(input.lastUpdateAt).toISOString()
          : null
        : Number.isFinite(Date.parse(input.lastUpdateAt))
          ? new Date(input.lastUpdateAt).toISOString()
          : null;

  const position =
    input.lat != null && input.lng != null
      ? formatCoords(input.lat, input.lng, input.accuracyM)
      : "No usable GPS on this message.";

  const source =
    input.positionSource === "deadReckon"
      ? "Position is a dead-reckon estimate, not a live GPS fix."
      : input.positionSource === "lastKnown"
        ? "Position is last-known, not live GPS."
        : input.positionSource === "gps"
          ? "Position is from live GPS on the hiker's phone."
          : null;

  return formatReport([
    `${APP_NAME} Trip Guardian`,
    kindLine,
    deadline
      ? `Call for help if not heard from by: ${reportField(formatDeadlineForPerson(deadline, input.returnLocal))}`
      : "No overdue-action time is set.",
    reportField(status.message),
    `Last update: ${lastUpdate ? reportField(lastUpdate) : "none on this device"}`,
    `Location: ${position}`,
    source,
    input.offTrailM != null && Number.isFinite(input.offTrailM)
      ? `Off marked route: ${Math.round(input.offTrailM)} m`
      : null,
    input.batteryPct != null && Number.isFinite(input.batteryPct)
      ? `Phone battery: ${Math.round(input.batteryPct)}%`
      : null,
    input.profile?.icePhone ? `ICE phone: ${reportField(input.profile.icePhone)}` : null,
    GUARDIAN_NO_DISTRESS,
    "If you must call for help, give the itinerary, last confirmed time and location, and this message — not a guess.",
  ]);
}

/**
 * `sms:` URL for the ICE phone, or null when the number is missing/unusable.
 *
 * The href FORM is delegated to `smsHref`, which is the one place that knows
 * iOS accepts `sms:number&body=` while everything else wants `?body=`. This
 * used to hardcode the `?` form, so on an iPhone — the platform this ships to —
 * Messages opened addressed to the contact with an EMPTY body: the itinerary,
 * return deadline, and last position all silently dropped from the departing,
 * OK, and overdue messages. The leave-behind chain is the whole point of Trip
 * Guardian, so the format must never be re-derived here.
 */
export function guardianSmsHref(
  phone: string | undefined,
  body: string,
  userAgent?: string,
): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 7) return null;
  return smsHref(digits, body, userAgent);
}
