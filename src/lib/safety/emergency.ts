import { formatDdm, formatMgrs10, formatUsng, formatUtm, phonetic } from "@/lib/safety/usng";
import { formatZulu } from "@/lib/safety/landnav";
import type { IceProfile } from "@/lib/safety/profile";

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
  const lines = ["SOS / EMERGENCY LOCATION"];
  if (input.lat != null && input.lng != null) {
    if (source === "deadReckon") {
      lines.push("DEAD RECKON POSITION — GPS denied; pace/heading estimate");
    } else if (source === "lastKnown" || input.stale) {
      lines.push("LAST KNOWN POSITION — GPS not live");
    }
    lines.push(formatCoords(input.lat, input.lng, input.accuracyM));
    lines.push(`DDM: ${formatDdm(input.lat, input.lng)}`);
    const usng = formatUsng(input.lat, input.lng);
    const mgrs = formatMgrs10(input.lat, input.lng);
    const utm = formatUtm(input.lat, input.lng);
    if (!usng || !mgrs || !utm) {
      lines.push("UTM/USNG unavailable at this latitude — use latitude/longitude or a polar grid.");
    } else {
      lines.push(`USNG 8-digit: ${usng}`);
      lines.push(`MGRS 10-digit: ${mgrs}`);
      lines.push(`PHONETIC: ${phonetic(formatUsng(input.lat, input.lng, 5)!)}`);
      lines.push(`UTM: ${utm}`);
    }
    lines.push(`https://maps.google.com/?q=${input.lat},${input.lng}`);
    if (input.recordedAt) {
      lines.push(`Fix time: ${new Date(input.recordedAt).toISOString()} (${formatZulu(new Date(input.recordedAt))})`);
    }
  } else {
    lines.push("No GPS fix available on this device.");
  }
  if (input.trailName) lines.push(`Route: ${input.trailName}`);
  if (input.offTrailM != null && input.offTrailM > 20) {
    lines.push(
      input.stale
        ? `LAST KNOWN was ~${Math.round(input.offTrailM)} m off marked route`
        : `Approx. ${Math.round(input.offTrailM)} m off marked route`,
    );
  }
  const profile = input.profile;
  if (profile) {
    if (profile.name) lines.push(`Hiker: ${profile.name}`);
    if (profile.partySize) lines.push(`Party size: ${profile.partySize}`);
    if (profile.medical) lines.push(`Medical: ${profile.medical}`);
    if (profile.bloodType) lines.push(`Blood type: ${profile.bloodType}`);
    if (profile.iceName || profile.icePhone) {
      lines.push(`ICE: ${profile.iceName} ${profile.icePhone}`.trim());
    }
  }
  if (input.partyNote) lines.push(input.partyNote);
  if (input.lat != null && input.lng != null) {
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
  return lines.join("\n");
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
