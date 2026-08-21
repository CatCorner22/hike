import { APP_NAME } from "@/lib/brand";
import { missedCheckInPolicy } from "@/lib/safety/comms";
import { guardianStatus } from "@/lib/safety/decision-support";
import type { IceProfile } from "@/lib/safety/profile";
import { formatUsng } from "@/lib/safety/usng";
import { formatReport, reportField } from "@/lib/safety/report-field";

export const LEAVE_BEHIND_DISCLAIMER =
  "Silence is not distress. Call SAR only at the agreed overdue-action time, if an SOS arrives, or if there is other evidence of trouble.";

function gridOrUnknown(lat?: number, lng?: number): string {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "not recorded on this card";
  }
  return formatUsng(lat, lng) ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function routeEnds(
  geometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null,
): { west?: string; east?: string } {
  if (!geometry) return {};
  const first =
    geometry.type === "LineString"
      ? geometry.coordinates[0]
      : geometry.coordinates.find((line) => line.length >= 2)?.[0];
  const lastLine =
    geometry.type === "LineString"
      ? geometry.coordinates
      : [...geometry.coordinates].reverse().find((line) => line.length >= 2);
  const last = lastLine?.[lastLine.length - 1];
  if (!first || !last) return {};
  const a = { lng: first[0], lat: first[1] };
  const b = { lng: last[0], lat: last[1] };
  const west = a.lng <= b.lng ? a : b;
  const east = west === a ? b : a;
  return {
    west: gridOrUnknown(west.lat, west.lng),
    east: gridOrUnknown(east.lat, east.lng),
  };
}

/** Printable itinerary for a home contact — not a live GPS sheet and not a SAR handoff. */
export function formatLeaveBehindCard(input: {
  trailName: string;
  profile: IceProfile;
  returnAt?: string | null;
  geometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  vehicle?: string | null;
  notes?: string | null;
  now?: Date;
}): string {
  const ends = routeEnds(input.geometry);
  const deadline = input.returnAt && Number.isFinite(Date.parse(input.returnAt))
    ? new Date(input.returnAt)
    : null;
  const status = guardianStatus(input.now ?? new Date(), deadline);
  return formatReport([
    `=== ${APP_NAME.toUpperCase()} LEAVE-BEHIND (give to home contact) ===`,
    "Keep this sheet. Do not organize an uncoordinated search.",
    "",
    "--- PARTY ---",
    `Hiker: ${input.profile.name ? reportField(input.profile.name) : "(not set)"}`,
    `Party size: ${reportField(input.profile.partySize)}`,
    `ICE: ${input.profile.iceName ? reportField(input.profile.iceName) : "—"} ${
      input.profile.icePhone ? reportField(input.profile.icePhone) : ""
    }`.trim(),
    `Medical: ${input.profile.medical ? reportField(input.profile.medical) : "none noted"}`,
    "",
    "--- ITINERARY ---",
    `Route: ${reportField(input.trailName)}`,
    ends.west ? `West end: ${ends.west}` : null,
    ends.east ? `East end: ${ends.east}` : null,
    "Which end the party started from is not assumed — ask before directing SAR.",
    input.vehicle ? `Vehicle: ${reportField(input.vehicle)}` : "Vehicle: (not set)",
    input.notes ? `Notes: ${reportField(input.notes)}` : null,
    "",
    "--- RETURN ---",
    deadline
      ? `Agreed overdue-action time: ${reportField(deadline.toISOString())}`
      : "Agreed overdue-action time: (not set — do not treat silence as an emergency)",
    reportField(status.message),
    LEAVE_BEHIND_DISCLAIMER,
    "",
    "--- IF THEY ARE OVERDUE ---",
    ...missedCheckInPolicy().map((line) => `· ${line}`),
  ]);
}
