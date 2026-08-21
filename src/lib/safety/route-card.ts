import * as turf from "@turf/turf";
import { formatRangeAzimuth, rangeAzimuth } from "@/lib/safety/landnav";
import { formatUsng } from "@/lib/safety/usng";
import { formatReport, reportField } from "@/lib/safety/report-field";

export interface RouteCardLeg {
  index: number;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  /** Distance along the trail — what a pace count measures. */
  meters: number;
  /**
   * Straight-line distance from `from` to `to` — what pairs with `trueDeg`.
   *
   * These are two different measurements and on a switchbacked trail they are
   * nowhere near each other, so the card has to print both rather than pair a
   * path distance with a chord bearing and call it one leg.
   */
  chordMeters: number;
  cumMeters: number;
  trueDeg: number;
  grid: string;
}

export interface RouteCardLegList extends Array<RouteCardLeg> {
  /** Full path length, including portions omitted from the printed leg summary. */
  totalMeters: number;
  /** Valid LineString components; MultiLineString components are not connected by a leg. */
  componentCount: number;
  /** True when the printed legs do not cover the complete route. */
  truncated: boolean;
}

function segments(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): GeoJSON.Position[][] {
  return geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
}

/** Sample the route into walkable legs using path distance, not flattened chords. */
export function routeCardLegs(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  targetLegM = 250,
  maxLegs = 25,
): RouteCardLegList {
  const legs = [] as unknown as RouteCardLegList;
  const safeMaxLegs = Number.isFinite(maxLegs) ? Math.max(0, Math.floor(maxLegs)) : 25;
  const safeTargetLegM = Number.isFinite(targetLegM) && targetLegM > 0 ? targetLegM : 250;
  let totalMeters = 0;
  let componentCount = 0;
  const routeSegments = segments(geometry);

  for (const coords of routeSegments) {
    const clean = coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (clean.length < 2) continue;
    componentCount += 1;
    // Each MultiLineString component is an independent route. Carrying this
    // start point into the next component once fabricated a bearing across a
    // gap the hiker cannot walk.
    let legStart = clean[0];
    let pathSinceLeg = 0;

    for (let i = 1; i < clean.length; i++) {
      const step = turf.distance(turf.point(clean[i - 1]), turf.point(clean[i]), {
        units: "meters",
      });
      totalMeters += step;
      pathSinceLeg += step;
      if ((pathSinceLeg >= safeTargetLegM || i === clean.length - 1) && legs.length < safeMaxLegs) {
        const from = { lng: legStart[0], lat: legStart[1] };
        const to = { lng: clean[i][0], lat: clean[i][1] };
        const ra = rangeAzimuth(from, to);
        if (!ra) continue;
        legs.push({
          index: legs.length + 1,
          from,
          to,
          meters: pathSinceLeg,
          chordMeters: ra.meters,
          cumMeters: totalMeters,
          trueDeg: ra.trueDeg,
          grid: formatUsng(to.lat, to.lng) ?? "UNKNOWN",
        });
        legStart = clean[i];
        pathSinceLeg = 0;
      }
    }
  }
  legs.totalMeters = totalMeters;
  legs.componentCount = componentCount;
  legs.truncated =
    legs.length >= safeMaxLegs &&
    totalMeters - (legs[legs.length - 1]?.cumMeters ?? 0) > 0.01;
  return legs;
}

export function formatRouteCard(trailName: string, legs: RouteCardLeg[]): string {
  if (legs.length === 0) return "ROUTE CARD — no geometry";
  const rounded = (value: number) => (Number.isFinite(value) ? String(Math.round(value)) : "UNKNOWN");
  const summary = legs as Partial<RouteCardLegList>;
  const totalMeters = Number.isFinite(summary.totalMeters)
    ? summary.totalMeters!
    : legs[legs.length - 1].cumMeters;
  const truncated = summary.truncated === true;
  const discontinuous = (summary.componentCount ?? 1) > 1;
  return formatReport([
    `ROUTE CARD — ${reportField(trailName)}`,
    `Total ~${rounded(totalMeters)} m along the trail · ${reportField(legs.length)} printed legs · bearings are TRUE`,
    "Each leg: bearing pairs with the STRAIGHT distance; the trail distance is what you pace.",
    truncated ? `LEG SUMMARY ONLY: first ${reportField(legs.length)} legs; total above is the full route.` : null,
    discontinuous
      ? `WARNING: route has ${reportField(summary.componentCount)} disconnected components. No leg crosses a gap; verify every transition.`
      : null,
    ...legs.map((l) => {
      // A leg that curves has a path distance longer than its chord. Printing only
      // the path distance beside the chord bearing told a searcher plotting these
      // legs to draw each one too long — 44% too long on a switchbacked trail,
      // compounding over every leg on the sheet.
      const chord = Number.isFinite(l.chordMeters) ? l.chordMeters : null;
      const bends = chord != null && l.meters - chord > Math.max(10, chord * 0.05);
      const distance =
        chord == null
          ? `${rounded(l.meters)} m`
          : bends
            ? `${rounded(chord)} m straight (${rounded(l.meters)} m along the trail)`
            : `${rounded(chord)} m`;
      return `L${reportField(l.index)}  ${rounded(l.trueDeg)}° true / ${distance}  cum ${rounded(l.cumMeters)} m  ${reportField(l.grid)}`;
    }),
    "At each leg: confirm terrain handrail, pace count, and time.",
  ]);
}

export function legSummary(leg: RouteCardLeg): string {
  return formatRangeAzimuth(rangeAzimuth(leg.from, leg.to)) + ` → ${reportField(leg.grid)}`;
}
