import { isValidCoordinate } from "@/lib/geo/coords";

export type Bbox = [number, number, number, number];

export interface Projector {
  /** Longitude/latitude to canvas pixels. */
  toPx: (lng: number, lat: number) => { x: number; y: number };
  /** Canvas pixels per ground metre — identical on both axes. */
  pxPerMetre: number;
}

const M_PER_DEG_LAT = 111_132;
const M_PER_DEG_LNG_EQUATOR = 111_320;

export function metresPerDegreeLongitude(lat: number): number {
  return Math.max(M_PER_DEG_LNG_EQUATOR * Math.cos((lat * Math.PI) / 180), 1);
}

/**
 * Local equal-scale projection for the offline navigation canvas.
 *
 * Mapping longitude straight to x and latitude straight to y — without the cos(latitude)
 * correction, and without matching the bbox aspect to the canvas aspect — distorts every
 * direction read off the map. On a 390x700 phone canvas that measured as a 15° error on a
 * true north-east bearing at 25°N and 12° at 37.7°N, and rendered a 100 m x 100 m ground
 * square at a 0.65 aspect, which also skewed the 100 m UTM grid the SAR readouts assume
 * is square.
 *
 * Here a metre east and a metre north are the same number of pixels, so bearings and
 * shapes on screen match the ground. The bbox is letterboxed into the canvas rather than
 * stretched to fill it.
 */
export function createProjector(
  bbox: Bbox,
  width: number,
  height: number,
  padding: number,
): Projector {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const centreLng = (minLng + maxLng) / 2;
  const centreLat = (minLat + maxLat) / 2;
  const mPerDegLng = metresPerDegreeLongitude(centreLat);

  const spanXm = Math.max((maxLng - minLng) * mPerDegLng, 1);
  const spanYm = Math.max((maxLat - minLat) * M_PER_DEG_LAT, 1);

  const usableWidth = Math.max(width - padding * 2, 1);
  const usableHeight = Math.max(height - padding * 2, 1);
  const pxPerMetre = Math.min(usableWidth / spanXm, usableHeight / spanYm);

  return {
    pxPerMetre,
    toPx: (lng: number, lat: number) => ({
      x: width / 2 + (lng - centreLng) * mPerDegLng * pxPerMetre,
      y: height / 2 - (lat - centreLat) * M_PER_DEG_LAT * pxPerMetre,
    }),
  };
}

/**
 * Follow-mode window around the user that always keeps the given points on screen.
 *
 * A fixed +/-0.003 deg box is only +/-264 m east-west at 37.7 deg N and +/-162 m at
 * 61 deg N, while the off-trail alert escalates to critical at 80 m — so the route could
 * leave the canvas entirely while the banner was still saying to walk back to it.
 */
export function followWindow(
  user: { lat: number; lng: number },
  mustInclude: Array<{ lat: number; lng: number } | null | undefined> = [],
  minRadiusDeg = 0.003,
): Bbox | null {
  if (!isValidCoordinate(user) || !Number.isFinite(minRadiusDeg) || minRadiusDeg <= 0 || minRadiusDeg > 180) {
    return null;
  }
  let latRadius = minRadiusDeg;
  let lngRadius = minRadiusDeg;
  for (const point of mustInclude) {
    if (!isValidCoordinate(point)) continue;
    // 25% margin so the point sits inside the edge rather than on it.
    latRadius = Math.max(latRadius, Math.abs(point.lat - user.lat) * 1.25);
    lngRadius = Math.max(lngRadius, Math.abs(point.lng - user.lng) * 1.25);
  }
  return [user.lng - lngRadius, user.lat - latRadius, user.lng + lngRadius, user.lat + latRadius];
}
