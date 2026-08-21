import { deadReckon } from "@/lib/safety/landnav";
import { isValidCoordinate } from "@/lib/geo/coords";
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
): GeoJSON.LineString | null {
  if (!isValidCoordinate(center) || !Number.isFinite(legM) || legM <= 0 || !Number.isInteger(rings) || rings < 1) {
    return null;
  }
  const coords: GeoJSON.Position[] = [[center.lng, center.lat]];
  let here = center;
  for (const leg of expandingSquareLegs(legM, rings)) {
    const next = deadReckon(here, leg.headingTrue, leg.meters);
    if (!next) return null;
    here = next;
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

/**
 * The sector pattern as a line.
 *
 * This drew an out-and-back star centred on the datum, while the panel plots the
 * same legs through `searchLineFromLegs`, which chains them into the equilateral
 * triangle off the datum that the pattern actually is. Two exported functions
 * disagreeing about what "sector search" draws is a trap for whoever wires this
 * up next, so it now chains too and there is one answer.
 */
export function sectorSearchLine(
  center: { lat: number; lng: number },
  legM: number,
  baseHeading = 0,
  spokes = 3,
): GeoJSON.LineString | null {
  return searchLineFromLegs(center, sectorSearchLegs(legM, baseHeading, spokes));
}

/**
 * Back-and-forth sweep: run the leg, step sideways by one track spacing, run it
 * back, step sideways again. The step is always the *same* way, or the pattern
 * does not advance.
 *
 * Both named patterns below are this shape. They differ in how the caller picks
 * the axis — creeping line runs its legs across the search area's long axis and
 * creeps along it, parallel track runs them along it — not in the geometry, so
 * they share one implementation rather than two that can drift apart.
 */
function sweepLegs(lengthM: number, spacingM: number, runs: number, axisHeading: number): SearchLeg[] {
  const legs: SearchLeg[] = [];
  let cum = 0;
  const across = (axisHeading + 90) % 360;
  for (let i = 0; i < runs; i++) {
    const along = i % 2 === 0 ? axisHeading : (axisHeading + 180) % 360;
    cum += lengthM;
    legs.push({ headingTrue: along, meters: lengthM, cumMeters: cum });
    if (i < runs - 1) {
      cum += spacingM;
      legs.push({ headingTrue: across, meters: spacingM, cumMeters: cum });
    }
  }
  return legs;
}

/**
 * Creeping-line search: sweep a corridor (lost along a trail / drainage).
 *
 * This used to alternate the sideways step right, then left, then right — which
 * walks straight back onto the track it just left. Four passes over a 200 m leg
 * with 50 m spacing covered a **50 m** corridor instead of 150 m; six passes
 * still covered 50 m instead of 250 m. The searcher walked the full 1 450 m,
 * re-walking two tracks three times, and the plan reported a swept corridor
 * several times wider than anything that had been looked at. In the panel that
 * is `creepingLineLegs(L * 3, L, 4)`, so choosing "creeping line" with a 100 m
 * leg searched a third of the ground it claimed and reported the drainage clear.
 */
export function creepingLineLegs(
  lengthM: number,
  widthM: number,
  passes = 4,
  axisHeading = 0,
): SearchLeg[] {
  return sweepLegs(lengthM, widthM, passes, axisHeading);
}

export function parallelTrackLegs(
  lengthM: number,
  spacingM: number,
  tracks = 3,
  axisHeading = 0,
): SearchLeg[] {
  return sweepLegs(lengthM, spacingM, tracks, axisHeading);
}

export function searchLineFromLegs(
  start: { lat: number; lng: number },
  legs: SearchLeg[],
): GeoJSON.LineString | null {
  if (!isValidCoordinate(start)) return null;
  const coords: GeoJSON.Position[] = [[start.lng, start.lat]];
  let here = start;
  for (const leg of legs) {
    const next = deadReckon(here, leg.headingTrue, leg.meters);
    if (!next) return null;
    here = next;
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
