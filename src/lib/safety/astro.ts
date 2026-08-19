/** Synodic month. New moon near 2000-01-06 18:14 UTC. */
const SYNODIC = 29.530588;
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

export function moonPhase(date = new Date()): {
  ageDays: number;
  illumination: number;
  name: string;
  nightNav: string;
} {
  const age = ((date.getTime() - NEW_MOON_MS) / 86400000) % SYNODIC;
  const ageDays = age < 0 ? age + SYNODIC : age;
  const illumination = (1 - Math.cos((ageDays / SYNODIC) * 2 * Math.PI)) / 2;
  const pct = Math.round(illumination * 100);

  let name = "Waxing crescent";
  if (ageDays < 1.5 || ageDays > SYNODIC - 1.5) name = "New moon";
  else if (ageDays < 6.5) name = "Waxing crescent";
  else if (ageDays < 8.5) name = "First quarter";
  else if (ageDays < 13.5) name = "Waxing gibbous";
  else if (ageDays < 16.5) name = "Full moon";
  else if (ageDays < 21.5) name = "Waning gibbous";
  else if (ageDays < 23.5) name = "Last quarter";
  else name = "Waning crescent";

  let nightNav: string;
  if (pct < 15) {
    nightNav = `${name} (~${pct}% lit) — dark night. Red light, short legs, pace count.`;
  } else if (pct < 50) {
    nightNav = `${name} (~${pct}% lit) — weak moonlight. Handrails and catching features matter more.`;
  } else if (pct < 85) {
    nightNav = `${name} (~${pct}% lit) — usable moonlight. Still use red near other hikers.`;
  } else {
    nightNav = `${name} (~${pct}% lit) — good night movement light. Shadows can hide drop-offs.`;
  }

  return { ageDays, illumination, name, nightNav };
}
