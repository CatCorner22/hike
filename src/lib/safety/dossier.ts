import { APP_NAME } from "@/lib/brand";
import { formatZulu } from "@/lib/safety/landnav";
import { formatDeadlineForPerson, type StoredDeadlineLocal } from "@/lib/safety/deadline-text";
import { formatCoords, emergencyMessage, type PositionSource } from "@/lib/safety/emergency";
import { formatCheckinLog, type CheckinEntry } from "@/lib/safety/checkin";
import { formatNavLog, type NavLeg } from "@/lib/safety/navlog";
import type { IceProfile, SafetyWaypoint } from "@/lib/safety/profile";
import { formatUsng, formatMgrs10 } from "@/lib/safety/usng";
import { overdueStatus } from "@/lib/safety/profile";

export function buildSafetyDossier(input: {
  profile: IceProfile;
  trailName: string;
  packId: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  stale?: boolean;
  recordedAt?: number;
  offTrailM?: number;
  returnAt?: string | null;
  /** The stored local form of the deadline, so a reader sees their own clock. */
  returnLocal?: StoredDeadlineLocal | null;
  checkins?: CheckinEntry[];
  navLegs?: NavLeg[];
  waypoints?: SafetyWaypoint[];
  extraNotes?: string[];
  positionSource?: PositionSource;
}): string {
  const lines: string[] = [
    `=== ${APP_NAME.toUpperCase()} SAFETY DOSSIER ===`,
    `Generated: ${new Date().toISOString()} (${formatZulu()})`,
    `Route: ${input.trailName}`,
    `Pack ID: ${input.packId}`,
    "",
    "--- HIKER / ICE ---",
    `Name: ${input.profile.name || "(not set)"}`,
    `Party size: ${input.profile.partySize}`,
    `ICE: ${input.profile.iceName || "—"} ${input.profile.icePhone || ""}`.trim(),
    `Blood type: ${input.profile.bloodType || "unknown"}`,
    `Medical: ${input.profile.medical || "none noted"}`,
    "",
  ];

  if (input.lat != null && input.lng != null) {
    lines.push("--- LAST POSITION ---");
    if (input.positionSource === "deadReckon") {
      lines.push("STATUS: dead reckon — GPS denied; pace/heading estimate");
    } else if (input.stale || input.positionSource === "lastKnown") {
      lines.push("STATUS: last known — GPS not live");
    }
    lines.push(formatCoords(input.lat, input.lng, input.accuracyM));
    const usng = formatUsng(input.lat, input.lng);
    const mgrs = formatMgrs10(input.lat, input.lng);
    // formatUsng returns null for a non-finite or out-of-grid position; printing
    // it raw put the literal text "USNG: null" on a sheet handed to searchers.
    if (usng && mgrs) {
      lines.push(`USNG: ${usng}`);
      lines.push(`MGRS10: ${mgrs}`);
    } else {
      lines.push("USNG/MGRS: unavailable for this position — use the lat/long above.");
    }
    if (input.recordedAt) {
      lines.push(`Fix time: ${new Date(input.recordedAt).toISOString()}`);
    }
    if (input.offTrailM != null && input.offTrailM > 20) {
      lines.push(
        input.stale
          ? `LAST KNOWN was ~${Math.round(input.offTrailM)} m off marked route`
          : `Off route: ~${Math.round(input.offTrailM)} m`,
      );
    }
    lines.push("");
  }

  if (input.returnAt) {
    const status = overdueStatus(input.returnAt);
    lines.push("--- PLANNED RETURN ---");
    lines.push(
      `Return by: ${formatDeadlineForPerson(new Date(input.returnAt), input.returnLocal) ?? "unreadable"}`,
    );
    lines.push(status ? status.label : "Return time unreadable — re-enter it before relying on the overdue alarm.");
    lines.push("");
  }

  if (input.checkins && input.checkins.length > 0) {
    lines.push("--- CHECK-INS ---");
    lines.push(formatCheckinLog(input.checkins));
    lines.push("");
  }

  if (input.waypoints && input.waypoints.length > 0) {
    lines.push("--- MARKED WAYPOINTS ---");
    for (const wp of input.waypoints) {
      const note = wp.note ? ` — ${wp.note}` : "";
      lines.push(
        `${wp.kind.toUpperCase()} ${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)} @ ${wp.recordedAt}${note}`,
      );
    }
    lines.push("");
  }

  if (input.navLegs && input.navLegs.length > 0) {
    lines.push("--- NAV LOG ---");
    lines.push(formatNavLog(input.navLegs));
    lines.push("");
  }

  if (input.extraNotes && input.extraNotes.length > 0) {
    lines.push("--- NOTES ---");
    lines.push(...input.extraNotes);
    lines.push("");
  }

  lines.push("--- EMERGENCY BLOCK (share with SAR) ---");
  lines.push(
    emergencyMessage({
      lat: input.lat,
      lng: input.lng,
      accuracyM: input.accuracyM,
      trailName: input.trailName,
      offTrailM: input.offTrailM,
      stale: input.stale,
      recordedAt: input.recordedAt,
      profile: input.profile,
      positionSource: input.positionSource,
    }),
  );

  return lines.join("\n");
}
