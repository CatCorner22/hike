/** Bound user-controlled values before placing them in line-oriented field reports. */
const FIELD_CONTROL_CHARS = /[\r\n\u0000\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
/** Strip user attempts to forge formatter-owned `--- SECTION ---` lines in one field. */
const SECTION_FORGERY = /\s*-{3,}\s*[A-Z][A-Z0-9 /-]*\s*-{3,}\s*/gi;
/** Strip embedded return-deadline forgeries inside a single field value. */
const RETURN_FORGERY = /\bReturn by:\s*\S+/gi;
const WHITESPACE = /\s+/g;
export const REPORT_FIELD_MAX_LENGTH = 240;
export const REPORT_MAX_LENGTH = 6_000;
const TRUNCATED = " …[TRUNCATED]";
/** Lines the formatter owns — must not be re-sanitized or section markers disappear. */
const FORMATTER_SECTION_LINE = /^--- [A-Z][A-Z0-9 /-]+ ---$/;

export function reportField(value: unknown, maxLen = REPORT_FIELD_MAX_LENGTH): string {
  const limit = Number.isFinite(maxLen) && maxLen > TRUNCATED.length ? Math.floor(maxLen) : REPORT_FIELD_MAX_LENGTH;
  if (value === null || value === undefined) return "UNKNOWN";
  if (typeof value === "number" && !Number.isFinite(value)) return "UNKNOWN";
  const cleaned = String(value)
    .replace(FIELD_CONTROL_CHARS, " ")
    .replace(SECTION_FORGERY, " ")
    .replace(RETURN_FORGERY, " ")
    .replace(WHITESPACE, " ")
    .trim();
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
    .map((line) => {
      const trimmed = line.trim();
      return FORMATTER_SECTION_LINE.test(trimmed) ? trimmed : reportField(line, limit);
    })
    .join("\n");
  return output.length > limit ? `${output.slice(0, limit - TRUNCATED.length).trimEnd()}${TRUNCATED}` : output;
}
