import { formatRouteCard, routeCardLegs } from "@/lib/safety/route-card";
import { formatUsng } from "@/lib/safety/usng";
import type { CheckinEntry } from "@/lib/safety/checkin";
import type { IceProfile } from "@/lib/safety/profile";
import { overdueStatus } from "@/lib/safety/profile";
import { formatReport, reportField } from "@/lib/safety/report-field";

function trailhead(geometry: GeoJSON.LineString | GeoJSON.MultiLineString) {
  const first =
    geometry.type === "LineString"
      ? geometry.coordinates[0]
      : geometry.coordinates.find((l) => l.length >= 2)?.[0];
  const lastLine =
    geometry.type === "LineString"
      ? geometry.coordinates
      : [...geometry.coordinates].reverse().find((l) => l.length >= 2);
  const last = lastLine?.[lastLine.length - 1];
  if (!first || !last) return null;
  return {
    start: { lng: first[0], lat: first[1] },
    end: { lng: last[0], lat: last[1] },
  };
}

function paperCheckinLines(entries: CheckinEntry[]): string[] {
  if (entries.length === 0) return ["No check-ins logged."];
  return entries.map((entry) => {
    const lat = entry.lat;
    const lng = entry.lng;
    const grid =
      typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)
        ? ` @ ${lat.toFixed(5)}, ${lng.toFixed(5)}`
        : "";
    const note = entry.note ? ` — ${reportField(entry.note)}` : "";
    return `${reportField(entry.recordedAt)}${grid}${note}`;
  });
}

/** Paper twin of SOS: route card + grids + ICE + return + last check-ins. */
export function buildPaperBackup(input: {
  trailName: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  profile: IceProfile;
  returnAt?: string | null;
  checkins?: CheckinEntry[];
  packAge?: string;
}): string {
  const ends = trailhead(input.geometry);
  const legs = routeCardLegs(input.geometry);
  const lines = [
    "=== HIKE PAPER BACKUP (hand to SAR) ===",
    `Route: ${reportField(input.trailName)}`,
    input.packAge ? `Pack saved: ${reportField(input.packAge)}` : "",
    "",
    "--- GRIDS ---",
    ends
      ? `Start USNG: ${reportField(formatUsng(ends.start.lat, ends.start.lng))}`
      : "Start USNG: unknown",
    ends ? `End USNG: ${reportField(formatUsng(ends.end.lat, ends.end.lng))}` : "End USNG: unknown",
    "",
    ...formatRouteCard(input.trailName, legs).split("\n"),
    "",
    "--- ICE ---",
    `Hiker: ${input.profile.name ? reportField(input.profile.name) : "(not set)"}`,
    `Party: ${reportField(input.profile.partySize)}`,
    `ICE: ${input.profile.iceName ? reportField(input.profile.iceName) : "—"} ${input.profile.icePhone ? reportField(input.profile.icePhone) : ""}`.trim(),
    `Medical: ${input.profile.medical ? reportField(input.profile.medical) : "none noted"}`,
    "",
  ];

  if (input.returnAt) {
    const status = overdueStatus(input.returnAt);
    lines.push("--- RETURN ---", `Return by: ${reportField(input.returnAt)}`, reportField(status.label), "");
  }

  if (input.checkins && input.checkins.length > 0) {
    lines.push("--- LAST CHECK-INS ---", ...paperCheckinLines(input.checkins), "");
  }

  lines.push(
    "This sheet matches the on-phone route card math. It is not a live GPS fix.",
  );
  return formatReport(lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")));
}
