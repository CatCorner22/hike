import { formatDdm, formatMgrs10, formatUsng, formatUtm, phonetic } from "@/lib/safety/usng";
import { formatZulu } from "@/lib/safety/landnav";
import type { IceProfile } from "@/lib/safety/profile";
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
  // value to anyone receiving the message.
  if (accuracyM != null && Number.isFinite(accuracyM) && accuracyM >= 0 && accuracyM <= 10_000) {
    const rounded = Math.round(accuracyM);
    return `${base} (±${rounded === 0 ? 0 : rounded} m)`;
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
    lines.push(`DDM: ${formatDdm(fix.lat, fix.lng)}`);
    const usng = formatUsng(fix.lat, fix.lng);
    const mgrs = formatMgrs10(fix.lat, fix.lng);
    const utm = formatUtm(fix.lat, fix.lng);
    if (!usng || !mgrs || !utm) {
      lines.push("UTM/USNG unavailable at this latitude — use latitude/longitude or a polar grid.");
    } else {
      lines.push(`USNG 8-digit: ${usng}`);
      lines.push(`MGRS 10-digit: ${mgrs}`);
      lines.push(`PHONETIC: ${phonetic(formatUsng(fix.lat, fix.lng, 5)!)}`);
      lines.push(`UTM: ${utm}`);
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
    lines.push("No usable GPS fix on this device — position unknown.");
  }
  if (input.trailName) lines.push(`Route: ${reportField(input.trailName)}`);
  if (input.offTrailM != null && Number.isFinite(input.offTrailM) && input.offTrailM > 20) {
    lines.push(
      input.stale
        ? `LAST KNOWN was ~${Math.round(input.offTrailM)} m off marked route`
        : `Approx. ${Math.round(input.offTrailM)} m off marked route`,
    );
  }
  const profile = input.profile;
  if (profile) {
    if (profile.name) lines.push(`Hiker: ${reportField(profile.name)}`);
    if (profile.partySize) lines.push(`Party size: ${profile.partySize}`);
    if (profile.medical) lines.push(`Medical: ${reportField(profile.medical)}`);
    if (profile.bloodType) lines.push(`Blood type: ${reportField(profile.bloodType)}`);
    if (profile.iceName || profile.icePhone) {
      lines.push(`ICE: ${reportField(profile.iceName)} ${reportField(profile.icePhone)}`.trim());
    }
  }
  if (input.partyNote) lines.push(reportField(input.partyNote));
  if (fix) {
    if (source === "deadReckon") {
      lines.push("Sent from Hike app — dead-reckon estimate, not a live GPS fix.");
    } else if (source === "lastKnown" || input.stale) {
      lines.push("Sent from Hike app — last-known coordinates, GPS not live.");
    } else {
      lines.push("Sent from Hike app (offline-capable GPS).");
    }
  } else {
    lines.push("Sent from Hike app — no usable GPS fix on this device.");
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
