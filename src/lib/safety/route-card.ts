import * as turf from "@turf/turf";
import { toLineString } from "@/lib/geo/navigation";
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

/** Sample the route into walkable legs for a field route card (max ~25 legs). */
export function routeCardLegs(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  targetLegM = 250,
  maxLegs = 25,
): RouteCardLeg[] {
  const line = toLineString(geometry);
  const coords = line.coordinates.filter(
    (c) => Number.isFinite(c[0]) && Number.isFinite(c[1]),
  );
  if (coords.length < 2) return [];

  const legs: RouteCardLeg[] = [];
  let cum = 0;
  let legStart = coords[0];
  let legStartIdx = 0;

  for (let i = 1; i < coords.length && legs.length < maxLegs; i++) {
    const segLen = turf.distance(turf.point(legStart), turf.point(coords[i]), {
      units: "meters",
    });
    cum += segLen;
    if (cum - (legs[legs.length - 1]?.cumMeters ?? 0) >= targetLegM || i === coords.length - 1) {
      const from = { lng: legStart[0], lat: legStart[1] };
      const to = { lng: coords[i][0], lat: coords[i][1] };
      const ra = rangeAzimuth(from, to);
      legs.push({
        index: legs.length + 1,
        from,
        to,
        meters: ra.meters,
        cumMeters: cum,
        trueDeg: ra.trueDeg,
        grid: formatUsng(to.lat, to.lng),
      });
      legStart = coords[i];
      legStartIdx = i;
      void legStartIdx;
    }
  }
  return legs;
}

export function formatRouteCard(trailName: string, legs: RouteCardLeg[]): string {
  if (legs.length === 0) return "ROUTE CARD — no geometry";
  return [
    `ROUTE CARD — ${trailName}`,
    `Total ~${Math.round(legs[legs.length - 1].cumMeters)} m · ${legs.length} legs`,
    ...legs.map(
      (l) =>
        `L${l.index}  ${Math.round(l.trueDeg)}° / ${Math.round(l.meters)} m  cum ${Math.round(l.cumMeters)} m  ${l.grid}`,
    ),
    "At each leg: confirm terrain handrail, pace count, and time.",
  ].join("\n");
}

export function legSummary(leg: RouteCardLeg): string {
  return formatRangeAzimuth(rangeAzimuth(leg.from, leg.to)) + ` → ${leg.grid}`;
}
