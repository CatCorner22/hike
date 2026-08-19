import { deadReckon } from "@/lib/safety/landnav";

export interface SearchLeg {
  headingTrue: number;
  meters: number;
  cumMeters: number;
}

/**
 * Expanding-square search from a last-known point (SAR standard pattern).
 * Leg length doubles every two sides: L, L, 2L, 2L, 3L, 3L…
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
  let here = center;
  for (const leg of sectorSearchLegs(legM, baseHeading, spokes)) {
    const tip = deadReckon(here, leg.headingTrue, leg.meters);
    coords.push([tip.lng, tip.lat]);
    coords.push([here.lng, here.lat]);
  }
  return { type: "LineString", coordinates: coords };
}

export function formatSearchPlan(name: string, legs: SearchLeg[]): string {
  return [
    `${name.toUpperCase()} SEARCH`,
    ...legs.map(
      (l, i) =>
        `L${i + 1}  ${Math.round(l.headingTrue)}° / ${Math.round(l.meters)} m  (cum ${Math.round(l.cumMeters)} m)`,
    ),
    "Mark trail tape / cairns at each corner. Yell and listen between legs.",
  ].join("\n");
}
