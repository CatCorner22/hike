import { deadReckon } from "@/lib/safety/landnav";
import { formatMgrs10, formatUsng, latLngToUtm, parseUsng, utmToLatLng, type UtmCoord } from "@/lib/safety/usng";
import { formatReport, reportField } from "@/lib/safety/report-field";

export type GridScaleM = 100 | 1000 | 10_000 | 100_000;

export interface GridSquareBounds {
  /** 100 km MGRS square designator, e.g. 11S KD */
  hundredKmId: string;
  /** Full USNG at requested precision */
  grid: string;
  /** SW corner of the cell */
  sw: { lat: number; lng: number };
  /** NE corner of the cell */
  ne: { lat: number; lng: number };
  scaleM: GridScaleM;
}

function hundredKmId(u: UtmCoord): string {
  const colSet = (u.zone - 1) % 3;
  const colIndex = Math.floor(u.easting / 100_000) - 1;
  const COLS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const ROWS = "ABCDEFGHJKLMNPQRSTUV";
  const col = COLS[colSet * 8 + colIndex] ?? "?";
  const rowOffset = u.zone % 2 === 1 ? 0 : 5;
  const rowIndex = (Math.floor(u.northing / 100_000) + rowOffset) % 20;
  const row = ROWS[rowIndex] ?? "?";
  return `${u.zone}${u.band} ${col}${row}`;
}

function snapUtm(u: UtmCoord, scaleM: GridScaleM): { easting: number; northing: number } {
  const e = Math.floor(u.easting / scaleM) * scaleM;
  const n = Math.floor(u.northing / scaleM) * scaleM;
  return { easting: e, northing: n };
}

function utmCorner(u: UtmCoord, easting: number, northing: number): { lat: number; lng: number } | null {
  return utmToLatLng({
    zone: u.zone,
    easting,
    northing,
    north: u.north,
  });
}

/** Bounds of the MGRS/USNG grid cell containing a point. */
export function gridSquareBounds(
  lat: number,
  lng: number,
  scaleM: GridScaleM = 1000,
): GridSquareBounds | null {
  const u = latLngToUtm(lat, lng);
  if (!u) return null;
  const { easting, northing } = snapUtm(u, scaleM);
  const sw = utmCorner(u, easting, northing);
  const ne = utmCorner(u, easting + scaleM, northing + scaleM);
  if (!sw || !ne) return null;
  const digits = scaleM >= 10_000 ? 2 : scaleM >= 1000 ? 3 : scaleM >= 100 ? 4 : 5;
  const grid = formatUsng(lat, lng, digits as 2 | 3 | 4 | 5) ?? formatMgrs10(lat, lng) ?? "UNKNOWN";
  return {
    hundredKmId: hundredKmId(u),
    grid,
    sw,
    ne,
    scaleM,
  };
}

/** Neighboring grid cells (N/E/S/W) for land-nav confirmation. */
export function adjacentGridSquares(
  lat: number,
  lng: number,
  scaleM: GridScaleM = 1000,
): Array<{ direction: string; grid: string }> {
  const center = gridSquareBounds(lat, lng, scaleM);
  if (!center) return [];
  const midLat = (center.sw.lat + center.ne.lat) / 2;
  const midLng = (center.sw.lng + center.ne.lng) / 2;
  const half = scaleM / 2;
  const offsets: Array<[string, number, number]> = [
    ["N", 0, half * 1.1],
    ["E", 90, half * 1.1],
    ["S", 180, half * 1.1],
    ["W", 270, half * 1.1],
  ];
  return offsets.flatMap(([direction, bearing, dist]) => {
    const p = deadReckon({ lat: midLat, lng: midLng }, bearing, dist);
    if (!p) return [];
    const digits = scaleM >= 10_000 ? 2 : scaleM >= 1000 ? 3 : 4;
    const grid = formatUsng(p.lat, p.lng, digits as 2 | 3 | 4) ?? "UNKNOWN";
    return [{ direction, grid }];
  });
}

export function mgrsGridTips(): string[] {
  return [
    "100 km square (two letters) — identify on map before counting digits.",
    "1 km grid: add 3 digits east + 3 digits north (within the square).",
    "100 m precision: 4 digits each — what most SAR teams want on the radio.",
    "10 m precision: 5 digits each — plot with protractor or GPS.",
    "Always read grid right-to-left on the map: easting, then northing.",
    "Confirm zone + band letter — a wrong zone sends rescuers to another state.",
  ];
}

export function formatMgrsGridCard(lat: number, lng: number): string {
  const km = gridSquareBounds(lat, lng, 1000);
  const hundred = gridSquareBounds(lat, lng, 100_000);
  const neighbors = adjacentGridSquares(lat, lng, 1000);
  return formatReport([
    "MGRS / USNG GRID SQUARE",
    hundred ? `100 km square: ${reportField(hundred.hundredKmId)}` : null,
    km ? `1 km cell: ${reportField(km.grid)}` : null,
    formatMgrs10(lat, lng) ? `10 m plot: ${reportField(formatMgrs10(lat, lng))}` : null,
    neighbors.length > 0
      ? `Adjacent 1 km: ${neighbors.map((n) => `${n.direction}=${reportField(n.grid)}`).join(" · ")}`
      : null,
    ...mgrsGridTips().map((t) => `· ${t}`),
  ]);
}

/** Parse a typed grid and return the cell center (for go-to). */
export function gridCellCenter(text: string, hint?: { lat: number; lng: number }): { lat: number; lng: number } | null {
  return parseUsng(text, hint);
}
