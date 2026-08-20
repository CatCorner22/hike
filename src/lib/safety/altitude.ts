import type { Severity } from "@/lib/safety/severity";

export const DISCLAIMER =
  "Training aid, not medical direction. Altitude illness can worsen quickly: descend and seek urgent medical care for severe symptoms.";

export interface LakeLouiseInput {
  headache: 0 | 1 | 2 | 3;
  giSymptoms: 0 | 1 | 2 | 3;
  fatigue: 0 | 1 | 2 | 3;
  dizziness: 0 | 1 | 2 | 3;
}

export interface LakeLouiseResult {
  total: number;
  hasAms: boolean;
  severity: Severity;
  label: string;
  actions: string[];
}

export interface DescentImperativeResult {
  mustDescend: boolean;
  severity: Severity;
  message: string;
  actions: string[];
}

export interface AscentRateAdviceResult {
  gainM: number;
  severity: Severity;
  message: string;
}

export interface AltitudeProfileSummary {
  maxElevationM: number;
  totalGainM: number;
  metersAbove2500: number;
  crosses3000: boolean;
}

const SPO2_BY_ELEVATION: Array<{ elevationM: number; spo2Pct: number }> = [
  { elevationM: 0, spo2Pct: 98 },
  { elevationM: 2500, spo2Pct: 94 },
  { elevationM: 3000, spo2Pct: 92 },
  { elevationM: 4000, spo2Pct: 88 },
  { elevationM: 5000, spo2Pct: 84 },
  { elevationM: 6000, spo2Pct: 80 },
  { elevationM: 7000, spo2Pct: 75 },
  { elevationM: 8000, spo2Pct: 70 },
];

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function isLakeLouiseSymptom(value: number): value is 0 | 1 | 2 | 3 {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 3;
}

function validProfile(profile: Array<{ distanceMeters: number; elevation: number }>): boolean {
  // A single sample is not a profile: it has no distance to integrate and produced a
  // summary claiming the route "crosses 3000 m" from one reading.
  if (!Array.isArray(profile) || profile.length < 2) return false;
  return profile.every(
    (point, index) =>
      Number.isFinite(point.distanceMeters) &&
      Number.isFinite(point.elevation) &&
      point.distanceMeters >= 0 &&
      point.elevation >= -500 &&
      point.elevation <= 9000 &&
      (index === 0 || point.distanceMeters >= profile[index - 1].distanceMeters),
  );
}

/**
 * 2018 Lake Louise Acute Mountain Sickness Score: AMS requires headache plus
 * a total score of at least 3. This screen does not diagnose HACE or HAPE.
 */
export function lakeLouiseScore(input: LakeLouiseInput): LakeLouiseResult | null {
  if (
    !input ||
    !isLakeLouiseSymptom(input.headache) ||
    !isLakeLouiseSymptom(input.giSymptoms) ||
    !isLakeLouiseSymptom(input.fatigue) ||
    !isLakeLouiseSymptom(input.dizziness)
  ) {
    return null;
  }

  const total = input.headache + input.giSymptoms + input.fatigue + input.dizziness;
  const hasAms = input.headache >= 1 && total >= 3;

  if (!hasAms) {
    // The 2018 criteria need a headache, so this is correctly "not AMS" — but a heavy
    // non-headache symptom load at altitude still deserves attention, and reporting it
    // as "info" buried it at the bottom of the warning stack.
    const notable = total >= 3;
    return {
      total,
      hasAms,
      severity: notable ? "caution" : "info",
      label: notable
        ? "Does not meet AMS score criteria, but symptoms are significant"
        : "Does not meet AMS score criteria",
      actions: notable
        ? [
            "AMS scoring needs a headache, so this is not a positive AMS score — but do not ascend with these symptoms.",
            "Rest, hydrate, eat, and reassess; descend if symptoms worsen. Check for ataxia and breathlessness at rest.",
          ]
        : [
            "Do not ascend if symptoms are developing; reassess after rest, fluids, food, and warmth.",
            "A normal score does not rule out HACE or HAPE red flags.",
          ],
    };
  }
  if (total <= 5) {
    return {
      total,
      hasAms,
      severity: "caution",
      label: "Mild acute mountain sickness",
      actions: [
        "Stop ascent. Rest at the current elevation and reassess symptoms.",
        "Descend if symptoms worsen or do not improve; do not leave a sick person alone.",
      ],
    };
  }
  if (total <= 9) {
    return {
      total,
      hasAms,
      severity: "warning",
      label: "Moderate acute mountain sickness",
      actions: [
        "Stop ascent and descend if symptoms do not improve promptly.",
        "Monitor closely for ataxia, altered mental status, or breathlessness at rest.",
      ],
    };
  }
  return {
    total,
    hasAms,
    severity: "critical",
    label: "Severe acute mountain sickness",
    actions: [
      "Descend now with assistance; do not continue upward.",
      "Seek urgent medical evaluation and watch for HACE or HAPE red flags.",
    ],
  };
}

/** Wilderness Medical Society altitude guidance: ataxia is the most important HACE sign and requires immediate descent. */
export function haceRedFlags(): string[] {
  return [
    "Ataxia (loss of coordination, staggering gait) — the single most important HACE sign.",
    "Altered mental status: confusion, unusual behavior, severe drowsiness, or reduced consciousness.",
    "Severe or rapidly worsening headache, especially with neurologic change.",
    "Immediate descent with assistance; do not leave the person alone.",
  ];
}

/** Wilderness Medical Society altitude guidance: suspected HAPE is an emergency requiring descent. */
export function hapeRedFlags(): string[] {
  return [
    "Breathlessness at rest or inability to speak full sentences.",
    "Persistent cough, especially wet cough or pink/frothy sputum.",
    "Marked weakness, blue/gray lips, fast resting pulse, or worsening exercise tolerance.",
    "Immediate descent with assistance; oxygen and urgent medical care if available.",
  ];
}

/** Wilderness Medical Society altitude guidance: any HACE/HAPE red flag means descend immediately, at least 500–1000 m when terrain permits. */
export function descentImperative(input: {
  hasAtaxia: boolean;
  alteredMental: boolean;
  breathlessAtRest: boolean;
}): DescentImperativeResult {
  const mustDescend = input.hasAtaxia || input.alteredMental || input.breathlessAtRest;
  if (!mustDescend) {
    return {
      mustDescend: false,
      severity: "info",
      message: "No entered HACE/HAPE red flag. Do not ascend if symptoms are present; monitor and reassess.",
      actions: ["Stop ascent if symptoms worsen.", "Check for ataxia, altered mental status, and breathlessness at rest."],
    };
  }

  const flags = [
    input.hasAtaxia ? "ataxia" : null,
    input.alteredMental ? "altered mental status" : null,
    input.breathlessAtRest ? "breathlessness at rest" : null,
  ].filter((flag): flag is string => flag !== null);
  return {
    mustDescend: true,
    severity: "critical",
    message: `Possible severe altitude illness (${flags.join(", ")}) — DESCEND NOW.`,
    actions: [
      "Descend immediately with assistance; target at least 500–1000 m lower if terrain permits.",
      "Do not leave the person alone or let them continue upward.",
      "Use oxygen or a portable hyperbaric bag if available and seek urgent medical care.",
    ],
  };
}

/** Wilderness Medical Society altitude guidance: above 3000 m, limit sleeping-elevation gain to about 500 m per night and take a rest day every 3–4 days or about 1000 m. */
export function ascentRateAdvice(input: {
  currentElevationM: number;
  previousNightElevationM: number;
}): AscentRateAdviceResult | null {
  if (
    !input ||
    !Number.isFinite(input.currentElevationM) ||
    !Number.isFinite(input.previousNightElevationM) ||
    input.currentElevationM < -500 ||
    input.currentElevationM > 9000 ||
    input.previousNightElevationM < -500 ||
    input.previousNightElevationM > 9000
  ) {
    return null;
  }

  const gainM = roundOne(input.currentElevationM - input.previousNightElevationM);
  if (input.currentElevationM < 2500) {
    return {
      gainM,
      severity: "info",
      message: "Below 2500 m: no altitude sleeping-elevation concern from this rule. Continue to watch symptoms.",
    };
  }
  if (input.currentElevationM <= 3000) {
    return {
      gainM,
      severity: "caution",
      message: "Approaching 3000 m: build in acclimatization time and do not ascend with symptoms.",
    };
  }
  if (gainM > 500) {
    return {
      gainM,
      severity: "warning",
      message: `Sleeping elevation gain ${gainM} m exceeds the ~500 m/night guideline above 3000 m. Add a lower night or revise the plan; take a rest day every 3–4 days or ~1000 m.`,
    };
  }
  return {
    gainM,
    severity: "info",
    message: `Sleeping elevation gain ${gainM} m is within the ~500 m/night guideline above 3000 m. Plan a rest day every 3–4 days or ~1000 m.`,
  };
}

/**
 * Approximate resting SpO2 for acclimatized people by altitude. This is a rough
 * guide with wide individual variation; symptoms and trend matter more than one pulse-oximeter reading.
 */
export function expectedSpo2(elevationM: number): number | null {
  // The reference table starts at sea level; below-zero elevations must not
  // be extrapolated into a more-than-100% oxygen saturation estimate.
  if (!Number.isFinite(elevationM) || elevationM < 0 || elevationM > 8000) return null;
  for (let index = 1; index < SPO2_BY_ELEVATION.length; index += 1) {
    const lower = SPO2_BY_ELEVATION[index - 1];
    const upper = SPO2_BY_ELEVATION[index];
    if (elevationM <= upper.elevationM) {
      const fraction = (elevationM - lower.elevationM) / (upper.elevationM - lower.elevationM);
      return Math.round(lower.spo2Pct + (upper.spo2Pct - lower.spo2Pct) * fraction);
    }
  }
  return SPO2_BY_ELEVATION[SPO2_BY_ELEVATION.length - 1].spo2Pct;
}

/** Wilderness Medical Society altitude guidance and pulse-oximeter limitations: use a low reading as a symptom check, not a diagnosis. */
export function spo2Warning(spo2Pct: number, elevationM: number): string | null {
  if (!Number.isFinite(spo2Pct) || spo2Pct < 0 || spo2Pct > 100) return null;
  const expected = expectedSpo2(elevationM);
  if (expected == null || spo2Pct > expected - 5) return null;
  return `SpO2 ${Math.round(spo2Pct)}% is well below the rough ${expected}% expectation at ${Math.round(elevationM)} m. Recheck a warm finger, assess symptoms, stop ascent, and descend for severe symptoms.`;
}

/** Route-profile screening calculation using the app elevation-profile shape; it measures exposure, not acclimatization or medical risk. */
export function altitudeFromProfile(
  profile: Array<{ distanceMeters: number; elevation: number }>,
): AltitudeProfileSummary | null {
  if (!validProfile(profile)) return null;

  let totalGainM = 0;
  let metersAbove2500 = 0;
  let maxElevationM = profile[0].elevation;
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const current = profile[index];
    const distance = current.distanceMeters - previous.distanceMeters;
    const elevationChange = current.elevation - previous.elevation;
    if (elevationChange > 0) totalGainM += elevationChange;
    maxElevationM = Math.max(maxElevationM, current.elevation);

    if (distance === 0 || (previous.elevation < 2500 && current.elevation < 2500)) continue;
    if (previous.elevation >= 2500 && current.elevation >= 2500) {
      metersAbove2500 += distance;
      continue;
    }
    const crossing = (2500 - previous.elevation) / elevationChange;
    metersAbove2500 += previous.elevation >= 2500 ? distance * crossing : distance * (1 - crossing);
  }
  return {
    maxElevationM: roundOne(maxElevationM),
    totalGainM: roundOne(totalGainM),
    metersAbove2500: roundOne(metersAbove2500),
    crosses3000: profile.some((point) => point.elevation >= 3000),
  };
}

/** Wilderness Medical Society altitude guidance: staged acclimatization is advisable when sleeping above 3000 m. */
export function acclimatizationPlan(targetElevationM: number): string[] | null {
  if (!Number.isFinite(targetElevationM) || targetElevationM < 0 || targetElevationM > 9000) return null;
  if (targetElevationM <= 3000) return [];
  return [
    "Before the high camp, spend 1–2 nights around 2500–3000 m when the itinerary allows.",
    "Above 3000 m, increase sleeping elevation by no more than about 500 m per night.",
    "Take a rest/acclimatization day every 3–4 days or about each 1000 m of sleeping-elevation gain.",
    "Climb higher during the day only if well; sleep lower when practical.",
    "Do not ascend with AMS symptoms. Descend immediately for ataxia, altered mental status, or breathlessness at rest.",
  ];
}

/** Standard atmospheric rule-of-thumb: water boiling point is approximately 100 − 3.35 °C per 1000 m of elevation; local pressure varies. */
export function boilingPointC(elevationM: number): number | null {
  if (!Number.isFinite(elevationM) || elevationM < 0 || elevationM > 8000) return null;
  return roundOne(100 - (3.35 * elevationM) / 1000);
}
