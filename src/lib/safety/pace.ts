/**
 * Walking-time estimates. Kept dependency-free so both the route readouts
 * (`field-ops`) and the daylight turnaround warning (`declination`) can share one
 * estimator — the two used to disagree, and the safety warning was the optimistic one.
 */

/**
 * Naismith + Langmuir-ish: 5 km/h + 1 h / 600 m climb + 10 min / 300 m steep descent.
 */
export function naismithMinutes(distanceM: number, gainM = 0, lossM = 0): number {
  if (!(distanceM > 0)) return 0;
  const walk = (distanceM / 5000) * 60;
  const climb = (Math.max(0, gainM) / 600) * 60;
  const drop = lossM >= 300 ? (lossM / 300) * 10 : 0;
  return Math.round(walk + climb + drop);
}

export function formatNaismith(minutes: number): string {
  if (minutes < 60) return `Naismith ~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `Naismith ~${h} h ${m} min`;
}
