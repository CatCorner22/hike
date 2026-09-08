import { httpsUrl } from "@/lib/urls";

function evidenceSourceUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const evidence = (metadata as { evidence?: { access?: { sourceUrl?: unknown } } }).evidence;
  return typeof evidence?.access?.sourceUrl === "string" ? evidence.access.sourceUrl : null;
}

/** Reservation page first; OSM/source evidence when the camp has no booking URL. */
export function campOfficialUrl(camp: {
  reservationUrl?: string | null;
  metadata?: unknown;
}): string | null {
  return httpsUrl(camp.reservationUrl) ?? httpsUrl(evidenceSourceUrl(camp.metadata));
}
