export type PlannedDateStyle = "full" | "medium";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Plans are calendar days, not instants. Reading only the ISO date portion and
 * formatting in UTC keeps a U.S. evening offset from turning Saturday into Friday.
 */
export function plannedDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isFinite(value.getTime())) return null;
  const text = value instanceof Date ? value.toISOString() : value;
  const match = DATE_ONLY.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Store date-only input at noon UTC while the existing database column remains a timestamp. */
export function plannedDateToIso(value: string): string | null {
  const date = plannedDateOnly(value);
  return date ? `${date}T12:00:00.000Z` : null;
}

export function formatPlannedDate(
  value: Date | string,
  style: PlannedDateStyle = "medium",
): string {
  const date = plannedDateOnly(value);
  if (!date) return "Date unavailable";
  const instant = new Date(`${date}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...(style === "full"
      ? { weekday: "long", year: "numeric", month: "short", day: "numeric" }
      : { year: "numeric", month: "short", day: "numeric" }),
  }).format(instant);
}
