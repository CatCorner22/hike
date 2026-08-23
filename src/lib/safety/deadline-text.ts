import { formatZulu } from "@/lib/safety/landnav";

/**
 * The local form of a stored return deadline, as `setOverdueAlarm` keeps it.
 * Optional throughout, because older stored rows and some call sites only ever
 * had the instant.
 */
export interface StoredDeadlineLocal {
  resolvedLocal?: string | null;
  timeZone?: string | null;
  utcOffset?: string | null;
}

/**
 * How a deadline is written for a person who is not the hiker.
 *
 * This existed only as `deadline.toISOString()` — on the printed leave-behind
 * card, in the SMS the emergency contact receives, and in the dossier. Every US
 * evening return after about 1600 PDT crosses UTC midnight, so the one line that
 * tells a spouse when to start calling carried TOMORROW's date, printed two
 * lines under a "Planned date: Sunday, Aug 23" rendered as a local wall clock.
 * Two time frames stacked with neither labeled, and the wrong one is the one
 * that starts a search.
 *
 * The human form was already stored and thrown away: `OverdueAlarm` carries
 * `resolvedLocal`, `timeZone` and `utcOffset`. Lead with it, and keep the Zulu
 * form in the same line because that is what a rescuer wants. When no local
 * form was recorded, say the time is UTC rather than inventing a zone — the
 * reader's own zone is exactly the wrong guess to make on a printed card that
 * may travel.
 */
export function formatDeadlineForPerson(
  deadline: Date | null | undefined,
  local?: StoredDeadlineLocal | null,
): string | null {
  if (!(deadline instanceof Date) || !Number.isFinite(deadline.getTime())) return null;
  const zulu = formatZulu(deadline);
  const localText = local?.resolvedLocal
    ? [local.resolvedLocal, local.utcOffset ?? null, local.timeZone ? `(${local.timeZone})` : null]
        .filter(Boolean)
        .join(" ")
    : null;
  return localText ? `${localText} — ${zulu}` : `${zulu} — UTC; no local time was recorded for this trip`;
}
