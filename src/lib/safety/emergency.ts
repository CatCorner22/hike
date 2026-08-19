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
}): string {
  const lines = ["HIKING EMERGENCY LOCATION"];
  if (input.lat != null && input.lng != null) {
    if (input.stale) lines.push("LAST KNOWN POSITION — GPS not live");
    lines.push(formatCoords(input.lat, input.lng, input.accuracyM));
    lines.push(`DDM: ${formatDdm(input.lat, input.lng)}`);
    lines.push(`USNG 8-digit: ${formatUsng(input.lat, input.lng)}`);
    lines.push(`MGRS 10-digit: ${formatMgrs10(input.lat, input.lng)}`);
    lines.push(`PHONETIC: ${phonetic(formatUsng(input.lat, input.lng, 5))}`);
    lines.push(`UTM: ${formatUtm(input.lat, input.lng)}`);
    lines.push(`https://maps.google.com/?q=${input.lat},${input.lng}`);
    if (input.recordedAt) {
      lines.push(`Fix time: ${new Date(input.recordedAt).toISOString()} (${formatZulu(new Date(input.recordedAt))})`);
    }
  } else {
    lines.push("No GPS fix available on this device.");
  }
  if (input.trailName) lines.push(`Route: ${input.trailName}`);
  if (input.offTrailM != null && input.offTrailM > 20 && !input.stale) {
    lines.push(`Approx. ${Math.round(input.offTrailM)} m off marked route`);
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
  lines.push("Sent from Hike app (offline-capable GPS).");
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
