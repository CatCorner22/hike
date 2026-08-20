import { isValidLatLng } from "@/lib/safety/gps-quality";

export const MAX_ACTIVITY_POINTS = 20_000;
export const MAX_GPX_CHARS = 5_000_000;

export function parseLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = typeof lat === "number" ? lat : Number(lat);
  const ln = typeof lng === "number" ? lng : Number(lng);
  if (!isValidLatLng(la, ln)) return null;
  return { lat: la, lng: ln };
}

export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}
