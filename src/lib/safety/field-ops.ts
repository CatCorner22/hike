import { rangeAzimuth } from "@/lib/safety/landnav";

/** Environment Canada wind-chill (°C, wind km/h). Valid roughly T ≤ 10 °C, wind ≥ 5 km/h. */
export function windChillC(tempC: number, windKph: number): number | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(windKph)) return null;
  if (tempC > 10 || windKph < 5) return null;
  const v = Math.pow(windKph, 0.16);
  return Math.round((13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v) * 10) / 10;
}

export function windChillWarning(tempC: number, windKph: number): string | null {
  const wc = windChillC(tempC, windKph);
  if (wc == null) return null;
  if (wc <= -28) return `Wind chill ${wc}°C — frostbite risk in minutes. Cover skin, stop the wind.`;
  if (wc <= -10) return `Wind chill ${wc}°C — add a wind layer before you cool.`;
  return `Wind chill ${wc}°C.`;
}

/** Simplified NOAA heat index (°C). Meaningful above ~27 °C with humidity. */
export function heatIndexC(tempC: number, rhPct: number): number | null {
  if (tempC < 27 || rhPct < 40) return null;
  const t = (tempC * 9) / 5 + 32;
  const r = rhPct;
  const hiF =
    -42.379 +
    2.04901523 * t +
    10.14333127 * r -
    0.22475541 * t * r -
    0.00683783 * t * t -
    0.05481717 * r * r +
    0.00122874 * t * t * r +
    0.00085282 * t * r * r -
    0.00000199 * t * t * r * r;
  const hiC = Math.round((((hiF - 32) * 5) / 9) * 10) / 10;
  // Rothfusz undershoots at the 27 °C / 40 % edge — do not report a "heat index"
  // cooler than the air as if it were a real heat hazard.
  if (hiC <= tempC) return null;
  return hiC;
}

export function heatWarning(tempC: number, rhPct: number): string | null {
  const hi = heatIndexC(tempC, rhPct);
  if (hi == null) return null;
  if (hi >= 41) return `Heat index ${hi}°C — rest in shade, sip water, watch for heat stroke.`;
  if (hi >= 32) return `Heat index ${hi}°C — slow the pace and drink on a schedule.`;
  return null;
}

/** Flash-to-bang: seconds / 5 ≈ miles, / 3 ≈ km. 30–30 rule. */
export function lightningRule(flashToBangSec: number): {
  km: number;
  miles: number;
  warning: string;
} {
  const miles = flashToBangSec / 5;
  const km = flashToBangSec / 3;
  let warning: string;
  if (flashToBangSec <= 30) {
    warning = `Storm ~${km.toFixed(1)} km — seek a low, non-ridge, non-tree-alone position NOW. Wait 30 min after last thunder.`;
  } else if (flashToBangSec <= 60) {
    warning = `Storm ~${km.toFixed(1)} km — leave ridgelines and metal. Count 30–30.`;
  } else {
    warning = `Storm ~${km.toFixed(1)} km. Keep counting. 30–30: if ≤30 s, shelter; wait 30 min after last boom.`;
  }
  return { km, miles, warning };
}

/**
 * Naismith + Langmuir-ish: 5 km/h + 1 h / 600 m climb + 10 min / 300 m steep descent.
 */
export function naismithMinutes(
  distanceM: number,
  gainM = 0,
  lossM = 0,
): number {
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

export function slopePercent(riseM: number, runM: number): number | null {
  if (!(runM > 0) || !Number.isFinite(riseM)) return null;
  return Math.round((riseM / runM) * 1000) / 10;
}

export function slopeWarning(percent: number): string | null {
  if (percent >= 45) return `Slope ~${percent}% — Class 3/4; hands may be needed.`;
  if (percent >= 25) return `Slope ~${percent}% — steep. Short-rope kids, use switchbacks.`;
  return null;
}

export function slopeFromProfile(
  profile: Array<{ distanceMeters: number; elevation: number }>,
  atMeters: number,
  windowM = 80,
): number | null {
  if (profile.length < 2) return null;
  const lo = atMeters - windowM / 2;
  const hi = atMeters + windowM / 2;
  const pts = profile.filter((p) => p.distanceMeters >= lo && p.distanceMeters <= hi);
  if (pts.length < 2) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  return slopePercent(b.elevation - a.elevation, b.distanceMeters - a.distanceMeters);
}

/** GPS spoof / jam heuristic: a trusted-looking track that teleports or accuracy collapses. */
export function gpsAnomalyWarning(
  points: Array<{ lat: number; lng: number; accuracy?: number; recordedAt?: number | string }>,
  now = Date.now(),
): string | null {
  if (points.length < 3) return null;
  const recent = points.slice(-5);
  const times = recent.map((p) => {
    if (typeof p.recordedAt === "number") return p.recordedAt;
    return p.recordedAt ? Date.parse(p.recordedAt) : now;
  });
  for (let i = 1; i < recent.length; i++) {
    const dt = times[i] - times[i - 1];
    if (dt <= 0 || dt > 20_000) continue;
    const meters = rangeAzimuth(recent[i - 1], recent[i]).meters;
    const speed = meters / (dt / 1000);
    if (meters > 250 && speed > 25) {
      return "GPS jumped hundreds of metres in seconds — treat this fix as untrusted. Use the trail line and last known grid.";
    }
  }
  const acc = recent.map((p) => p.accuracy).filter((a): a is number => a != null && Number.isFinite(a));
  if (acc.length >= 3) {
    const min = Math.min(...acc);
    const max = Math.max(...acc);
    if (min < 12 && max > 80) {
      return "GPS accuracy swinging wildly (possible canyon bounce or jamming). Cross-check with compass and USNG.";
    }
  }
  return null;
}

export function batterySafetyAdvice(level: number, charging: boolean): string | null {
  if (charging) return null;
  const pct = Math.round(level * 100);
  if (pct <= 5) {
    return `Battery ${pct}% — send location now if overdue. Enable airplane mode except GPS.`;
  }
  if (pct <= 10) {
    return `Battery ${pct}% — dim screen, disable non-essential apps, keep GPS on for SOS.`;
  }
  if (pct <= 20) {
    return `Battery ${pct}% — plan your next comms window before the phone dies.`;
  }
  return null;
}
