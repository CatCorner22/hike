export function formatCoords(lat: number, lng: number, accuracyM?: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  const base = `${Math.abs(lat).toFixed(5)}°${latDir}, ${Math.abs(lng).toFixed(5)}°${lngDir}`;
  if (accuracyM != null) return `${base} (±${Math.round(accuracyM)} m)`;
  return base;
}

export function emergencyMessage(input: {
  lat: number;
  lng: number;
  accuracyM?: number;
  trailName?: string;
  offTrailM?: number;
}): string {
  const lines = [
    "HIKING EMERGENCY LOCATION",
    formatCoords(input.lat, input.lng, input.accuracyM),
    `https://maps.google.com/?q=${input.lat},${input.lng}`,
  ];
  if (input.trailName) lines.push(`Route: ${input.trailName}`);
  if (input.offTrailM != null && input.offTrailM > 20) {
    lines.push(`Approx. ${Math.round(input.offTrailM)} m off marked route`);
  }
  lines.push("Sent from Hike app (offline-capable GPS).");
  return lines.join("\n");
}

export async function copyEmergencyInfo(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
