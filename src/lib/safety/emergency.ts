import { formatDdm, formatMgrs10, formatUsng, formatUtm, GRID_DATUM, gridDigitsForAccuracy, phonetic } from "@/lib/safety/usng";
import { formatZulu } from "@/lib/safety/landnav";
import type { IceProfile } from "@/lib/safety/profile";
import { APP_SENT_FROM } from "@/lib/brand";
import { formatReport, reportField } from "@/lib/safety/report-field";
import { isValidCoordinate } from "@/lib/geo/coords";

/**
 * A coordinate is only usable in an emergency message if it is finite and on the
 * globe. `lat != null` used to be the whole check, so a NaN latitude produced
 * "NaN°S, 105.00000°W" and a maps link containing NaN -- a rescuer would be
 * given a position that does not exist.
 */
function usableCoord(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return isValidCoordinate({ lat, lng }) ? { lat, lng } : null;
}

export function formatCoords(lat: number, lng: number, accuracyM?: number): string {
  const point = usableCoord(lat, lng);
  if (!point) return "position unavailable";
  const latDir = point.lat >= 0 ? "N" : "S";
  const lngDir = point.lng >= 0 ? "E" : "W";
  const base = `${Math.abs(point.lat).toFixed(5)}°${latDir}, ${Math.abs(point.lng).toFixed(5)}°${lngDir}`;
  // An unknown accuracy must not render as "±NaN m", which reads as a measured
  // value to anyone receiving the message. Zero is the same mistake wearing a
  // number: CoreLocation and the W3C Geolocation API both use a non-positive
  // accuracy to mean "no valid estimate", and "±0 m" tells a rescuer sizing a
  // search radius that this fix is perfect. Omit the clause instead.
  if (accuracyM != null && Number.isFinite(accuracyM) && accuracyM > 0 && accuracyM <= 10_000) {
    return `${base} (±${Math.round(accuracyM)} m)`;
  }
  return base;
}

export type PositionSource = "gps" | "lastKnown" | "deadReckon";

export function emergencyMessage(input: {
  lat?: number;
  lng?: number;
  accuracyM?: number;
  trailName?: string;
  offTrailM?: number;
  stale?: boolean;
  recordedAt?: number;
  profile?: IceProfile | null;
  partyNote?: string;
  positionSource?: PositionSource;
}): string {
  const source: PositionSource =
    input.positionSource ?? (input.stale ? "lastKnown" : "gps");
  const lines = ["SOS / EMERGENCY LOCATION"];
  const fix = usableCoord(input.lat, input.lng);
  if (fix) {
    if (source === "deadReckon") {
      lines.push("DEAD RECKON POSITION — GPS denied; pace/heading estimate");
    } else if (source === "lastKnown" || input.stale) {
      lines.push("LAST KNOWN POSITION — GPS not live");
    }
    lines.push(formatCoords(fix.lat, fix.lng, input.accuracyM));
    lines.push(`DDM: ${formatDdm(fix.lat, fix.lng)} (${GRID_DATUM})`);
    // A dead-reckoned position is a pace-and-heading estimate; it does not earn
    // metre digits however good the last GPS fix was. Everything else scales to
    // the reported accuracy, so the digit count IS the uncertainty statement —
    // a rescuer reads the digits, not the caveat above them.
    const digits =
      source === "deadReckon"
        ? Math.min(3, gridDigitsForAccuracy(input.accuracyM))
        : gridDigitsForAccuracy(input.accuracyM);
    const metresPerDigit = 10 ** (5 - digits);
    const usng = formatUsng(fix.lat, fix.lng, digits);
    const utm = formatUtm(fix.lat, fix.lng, metresPerDigit);
    if (!usng || !utm) {
      lines.push("UTM/USNG unavailable at this latitude — use latitude/longitude or a polar grid.");
    } else {
      lines.push(`USNG ${digits * 2}-digit (${metresPerDigit} m, ${GRID_DATUM}): ${usng}`);
      // Ten-digit MGRS only when the fix can support one metre.
      if (digits === 5) lines.push(`MGRS 10-digit (${GRID_DATUM}): ${formatMgrs10(fix.lat, fix.lng)}`);
      lines.push(`PHONETIC: ${phonetic(usng)}`);
      lines.push(`UTM (${GRID_DATUM}): ${utm}`);
    }
    lines.push(`https://maps.google.com/?q=${fix.lat},${fix.lng}`);
    // A non-finite or out-of-range timestamp made Date#toISOString throw, so the
    // hiker got NO emergency text at all -- the one moment the app must still
    // produce something.
    if (input.recordedAt != null && Number.isFinite(input.recordedAt)) {
      const when = new Date(input.recordedAt);
      if (Number.isFinite(when.getTime())) {
        lines.push(`Fix time: ${when.toISOString()} (${formatZulu(when)})`);
      }
    }
  } else {
    lines.push("No GPS fix. No usable GPS fix is available on this device — position unknown.");
  }
  if (input.trailName) lines.push(`Route: ${reportField(input.trailName)}`);
  if (input.offTrailM != null && Number.isFinite(input.offTrailM) && input.offTrailM > 20) {
    lines.push(
      source === "deadReckon"
        ? `DEAD RECKON was ~${Math.round(input.offTrailM)} m off marked route`
        : source === "lastKnown" || input.stale
          ? `LAST KNOWN was ~${Math.round(input.offTrailM)} m off marked route`
          : `Approx. ${Math.round(input.offTrailM)} m off marked route`,
    );
  }
  const profile = input.profile;
  if (profile) {
    if (profile.name) lines.push(`Hiker: ${reportField(profile.name)}`);
    if (profile.partySize) lines.push(`Party size: ${reportField(profile.partySize)}`);
    if (profile.medical) lines.push(`Medical: ${reportField(profile.medical)}`);
    if (profile.bloodType) lines.push(`Blood type: ${reportField(profile.bloodType)}`);
    if (profile.iceName || profile.icePhone) {
      lines.push(`ICE: ${reportField(`${profile.iceName} ${profile.icePhone}`.trim())}`);
    }
  }
  if (input.partyNote) lines.push(reportField(input.partyNote));
  if (fix) {
    if (source === "deadReckon") {
      lines.push(`${APP_SENT_FROM} — dead-reckon estimate, not a live GPS fix.`);
    } else if (source === "lastKnown" || input.stale) {
      lines.push(`${APP_SENT_FROM} — last-known coordinates, GPS not live.`);
    } else {
      lines.push(`${APP_SENT_FROM} (offline-capable GPS).`);
    }
  } else {
    lines.push(`${APP_SENT_FROM} — no usable GPS fix on this device.`);
  }
  return formatReport(lines);
}

export async function copyEmergencyInfo(text: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to textarea copy */
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
