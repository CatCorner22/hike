import { formatDdm, formatMgrs10, formatUsng, formatUtm, phonetic } from "@/lib/safety/usng";
import { formatZulu } from "@/lib/safety/landnav";
import type { IceProfile } from "@/lib/safety/profile";
import { formatReport, reportField } from "@/lib/safety/report-field";

export function formatCoords(lat: number, lng: number, accuracyM?: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  const base = `${Math.abs(lat).toFixed(5)}°${latDir}, ${Math.abs(lng).toFixed(5)}°${lngDir}`;
  if (accuracyM != null) return `${base} (±${Math.round(accuracyM)} m)`;
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
  const lat = input.lat;
  const lng = input.lng;
  const hasFix =
    typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng);
  const lines = ["SOS / EMERGENCY LOCATION"];
  if (hasFix) {
    if (source === "deadReckon") {
      lines.push("DEAD RECKON POSITION — GPS denied; pace/heading estimate");
    } else if (source === "lastKnown" || input.stale) {
      lines.push("LAST KNOWN POSITION — GPS not live");
    }
    lines.push(formatCoords(lat, lng, input.accuracyM));
    lines.push(`DDM: ${formatDdm(lat, lng)}`);
    const usng = formatUsng(lat, lng);
    const mgrs = formatMgrs10(lat, lng);
    const utm = formatUtm(lat, lng);
    if (!usng || !mgrs || !utm) {
      lines.push("UTM/USNG unavailable at this latitude — use latitude/longitude or a polar grid.");
    } else {
      lines.push(`USNG 8-digit: ${usng}`);
      lines.push(`MGRS 10-digit: ${mgrs}`);
      lines.push(`PHONETIC: ${phonetic(formatUsng(lat, lng, 5)!)}`);
      lines.push(`UTM: ${utm}`);
    }
    lines.push(`https://maps.google.com/?q=${lat},${lng}`);
    if (input.recordedAt) {
      lines.push(`Fix time: ${new Date(input.recordedAt).toISOString()} (${formatZulu(new Date(input.recordedAt))})`);
    }
  } else {
    lines.push("No GPS fix available on this device.");
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
  if (hasFix) {
    if (source === "deadReckon") {
      lines.push("Sent from Hike app — dead-reckon estimate, not a live GPS fix.");
    } else if (source === "lastKnown" || input.stale) {
      lines.push("Sent from Hike app — last-known coordinates, GPS not live.");
    } else {
      lines.push("Sent from Hike app (offline-capable GPS).");
    }
  } else {
    lines.push("Sent from Hike app — no GPS fix on this device.");
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
