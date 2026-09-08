/** NPS unit codes are four ASCII letters (for example, `yose`). */
export function normalizeNpsParkCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z]{4}$/.test(normalized) ? normalized : null;
}

/** Only an explicit NPS-specific OSM tag is evidence of a unit code. */
export function npsParkCodeFromTags(
  tags: Record<string, string> | null | undefined,
): string | null {
  return normalizeNpsParkCode(tags?.["nps:park_code"] ?? tags?.["ref:nps"]);
}
