/**
 * A coarse elevation grid over the route corridor, and the shading drawn from it.
 *
 * The offline map has never had terrain. It draws the route, the track and the
 * nearby OSM vectors on a blank canvas: no contours, no relief, no imagery — so
 * a hiker deciding whether the ground between them and the trail is a slope or a
 * cliff has been getting no help from the screen. The roadmap has conceded that
 * for a while; every honest fix so far has been a sentence admitting it.
 *
 * Terrain tiles from a commercial provider would be the complete answer and are
 * a different project: licence terms for offline caching, tens of megabytes per
 * route, and a real renderer. This is the part that can be done with what the
 * app already has. It already fetches elevation along the route from
 * open-elevation; asking the same service for a grid over the corridor costs two
 * or three more requests and about ten kilobytes in the pack, and it is enough
 * to see where the ridges and the drainages are.
 *
 * It is emphatically NOT a topo map, and the code and the UI both say so. At the
 * spacing below, a cliff narrower than the sample spacing does not exist as far
 * as this grid is concerned.
 */

export interface TerrainGrid {
  /** [minLng, minLat, maxLng, maxLat] — the same order as everything else in this app. */
  bbox: [number, number, number, number];
  cols: number;
  rows: number;
  /**
   * Row-major, north row first, `cols * rows` entries. Metres above sea level;
   * null where the service had no answer, which is a real state near coasts and
   * outside coverage.
   */
  elevations: Array<number | null>;
  /** Ground distance between neighbouring samples, at the middle of the grid. */
  spacingMeters: number;
  source: string;
  fetchedAt: string;
}

/** Never ask for more than this: open-elevation takes 500 locations per request. */
export const TERRAIN_SAMPLES_PER_REQUEST = 500;

/**
 * The ceiling on a grid, in samples.
 *
 * Three requests to a free public service is as much as this app is willing to
 * spend on one route pack, and 1,200 doubles as a storage bound: at eight bytes
 * a number it is under ten kilobytes, which is nothing beside the route itself.
 */
export const TERRAIN_MAX_SAMPLES = 1_200;

/**
 * The finest spacing worth claiming.
 *
 * Below about a hundred metres this grid would look like a survey and would not
 * be one — open-elevation serves roughly 30 m SRTM/ASTER data, and interpolating
 * a coarse grid off it invites exactly the false confidence the rest of this app
 * spends its time removing.
 */
export const TERRAIN_MIN_SPACING_M = 100;

const EARTH_RADIUS_M = 6_371_000;

function metersPerDegreeLat(): number {
  return (Math.PI / 180) * EARTH_RADIUS_M;
}

function metersPerDegreeLng(latDeg: number): number {
  return (Math.PI / 180) * EARTH_RADIUS_M * Math.cos((latDeg * Math.PI) / 180);
}

export interface TerrainGridPlan {
  cols: number;
  rows: number;
  spacingMeters: number;
  points: Array<{ lat: number; lng: number }>;
}

/**
 * Where to sample, for a given corridor.
 *
 * Keeps the cells roughly square on the ground — a grid laid out in degrees is
 * stretched east-west by the cosine of the latitude, and at 60°N that is a
 * factor of two, which would shade the relief wrong. Returns null when the box
 * is unusable rather than sampling a degenerate strip.
 */
export function planTerrainGrid(
  bbox: [number, number, number, number],
  maxSamples = TERRAIN_MAX_SAMPLES,
): TerrainGridPlan | null {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
  if (maxLat <= minLat || maxLng <= minLng) return null;
  if (minLat < -85 || maxLat > 85) return null;
  if (!Number.isFinite(maxSamples) || maxSamples < 4) return null;

  const midLat = (minLat + maxLat) / 2;
  const widthM = (maxLng - minLng) * metersPerDegreeLng(midLat);
  const heightM = (maxLat - minLat) * metersPerDegreeLat();
  if (!(widthM > 0) || !(heightM > 0)) return null;

  // Spacing that fills the sample budget with roughly square cells, then floored
  // so the grid never claims to be finer than the source can support.
  const area = widthM * heightM;
  const spacing = Math.max(TERRAIN_MIN_SPACING_M, Math.sqrt(area / maxSamples));
  // Two rows and two columns are the floor — a single line of samples has no
  // cross-slope to shade — so the column count has to leave room for them.
  // Clamping rows to `maxSamples / cols` after the fact does not: a long thin
  // corridor (an out-and-back ridge walk is exactly that shape) produced 617
  // columns, floored to 2 rows, and 1,234 samples against a budget of 1,200.
  const cols = Math.max(2, Math.min(Math.floor(widthM / spacing) + 1, Math.floor(maxSamples / 2)));
  const rows = Math.max(2, Math.min(Math.floor(heightM / spacing) + 1, Math.floor(maxSamples / cols)));
  if (cols * rows < 4 || cols * rows > maxSamples) return null;

  const points: Array<{ lat: number; lng: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    // North row first, which is how the grid is drawn and how it is stored.
    const lat = maxLat - (row / (rows - 1)) * (maxLat - minLat);
    for (let col = 0; col < cols; col += 1) {
      const lng = minLng + (col / (cols - 1)) * (maxLng - minLng);
      points.push({ lat, lng });
    }
  }
  return { cols, rows, spacingMeters: Math.round(spacing), points };
}

/** Split a plan into request-sized chunks. */
export function chunkTerrainPoints<T>(points: T[], size = TERRAIN_SAMPLES_PER_REQUEST): T[][] {
  if (!Number.isInteger(size) || size < 1) return [points];
  const chunks: T[][] = [];
  for (let index = 0; index < points.length; index += size) {
    chunks.push(points.slice(index, index + size));
  }
  return chunks;
}

/**
 * A grid is only worth storing if enough of it came back.
 *
 * A half-answered grid shades half the map and leaves the rest blank, which
 * reads as flat ground rather than as missing data — the exact confusion this
 * whole module exists to avoid.
 */
export const TERRAIN_MIN_COVERAGE = 0.8;

export function terrainCoverage(grid: Pick<TerrainGrid, "elevations">): number {
  if (grid.elevations.length === 0) return 0;
  const known = grid.elevations.reduce<number>(
    (total, value) => total + (value == null || !Number.isFinite(value) ? 0 : 1),
    0,
  );
  return known / grid.elevations.length;
}

/** Structural validation, for a grid arriving from storage rather than from this process. */
export function isUsableTerrainGrid(grid: unknown): grid is TerrainGrid {
  if (!grid || typeof grid !== "object") return false;
  const candidate = grid as Partial<TerrainGrid>;
  if (!Array.isArray(candidate.bbox) || candidate.bbox.length !== 4) return false;
  if (!candidate.bbox.every((value) => typeof value === "number" && Number.isFinite(value))) return false;
  const [minLng, minLat, maxLng, maxLat] = candidate.bbox;
  if (maxLat <= minLat || maxLng <= minLng) return false;
  if (!Number.isInteger(candidate.cols) || !Number.isInteger(candidate.rows)) return false;
  if ((candidate.cols ?? 0) < 2 || (candidate.rows ?? 0) < 2) return false;
  if (!Array.isArray(candidate.elevations)) return false;
  if (candidate.elevations.length !== (candidate.cols ?? 0) * (candidate.rows ?? 0)) return false;
  if (candidate.elevations.length > TERRAIN_MAX_SAMPLES) return false;
  if (
    !candidate.elevations.every(
      (value) => value === null || (typeof value === "number" && Number.isFinite(value)),
    )
  ) {
    return false;
  }
  if (typeof candidate.spacingMeters !== "number" || !(candidate.spacingMeters >= TERRAIN_MIN_SPACING_M)) {
    return false;
  }
  if (typeof candidate.source !== "string" || candidate.source.length === 0) return false;
  if (typeof candidate.fetchedAt !== "string" || Number.isNaN(Date.parse(candidate.fetchedAt))) return false;
  return terrainCoverage(candidate as TerrainGrid) >= TERRAIN_MIN_COVERAGE;
}

/**
 * Relief shading: how brightly each cell faces a light in the north-west.
 *
 * The standard cartographic convention, and the reason it is a convention is
 * that people read north-west lighting as raised and the opposite as sunken. A
 * value of 0 is fully shadowed, 1 fully lit, and null where the grid has no data
 * — which the renderer must draw as nothing, never as flat.
 *
 * Deliberately not contour lines. Contours drawn from samples hundreds of metres
 * apart would look like a survey and would not be one; shading degrades into
 * vagueness instead of into a confident wrong answer.
 */
export function hillshade(
  grid: TerrainGrid,
  options: { azimuthDeg?: number; altitudeDeg?: number; verticalExaggeration?: number } = {},
): Array<number | null> {
  const azimuth = ((options.azimuthDeg ?? 315) * Math.PI) / 180;
  const altitude = ((options.altitudeDeg ?? 45) * Math.PI) / 180;
  const exaggeration = options.verticalExaggeration ?? 1;
  const { cols, rows, elevations, spacingMeters } = grid;
  const shade: Array<number | null> = new Array(cols * rows).fill(null);

  const at = (col: number, row: number): number | null => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    const value = elevations[row * cols + col];
    return value == null || !Number.isFinite(value) ? null : value;
  };

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const centre = at(col, row);
      if (centre == null) continue;
      // Central differences where both neighbours exist, one-sided at the edge.
      const west = at(col - 1, row) ?? centre;
      const east = at(col + 1, row) ?? centre;
      const north = at(col, row - 1) ?? centre;
      const south = at(col, row + 1) ?? centre;
      const runX = (at(col - 1, row) != null && at(col + 1, row) != null ? 2 : 1) * spacingMeters;
      const runY = (at(col, row - 1) != null && at(col, row + 1) != null ? 2 : 1) * spacingMeters;
      const dzdx = ((east - west) / runX) * exaggeration;
      // Row 0 is north, so a positive row step goes south: negate to get dz/dy
      // in a north-up frame.
      const dzdy = ((north - south) / runY) * exaggeration;

      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const value =
        Math.cos(altitude) * Math.sin(slope) * Math.cos(azimuth - aspect)
        + Math.sin(altitude) * Math.cos(slope);
      shade[row * cols + col] = Math.min(1, Math.max(0, value));
    }
  }
  return shade;
}

/**
 * What the map has to say about this grid, beside the shading.
 *
 * Never optional. A shaded map that does not state its sample spacing is a map
 * claiming to be a topo.
 */
export function terrainLegend(grid: TerrainGrid): string {
  return `Relief sketch — ${grid.spacingMeters} m samples, not a topo map. No cliff narrower than that exists here.`;
}
