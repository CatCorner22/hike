/** Bound user-controlled values before placing them in line-oriented field reports. */
const FIELD_CONTROL_CHARS = /[\r\n\u0000\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const WHITESPACE = /\s+/g;
export const REPORT_FIELD_MAX_LENGTH = 240;
export const REPORT_MAX_LENGTH = 6_000;
const TRUNCATED = " …[TRUNCATED]";

export function reportField(value: unknown, maxLen = REPORT_FIELD_MAX_LENGTH): string {
  const limit = Number.isFinite(maxLen) && maxLen > TRUNCATED.length ? Math.floor(maxLen) : REPORT_FIELD_MAX_LENGTH;
  if (value === null || value === undefined) return "UNKNOWN";
  if (typeof value === "number" && !Number.isFinite(value)) return "UNKNOWN";
  const cleaned = String(value).replace(FIELD_CONTROL_CHARS, " ").replace(WHITESPACE, " ").trim();
  if (!cleaned) return "UNKNOWN";
  return cleaned.length > limit ? `${cleaned.slice(0, limit - TRUNCATED.length).trimEnd()}${TRUNCATED}` : cleaned;
}

/** Preserve formatter-owned line breaks only, and bound the resulting radio/SMS handoff. */
export function formatReport(lines: Array<string | null | undefined>, maxLen = REPORT_MAX_LENGTH): string {
  const limit = Number.isFinite(maxLen) && maxLen > TRUNCATED.length ? Math.floor(maxLen) : REPORT_MAX_LENGTH;
  // Each item is one formatter-owned line. Sanitizing again here means a
  // missed interpolation cannot create a forged report line.
  const output = lines
    .filter((line): line is string => Boolean(line))
    .map((line) => reportField(line, limit))
    .join("\n");
  return output.length > limit ? `${output.slice(0, limit - TRUNCATED.length).trimEnd()}${TRUNCATED}` : output;
}
