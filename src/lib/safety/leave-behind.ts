import { APP_NAME } from "@/lib/brand";
import { missedCheckInPolicy } from "@/lib/safety/comms";
import { guardianStatus } from "@/lib/safety/decision-support";
import type { IceProfile } from "@/lib/safety/profile";
import { formatUsng } from "@/lib/safety/usng";
import {
  formatReport,
  reportField,
  REPORT_MAX_LENGTH,
} from "@/lib/safety/report-field";
import { formatPlannedDate, plannedDateOnly } from "@/lib/plans/date-only";
import { formatDeadlineForPerson, type StoredDeadlineLocal } from "@/lib/safety/deadline-text";

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

export interface LeaveBehindLocation {
  name: string;
  kind?: string | null;
  lat?: number;
  lng?: number;
  /** Plain-language position along the saved route, such as "2.4 mi into route". */
  routePosition?: string | null;
  /** Honest source or verification note. */
  detail?: string | null;
}

export interface LeaveBehindRouteFact {
  label: string;
  value: string;
  basis?: string | null;
}

function planningTime(value?: string | null): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
}

function locationLine(location: LeaveBehindLocation): string {
  const details = [
    location.kind ? reportField(location.kind) : null,
    location.routePosition ? reportField(location.routePosition) : null,
    Number.isFinite(location.lat) && Number.isFinite(location.lng)
      ? gridOrUnknown(location.lat, location.lng)
      : null,
    location.detail ? reportField(location.detail) : null,
  ].filter((value): value is string => Boolean(value));
  return `· ${reportField(location.name)}${details.length ? ` — ${details.join("; ")}` : ""}`;
}

interface OptionalDetailSection {
  title: string;
  itemName: string;
  items: string[];
  requiredLines?: string[];
}

interface OptionalDetailSectionState extends OptionalDetailSection {
  included: string[];
}

const OWNED_SECTION_LINE = /^--- [A-Z][A-Z0-9 /-]+ ---$/;

function untruncatedReportLength(lines: Array<string | null | undefined>): number {
  return lines
    .filter((line): line is string => Boolean(line))
    .map((line) => {
      const trimmed = line.trim();
      return OWNED_SECTION_LINE.test(trimmed)
        ? trimmed
        : reportField(line, REPORT_MAX_LENGTH);
    })
    .join("\n").length;
}

function sectionLines(section: OptionalDetailSectionState): string[] {
  const omitted = section.items.length - section.included.length;
  return [
    "",
    section.title,
    ...(section.requiredLines ?? []),
    ...section.included,
    ...(omitted > 0
      ? [
          `· ${omitted} more ${section.itemName}${omitted === 1 ? "" : "s"} omitted to keep the return and overdue instructions on this card.`,
        ]
      : []),
  ];
}

/**
 * Fit optional, user-sized lists into the report without ever displacing the
 * fixed return deadline, silence disclaimer, or overdue instructions.
 */
function boundedOptionalDetails(
  coreLines: Array<string | null | undefined>,
  sections: OptionalDetailSection[],
): string[] {
  const active: OptionalDetailSectionState[] = sections
    .filter((section) => section.items.length > 0)
    .map((section) => ({ ...section, included: [] }));
  if (active.length === 0) return [];

  const flatten = (states: OptionalDetailSectionState[]) => states.flatMap(sectionLines);
  const base = flatten(active);
  if (untruncatedReportLength([...coreLines, ...base]) > REPORT_MAX_LENGTH) {
    const omitted = active.reduce((total, section) => total + section.items.length, 0);
    return [
      "",
      "--- ADDITIONAL PLAN DETAILS OMITTED ---",
      `· ${omitted} optional route detail${omitted === 1 ? "" : "s"} omitted to keep the return and overdue instructions on this card.`,
    ];
  }

  const nextIndex = new Array(active.length).fill(0) as number[];
  let candidatesRemain = true;
  while (candidatesRemain) {
    candidatesRemain = false;
    for (let sectionIndex = 0; sectionIndex < active.length; sectionIndex += 1) {
      const section = active[sectionIndex];
      const itemIndex = nextIndex[sectionIndex];
      if (itemIndex >= section.items.length) continue;
      candidatesRemain = true;
      nextIndex[sectionIndex] += 1;

      const candidate = active.map((state, index) => ({
        ...state,
        included: index === sectionIndex
          ? [...state.included, state.items[itemIndex]]
          : state.included,
      }));
      if (untruncatedReportLength([...coreLines, ...flatten(candidate)]) <= REPORT_MAX_LENGTH) {
        active[sectionIndex].included.push(section.items[itemIndex]);
      }
    }
  }
  return flatten(active);
}

/** Printable itinerary for a home contact — not a live GPS sheet and not a SAR handoff. */
export function formatLeaveBehindCard(input: {
  trailName: string;
  profile: IceProfile;
  returnAt?: string | null;
  geometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  vehicle?: string | null;
  notes?: string | null;
  plannedDate?: string | null;
  departureTime?: string | null;
  waypoints?: LeaveBehindLocation[] | null;
  bailouts?: LeaveBehindLocation[] | null;
  routeFacts?: LeaveBehindRouteFact[] | null;
  /** The stored local form of the deadline, so the card can print it. */
  returnLocal?: StoredDeadlineLocal | null;
  now?: Date;
}): string {
  const ends = routeEnds(input.geometry);
  const deadline = input.returnAt && Number.isFinite(Date.parse(input.returnAt))
    ? new Date(input.returnAt)
    : null;
  const status = guardianStatus(input.now ?? new Date(), deadline);
  const date = plannedDateOnly(input.plannedDate);
  const departure = planningTime(input.departureTime);
  const waypoints = input.waypoints ?? [];
  const bailouts = input.bailouts ?? [];
  const routeFacts = input.routeFacts ?? [];
  const coreLines: Array<string | null | undefined> = [
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
    "--- RETURN ---",
    date
      ? `Planned date: ${reportField(formatPlannedDate(date, "full"))}`
      : "Planned date: (not set)",
    departure
      ? `Planned departure: ${reportField(departure)} (time entered on this device)`
      : "Planned departure: (not set)",
    deadline
      ? `Call for help if not heard from by: ${reportField(formatDeadlineForPerson(deadline, input.returnLocal))}`
      : "Agreed overdue-action time: (not set — do not treat silence as an emergency)",
    // The countdown is relative to the moment of printing. On a sheet of paper
    // that someone reads hours or days later it is not just useless, it is
    // misleading — so it is labeled, not printed bare.
    deadline ? `(as of printing: ${reportField(status.message)})` : reportField(status.message),
    LEAVE_BEHIND_DISCLAIMER,
    "",
    "--- IF THEY ARE OVERDUE ---",
    ...missedCheckInPolicy().map((line) => `· ${line}`),
    "",
    "--- ITINERARY ---",
    `Route: ${reportField(input.trailName)}`,
    ends.west ? `West end: ${ends.west}` : null,
    ends.east ? `East end: ${ends.east}` : null,
    "Which end the party started from is not assumed — ask before directing SAR.",
    input.vehicle ? `Vehicle: ${reportField(input.vehicle)}` : "Vehicle: (not set)",
    input.notes ? `Notes: ${reportField(input.notes)}` : null,
  ];
  const optionalLines = boundedOptionalDetails(coreLines, [
    {
      title: "--- ROUTE FACTS ---",
      itemName: "route fact",
      items: routeFacts.map((fact) =>
        `· ${reportField(fact.label)}: ${reportField(fact.value)}${
          fact.basis ? ` (${reportField(fact.basis)})` : ""
        }`
      ),
    },
    {
      title: "--- NAMED WAYPOINTS ---",
      itemName: "named waypoint",
      items: waypoints.map(locationLine),
    },
    {
      title: "--- BAILOUT CANDIDATES / VERIFY BEFORE TRIP ---",
      itemName: "bailout candidate",
      requiredLines: [
        "A saved candidate or nearby mapped feature does not prove a usable exit. Verify it before departure.",
      ],
      items: bailouts.map(locationLine),
    },
  ]);
  return formatReport([...coreLines, ...optionalLines]);
}
