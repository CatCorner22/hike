import { deadReckon } from "@/lib/safety/landnav";
import { formatReport, reportField } from "@/lib/safety/report-field";

export interface SearchLeg {
  headingTrue: number;
  meters: number;
  cumMeters: number;
}

/**
 * Expanding-square search from a last-known point (SAR standard pattern).
 * Leg length grows by one leg every two sides: L, L, 2L, 2L, 3L, 3L…
 */
export function expandingSquareLegs(legM: number, rings = 3): SearchLeg[] {
  const legs: SearchLeg[] = [];
  let heading = 0; // north first
  let cum = 0;
  for (let ring = 1; ring <= rings; ring++) {
    const dist = legM * ring;
    for (let side = 0; side < 2; side++) {
      cum += dist;
      legs.push({ headingTrue: heading, meters: dist, cumMeters: cum });
      heading = (heading + 90) % 360;
    }
  }
  return legs;
}

export function expandingSquareLine(
  center: { lat: number; lng: number },
  legM: number,
  rings = 3,
): GeoJSON.LineString {
  const coords: GeoJSON.Position[] = [[center.lng, center.lat]];
  let here = center;
  for (const leg of expandingSquareLegs(legM, rings)) {
    here = deadReckon(here, leg.headingTrue, leg.meters);
    coords.push([here.lng, here.lat]);
  }
  return { type: "LineString", coordinates: coords };
}

/** 120° sector sweep — three legs from the LKP on 0 / 120 / 240° (adjust with base heading). */
export function sectorSearchLegs(
  legM: number,
  baseHeading = 0,
  spokes = 3,
): SearchLeg[] {
  const legs: SearchLeg[] = [];
  let cum = 0;
  for (let i = 0; i < spokes; i++) {
    const heading = (baseHeading + (360 / spokes) * i) % 360;
    cum += legM;
    legs.push({ headingTrue: heading, meters: legM, cumMeters: cum });
  }
  return legs;
}

export function sectorSearchLine(
  center: { lat: number; lng: number },
  legM: number,
  baseHeading = 0,
  spokes = 3,
): GeoJSON.LineString {
  const coords: GeoJSON.Position[] = [[center.lng, center.lat]];
  const here = center;
  for (const leg of sectorSearchLegs(legM, baseHeading, spokes)) {
    const tip = deadReckon(here, leg.headingTrue, leg.meters);
    coords.push([tip.lng, tip.lat]);
    coords.push([here.lng, here.lat]);
  }
  return { type: "LineString", coordinates: coords };
}

/**
 * Creeping-line search: sweep a corridor (lost along a trail / drainage).
 * Alternate headings along the axis, offset by search width each pass.
 */
export function creepingLineLegs(
  lengthM: number,
  widthM: number,
  passes = 4,
  axisHeading = 0,
): SearchLeg[] {
  const legs: SearchLeg[] = [];
  let cum = 0;
  const right = (axisHeading + 90) % 360;
  const left = (axisHeading + 270) % 360;
  for (let i = 0; i < passes; i++) {
    const along = i % 2 === 0 ? axisHeading : (axisHeading + 180) % 360;
    cum += lengthM;
    legs.push({ headingTrue: along, meters: lengthM, cumMeters: cum });
    if (i < passes - 1) {
      cum += widthM;
      legs.push({ headingTrue: i % 2 === 0 ? right : left, meters: widthM, cumMeters: cum });
    }
  }
  return legs;
}

export function parallelTrackLegs(
  lengthM: number,
  spacingM: number,
  tracks = 3,
  axisHeading = 0,
): SearchLeg[] {
  const legs: SearchLeg[] = [];
  let cum = 0;
  const right = (axisHeading + 90) % 360;
  for (let i = 0; i < tracks; i++) {
    const along = i % 2 === 0 ? axisHeading : (axisHeading + 180) % 360;
    cum += lengthM;
    legs.push({ headingTrue: along, meters: lengthM, cumMeters: cum });
    if (i < tracks - 1) {
      cum += spacingM;
      legs.push({ headingTrue: right, meters: spacingM, cumMeters: cum });
    }
  }
  return legs;
}

export function searchLineFromLegs(
  start: { lat: number; lng: number },
  legs: SearchLeg[],
): GeoJSON.LineString {
  const coords: GeoJSON.Position[] = [[start.lng, start.lat]];
  let here = start;
  for (const leg of legs) {
    here = deadReckon(here, leg.headingTrue, leg.meters);
    coords.push([here.lng, here.lat]);
  }
  return { type: "LineString", coordinates: coords };
}

export function formatSearchPlan(name: string, legs: SearchLeg[]): string {
  const rounded = (value: number) => (Number.isFinite(value) ? String(Math.round(value)) : "UNKNOWN");
  return formatReport([
    `SEARCH PLAN — ${reportField(name).toUpperCase()} SEARCH`,
    ...legs.map(
      (l, i) =>
        `L${i + 1}  ${rounded(l.headingTrue)}° / ${rounded(l.meters)} m  (cum ${rounded(l.cumMeters)} m)`,
    ),
    "Mark trail tape / cairns at each corner. Yell and listen between legs.",
  ]);
}
