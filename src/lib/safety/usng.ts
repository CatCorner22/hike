/** WGS84 → UTM / USNG. USNG is what most U.S. SAR teams ask for. */

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);

const BANDS = "CDEFGHJKLMNPQRSTUVWX";
const COLS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROWS = "ABCDEFGHJKLMNPQRSTUV";

export interface UtmCoord {
  zone: number;
  band: string;
  easting: number;
  northing: number;
  north: boolean;
}

export function latitudeBand(lat: number): string {
  if (lat < -80 || lat > 84) return lat >= 84 ? "X" : "C";
  const index = Math.min(BANDS.length - 1, Math.floor((lat + 80) / 8));
  return BANDS[index];
}

export function utmZone(lat: number, lng: number): number {
  let zone = Math.floor((lng + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lng >= 0 && lng < 9) zone = 31;
    else if (lng >= 9 && lng < 21) zone = 33;
    else if (lng >= 21 && lng < 33) zone = 35;
    else if (lng >= 33 && lng < 42) zone = 37;
  }
  return zone;
}

export function latLngToUtm(lat: number, lng: number): UtmCoord {
  const zone = utmZone(lat, lng);
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const lon0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const n = A / Math.sqrt(1 - E2 * Math.sin(latRad) ** 2);
  const t = Math.tan(latRad) ** 2;
  const c = EP2 * Math.cos(latRad) ** 2;
  const a = Math.cos(latRad) * (lngRad - lon0);
  const m =
    A *
    ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * latRad -
      ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * latRad) +
      ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * latRad));

  const easting =
    K0 *
      n *
      (a +
        ((1 - t + c) * a ** 3) / 6 +
        ((5 - 18 * t + t ** 2 + 72 * c - 58 * EP2) * a ** 5) / 120) +
    500000;

  let northing =
    K0 *
    (m +
      n *
        Math.tan(latRad) *
        (a ** 2 / 2 +
          ((5 - t + 9 * c + 4 * c ** 2) * a ** 4) / 24 +
          ((61 - 58 * t + t ** 2 + 600 * c - 330 * EP2) * a ** 6) / 720));
  if (lat < 0) northing += 10_000_000;

  return {
    zone,
    band: latitudeBand(lat),
    easting,
    northing,
    north: lat >= 0,
  };
}

export function formatUtm(lat: number, lng: number): string {
  const u = latLngToUtm(lat, lng);
  const hemi = u.north ? "N" : "S";
  return `${u.zone}${hemi} ${Math.round(u.easting)} ${Math.round(u.northing)}`;
}

export function formatUsng(lat: number, lng: number, digits = 4): string {
  const u = latLngToUtm(lat, lng);
  const colSet = (u.zone - 1) % 3;
  const colIndex = Math.floor(u.easting / 100000) - 1;
  const col = COLS[colSet * 8 + colIndex] ?? "A";
  const rowOffset = u.zone % 2 === 1 ? 0 : 5;
  const rowIndex = (Math.floor(u.northing / 100000) + rowOffset) % 20;
  const row = ROWS[rowIndex] ?? "A";
  const e = Math.floor(u.easting % 100000);
  const n = Math.floor(u.northing % 100000);
  const factor = 10 ** (5 - digits);
  const eStr = String(Math.floor(e / factor)).padStart(digits, "0");
  const nStr = String(Math.floor(n / factor)).padStart(digits, "0");
  return `${u.zone}${u.band} ${col}${row} ${eStr} ${nStr}`;
}
