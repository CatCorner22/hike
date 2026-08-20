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

function isValidUtmLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -80 && lat <= 84 && lng >= -180 && lng <= 180;
}

export function latitudeBand(lat: number): string | null {
  if (!Number.isFinite(lat) || lat < -80 || lat > 84) return null;
  const index = Math.min(BANDS.length - 1, Math.floor((lat + 80) / 8));
  return BANDS[index];
}

export function utmZone(lat: number, lng: number): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  // +180 is the eastern boundary of zone 60. The conversion formula below
  // uses its zone-60 central meridian, never the nonexistent zone 61.
  if (lng === 180) return 60;
  let zone = Math.floor((lng + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lng >= 0 && lng < 9) zone = 31;
    else if (lng >= 9 && lng < 21) zone = 33;
    else if (lng >= 21 && lng < 33) zone = 35;
    else if (lng >= 33 && lng < 42) zone = 37;
  }
  return zone >= 1 && zone <= 60 ? zone : null;
}

export function latLngToUtm(lat: number, lng: number): UtmCoord | null {
  if (!isValidUtmLatLng(lat, lng)) return null;
  const zone = utmZone(lat, lng);
  const band = latitudeBand(lat);
  if (zone == null || band == null) return null;
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
    band,
    easting,
    northing,
    north: lat >= 0,
  };
}

export function formatUtm(lat: number, lng: number): string | null {
  const u = latLngToUtm(lat, lng);
  if (!u) return null;
  const hemi = u.north ? "N" : "S";
  return `${u.zone}${hemi} ${Math.round(u.easting)} ${Math.round(u.northing)}`;
}

export function formatUsng(lat: number, lng: number, digits = 4): string | null {
  if (!Number.isInteger(digits) || digits < 1 || digits > 5) return null;
  const u = latLngToUtm(lat, lng);
  if (!u) return null;
  const { col, row } = squareLetters(u);
  const e = Math.floor(u.easting % 100000);
  const n = Math.floor(u.northing % 100000);
  const factor = 10 ** (5 - digits);
  const eStr = String(Math.floor(e / factor)).padStart(digits, "0");
  const nStr = String(Math.floor(n / factor)).padStart(digits, "0");
  return `${u.zone}${u.band} ${col}${row} ${eStr} ${nStr}`;
}

export function formatMgrs10(lat: number, lng: number): string | null {
  return formatUsng(lat, lng, 5);
}

function squareLetters(u: UtmCoord) {
  const colSet = (u.zone - 1) % 3;
  const colIndex = Math.floor(u.easting / 100000) - 1;
  const col = COLS[colSet * 8 + colIndex] ?? "A";
  const rowOffset = u.zone % 2 === 1 ? 0 : 5;
  const rowIndex = (Math.floor(u.northing / 100000) + rowOffset) % 20;
  const row = ROWS[rowIndex] ?? "A";
  return { col, row };
}

export function utmToLatLng(u: {
  zone: number;
  easting: number;
  northing: number;
  north: boolean;
}): { lat: number; lng: number } {
  const x = u.easting - 500000;
  let y = u.northing;
  if (!u.north) y -= 10_000_000;
  const lon0 = (((u.zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const m = y / K0;
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const n1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2);
  const t1 = Math.tan(phi1) ** 2;
  const c1 = EP2 * Math.cos(phi1) ** 2;
  const r1 = (A * (1 - E2)) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5;
  const d = x / (n1 * K0);
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * EP2 - 3 * c1 ** 2) * d ** 6) /
          720);
  const lng =
    lon0 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * EP2 + 24 * t1 ** 2) * d ** 5) / 120) /
      Math.cos(phi1);
  return { lat: (lat * 180) / Math.PI, lng: (lng * 180) / Math.PI };
}

export function parseUsng(
  text: string,
  hint?: { lat: number; lng: number },
): { lat: number; lng: number } | null {
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/^(\d{1,2})([C-HJ-NP-X])([A-Z]{2})(\d{2,10})$/);
  if (!match) return null;
  const zone = Number(match[1]);
  if (zone < 1 || zone > 60) return null;
  const band = match[2];
  const col = match[3][0];
  const row = match[3][1];
  const digits = match[4];
  if (digits.length % 2 !== 0) return null;
  const half = digits.length / 2;
  const ePart = digits.slice(0, half).padEnd(5, "5");
  const nPart = digits.slice(half).padEnd(5, "5");

  const colSet = (zone - 1) % 3;
  const colIndex = COLS.indexOf(col) - colSet * 8;
  if (colIndex < 0 || colIndex > 7) return null;
  const easting = (colIndex + 1) * 100000 + Number(ePart);

  const rowOffset = zone % 2 === 1 ? 0 : 5;
  const rowIndex = ROWS.indexOf(row);
  if (rowIndex < 0) return null;
  const northingMod = ((rowIndex - rowOffset + 20) % 20) * 100000 + Number(nPart);

  const north = band >= "N";
  const hintUtm = hint ? latLngToUtm(hint.lat, hint.lng) : null;
  let northing = northingMod;
  if (hintUtm && hintUtm.zone === zone) {
    const base = Math.floor(hintUtm.northing / 2_000_000) * 2_000_000;
    northing = base + northingMod;
    if (Math.abs(northing - hintUtm.northing) > 1_000_000) {
      northing = northingMod < hintUtm.northing ? base + 2_000_000 + northingMod : base - 2_000_000 + northingMod;
    }
  } else {
    const bandMin = (BANDS.indexOf(band) * 8 - 80) * 111320;
    northing = northingMod;
    while (north && northing < bandMin - 500000) northing += 2_000_000;
  }

  return utmToLatLng({ zone, easting, northing, north });
}

export function formatDms(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return "—";
  return `${toDms(lat, "N", "S")} ${toDms(lng, "E", "W")}`;
}

export function formatDdm(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return "—";
  return `${toDdm(lat, "N", "S")} ${toDdm(lng, "E", "W")}`;
}

function toDms(value: number, pos: string, neg: string) {
  const hemi = value >= 0 ? pos : neg;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return `${deg}°${String(min).padStart(2, "0")}'${sec.toFixed(1)}"${hemi}`;
}

function toDdm(value: number, pos: string, neg: string) {
  const hemi = value >= 0 ? pos : neg;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${deg}°${min.toFixed(3)}'${hemi}`;
}

const NATO: Record<string, string> = {
  A: "Alfa",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Echo",
  F: "Foxtrot",
  G: "Golf",
  H: "Hotel",
  I: "India",
  J: "Juliett",
  K: "Kilo",
  L: "Lima",
  M: "Mike",
  N: "November",
  O: "Oscar",
  P: "Papa",
  Q: "Quebec",
  R: "Romeo",
  S: "Sierra",
  T: "Tango",
  U: "Uniform",
  V: "Victor",
  W: "Whiskey",
  X: "X-ray",
  Y: "Yankee",
  Z: "Zulu",
  "0": "Zero",
  "1": "One",
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Niner",
};

export function phonetic(text: string): string {
  return text
    .toUpperCase()
    .split("")
    .map((ch) => (ch === " " ? " " : (NATO[ch] ?? ch)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
