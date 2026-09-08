/**
 * Only http(s) links may be rendered. Plain http is upgraded to https so
 * OSM/NPS/Tavily sources that still advertise http: are clickable instead of
 * silently dropped. javascript:/data:/file: stay rejected.
 */
export function httpsUrl(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:" || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}
