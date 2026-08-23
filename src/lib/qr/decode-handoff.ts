/**
 * Parse a scanned QR payload into a plottable position.
 *
 * Three shapes are recognized, strictly, in this order:
 *  1. Klandagi's own SAR HANDOFF (the exact text buildSarHandoff emits) — the
 *     phone-to-phone position relay this closes the loop on;
 *  2. RFC 5870 geo: URIs ("geo:37.73450,-119.60320");
 *  3. a short plain decimal pair ("37.7345, -119.6032"), only when the payload
 *     is small enough that a coordinate-looking substring cannot be an
 *     accident inside unrelated content.
 *
 * Everything else returns null. A handoff whose position line says UNKNOWN
 * also returns null — there is nothing to plot, and inventing a point from a
 * document that explicitly declares no fix would be the exact dishonesty this
 * app exists to avoid. The caller still has the raw text to display.
 */

export interface ScannedPosition {
  lat: number;
  lng: number;
  kind: "sar-handoff" | "geo-uri" | "coordinates";
  /** Best human label found in the payload; empty when none. */
  label: string;
  /** The handoff's own provenance line ("Fix at … · DEAD RECKON — not live GPS"), when present. */
  provenance: string | null;
}

const MAX_PAYLOAD_CHARS = 4096;
const DECIMAL_PAIR = /(-?\d{1,3}\.\d{1,8})\s*,\s*(-?\d{1,3}\.\d{1,8})/;

function validPair(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

function parseGeoUri(text: string): ScannedPosition | null {
  const match = text.match(/^geo:(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:[,;]|$)/i);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!validPair(lat, lng)) return null;
  return { lat, lng, kind: "geo-uri", label: "", provenance: null };
}

function parseSarHandoff(text: string): ScannedPosition | null {
  const lines = text.split("\n").map((line) => line.trim());
  if (lines[0] !== "SAR HANDOFF") return null;
  const positionLine = lines.find((line) => DECIMAL_PAIR.test(line));
  if (!positionLine) return null;
  const match = positionLine.match(DECIMAL_PAIR)!;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!validPair(lat, lng)) return null;
  // Line 2 is the trail name when present; it is a label only if it is not
  // itself the position line and not a status line.
  const candidate = lines[1] ?? "";
  const label =
    candidate && candidate !== positionLine && !candidate.startsWith("Fix at") ? candidate : "";
  const provenance = lines.find((line) => line.startsWith("Fix at ")) ?? null;
  return { lat, lng, kind: "sar-handoff", label, provenance };
}

function parsePlainPair(text: string): ScannedPosition | null {
  // Long payloads are documents, not coordinates: a decimal pair inside a
  // URL or arbitrary text must not be mistaken for a position.
  if (text.length > 120) return null;
  const match = text.match(DECIMAL_PAIR);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!validPair(lat, lng)) return null;
  return { lat, lng, kind: "coordinates", label: "", provenance: null };
}

export function parseScannedPosition(payload: string): ScannedPosition | null {
  if (typeof payload !== "string") return null;
  const text = payload.trim();
  if (!text || text.length > MAX_PAYLOAD_CHARS) return null;
  return parseSarHandoff(text) ?? parseGeoUri(text) ?? parsePlainPair(text);
}
