import { APP_NAME } from "@/lib/brand";
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

/**
 * Label the two ends of the route. Only claims a trailhead when the hiker's own start is
 * known; otherwise names them by compass position and says plainly that the sheet cannot
 * tell which one the party set off from.
 */
function routeEndLines(
  ends: { start: { lat: number; lng: number }; end: { lat: number; lng: number } },
  startedFrom?: { lat: number; lng: number } | null,
): string[] {
  const west = ends.start.lng <= ends.end.lng ? ends.start : ends.end;
  const east = west === ends.start ? ends.end : ends.start;

  if (startedFrom && Number.isFinite(startedFrom.lat) && Number.isFinite(startedFrom.lng)) {
    const startIsWest = metresBetween(startedFrom, west) <= metresBetween(startedFrom, east);
    const startEnd = startIsWest ? west : east;
    const farEnd = startIsWest ? east : west;
    return [
      `TRAILHEAD (party set off here): ${grid(startEnd.lat, startEnd.lng)}`,
      `Far end of route: ${grid(farEnd.lat, farEnd.lng)}`,
    ];
  }

  return [
    `West end: ${grid(west.lat, west.lng)}`,
    `East end: ${grid(east.lat, east.lng)}`,
    "Which end the party set off from is NOT recorded on this sheet — ask the contact.",
  ];
}

/** A grid, or an explicit statement that there isn't one — never the string "null". */
function grid(lat: number, lng: number): string {
  return formatUsng(lat, lng) ?? "unavailable (outside the UTM grid at this latitude)";
}

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const mPerDegLng = 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((b.lat - a.lat) * 111_132, (b.lng - a.lng) * mPerDegLng);
}

/** Paper twin of SOS: route card + grids + ICE + return + last check-ins. */
export function buildPaperBackup(input: {
  trailName: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  profile: IceProfile;
  returnAt?: string | null;
  checkins?: CheckinEntry[];
  packAge?: string;
  /**
   * Where the hiker actually set off, if known (first breadcrumb of the session).
   * Stored line direction is arbitrary — `stitchRelationWays` normalises every OSM chain
   * to run west-east — so without this the sheet cannot say which end is the trailhead,
   * and must not guess: this is the page a searcher reads to decide where to start.
   */
  startedFrom?: { lat: number; lng: number } | null;
}): string {
  const ends = trailhead(input.geometry);
  const legs = routeCardLegs(input.geometry);
  const lines = [
    `=== ${APP_NAME.toUpperCase()} PAPER BACKUP (hand to SAR) ===`,
    `Route: ${reportField(input.trailName)}`,
    input.packAge ? `Pack saved: ${reportField(input.packAge)}` : "",
    "",
    "--- ROUTE ENDS ---",
    ...(ends ? routeEndLines(ends, input.startedFrom) : ["Route ends: unknown"]),
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
