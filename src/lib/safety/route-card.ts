import * as turf from "@turf/turf";
import { formatRangeAzimuth, rangeAzimuth } from "@/lib/safety/landnav";
import { formatUsng } from "@/lib/safety/usng";

export interface RouteCardLeg {
  index: number;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  meters: number;
  cumMeters: number;
  trueDeg: number;
  grid: string;
}

function segments(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): GeoJSON.Position[][] {
  return geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
}

/** Sample the route into walkable legs using path distance, not flattened chords. */
export function routeCardLegs(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  targetLegM = 250,
  maxLegs = 25,
): RouteCardLeg[] {
  const legs: RouteCardLeg[] = [];
  let cum = 0;
  let pathSinceLeg = 0;
  let legStart: GeoJSON.Position | null = null;

  for (const coords of segments(geometry)) {
    const clean = coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (clean.length < 2) continue;
    if (!legStart) legStart = clean[0];

    for (let i = 1; i < clean.length && legs.length < maxLegs; i++) {
      const step = turf.distance(turf.point(clean[i - 1]), turf.point(clean[i]), {
        units: "meters",
      });
      cum += step;
      pathSinceLeg += step;
      if (pathSinceLeg >= targetLegM || (i === clean.length - 1 && coords === segments(geometry).at(-1))) {
        const from = { lng: legStart[0], lat: legStart[1] };
        const to = { lng: clean[i][0], lat: clean[i][1] };
        const ra = rangeAzimuth(from, to);
        legs.push({
          index: legs.length + 1,
          from,
          to,
          meters: pathSinceLeg,
          cumMeters: cum,
          trueDeg: ra.trueDeg,
          grid: formatUsng(to.lat, to.lng),
        });
        legStart = clean[i];
        pathSinceLeg = 0;
      }
    }
  }
  return legs;
}

export function formatRouteCard(trailName: string, legs: RouteCardLeg[]): string {
  if (legs.length === 0) return "ROUTE CARD — no geometry";
  return [
    `ROUTE CARD — ${trailName}`,
    `Total ~${Math.round(legs[legs.length - 1].cumMeters)} m · ${legs.length} legs · bearings are TRUE`,
    ...legs.map(
      (l) =>
        `L${l.index}  ${Math.round(l.trueDeg)}° true / ${Math.round(l.meters)} m  cum ${Math.round(l.cumMeters)} m  ${l.grid}`,
    ),
    "At each leg: confirm terrain handrail, pace count, and time.",
  ].join("\n");
}

export function legSummary(leg: RouteCardLeg): string {
  return formatRangeAzimuth(rangeAzimuth(leg.from, leg.to)) + ` → ${leg.grid}`;
}
