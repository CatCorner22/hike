/**
 * Order for the home screen's "Upcoming plans" card.
 *
 * Soonest first. Sorting the other way put the furthest-future trip at the top
 * and pushed this weekend's hike off the end of a five-row card — the one plan
 * the hiker opened the app to check.
 *
 * Undated plans sort LAST rather than first: a plan with no date is not
 * imminent, and letting unparseable dates float to the top would bury the
 * dated ones behind them.
 */
export function sortUpcomingPlans<T extends { plannedDate?: string | Date | null }>(
  plans: T[],
): T[] {
  const time = (plan: T): number => {
    const value = plan.plannedDate;
    if (!value) return Number.NaN;
    const ms = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(ms) ? ms : Number.NaN;
  };
  return [...plans].sort((a, b) => {
    const aTime = time(a);
    const bTime = time(b);
    const aOk = Number.isFinite(aTime);
    const bOk = Number.isFinite(bTime);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    return aTime - bTime;
  });
}
