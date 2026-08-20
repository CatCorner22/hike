import type { Severity } from "@/lib/safety/severity";

export const DISCLAIMER =
  "Planning aid, not a guarantee of radio coverage or rescue. Carry a satellite SOS device for remote travel and call local emergency services when possible.";

export interface RangeAdvice {
  km: number | null;
  severity: Severity;
  message: string;
}

export interface RadioService {
  service: string;
  band: string;
  licence: string;
  typicalRangeKm: string;
  notes: string;
}

export interface EmergencyChannel {
  channel: string;
  use: string;
}

export interface PacePlan {
  primary: string;
  alternate: string;
  contingency: string;
  emergency: string;
}

const HORIZON_COEFFICIENT = 3.57;
const MAX_CHECK_INS = 48;

/** Radio line-of-sight geometry: d(km) ≈ 3.57 × √height(m). A 4/3-Earth-radius refraction model gives a modestly longer radio horizon. */
export function radioHorizonKm(antennaHeightM: number): number | null {
  if (!Number.isFinite(antennaHeightM) || antennaHeightM < 0) return null;
  return Math.round(HORIZON_COEFFICIENT * Math.sqrt(antennaHeightM) * 10) / 10;
}

/** Radio line-of-sight geometry: practical simplex range is the sum of each station's geometric horizon, before terrain and vegetation loss. */
export function lineOfSightRangeKm(h1M: number, h2M: number): number | null {
  if (!Number.isFinite(h1M) || !Number.isFinite(h2M) || h1M < 0 || h2M < 0) return null;
  return Math.round(HORIZON_COEFFICIENT * (Math.sqrt(h1M) + Math.sqrt(h2M)) * 10) / 10;
}

/** FCC VHF/UHF propagation guidance: terrain blocking defeats line of sight; gaining high ground normally improves coverage more than adding transmit power. */
export function rangeAdvice(input: {
  myElevationM: number;
  theirElevationM: number;
  terrainBlocked: boolean;
}): RangeAdvice {
  const km = lineOfSightRangeKm(input.myElevationM, input.theirElevationM);
  if (km == null) {
    return {
      km: null,
      severity: "caution",
      message: "Enter non-negative, finite site heights. Treat any calculated range as a planning estimate, not coverage.",
    };
  }
  if (input.terrainBlocked) {
    return {
      km: null,
      severity: "warning",
      message:
        "Terrain blocks the path — simplex contact may fail regardless of the geometric horizon. Move to high ground if safe; getting to high ground is worth more than more transmit power.",
    };
  }
  return {
    km,
    severity: "info",
    message: `Geometric line-of-sight horizon is ~${km} km before trees, rock, buildings, antenna quality, and weather. Getting to high ground is worth more than more transmit power.`,
  };
}

/** FCC Part 95, FCC amateur licensing, NOAA Weather Radio, and USCG marine-VHF guidance; stated ranges are terrain-dependent planning ranges, not promises. */
export function radioServices(): RadioService[] {
  return [
    {
      service: "FRS",
      band: "462/467 MHz UHF",
      licence: "FCC licence-free; channel-specific power limits apply",
      typicalRangeKm: "0.5–3 handheld-to-handheld; farther line of sight",
      notes: "Family Radio Service. Fixed antennas and repeaters are not permitted; many channels are shared with GMRS.",
    },
    {
      service: "GMRS",
      band: "462/467 MHz UHF",
      licence: "FCC GMRS licence required; no exam",
      typicalRangeKm: "1–8 handheld simplex; farther from high sites or through repeaters",
      notes: "A family licence can cover immediate family. Repeaters may extend range but are not a wilderness rescue service.",
    },
    {
      service: "MURS",
      band: "151/154 MHz VHF",
      licence: "FCC licence-free; generally limited to 2 W transmitter output",
      typicalRangeKm: "1–5 handheld-to-handheld; farther line of sight",
      notes: "Five VHF channels; external antennas are allowed within FCC rules. No repeaters.",
    },
    {
      service: "Amateur 2 m / 70 cm",
      band: "144–148 MHz VHF / 420–450 MHz UHF",
      licence: "FCC amateur licence required; pass an exam",
      typicalRangeKm: "2–15 simplex; repeaters can reach much farther",
      notes: "Use only within licence privileges and local band plans. Repeaters and calling frequencies are not reliably monitored in backcountry.",
    },
    {
      service: "Marine VHF",
      band: "156–162 MHz VHF",
      licence: "Marine use only; most US recreational vessels in domestic waters need no individual station licence",
      typicalRangeKm: "5–15 vessel-to-vessel; more to a high coast station",
      notes: "For navigation and safety on water, not hiking. Channel 16 is the distress, safety, and calling channel.",
    },
    {
      service: "NOAA Weather Radio",
      band: "162.400–162.550 MHz VHF",
      licence: "Receive-only; no transmit licence applies because you do not transmit",
      typicalRangeKm: "Varies by transmitter and terrain",
      notes: "Useful for forecasts and watches where reception exists; it is not a two-way emergency channel.",
    },
  ];
}

/** ARRL national calling frequencies, FCC GMRS/FRS channel plans, and USCG Channel 16 guidance. In US backcountry, no channel has reliable listeners; carry a satellite device. */
export function emergencyChannels(): EmergencyChannel[] {
  return [
    {
      channel: "146.520 MHz FM",
      use: "US amateur 2 m national simplex calling frequency; amateur licence required to transmit.",
    },
    {
      channel: "446.000 MHz FM",
      use: "US amateur 70 cm national simplex calling frequency; amateur licence required to transmit.",
    },
    {
      channel: "FRS/GMRS Channel 16 (462.575 MHz)",
      use: "Often used as a calling or emergency-contact channel; follow the service and power rules for your radio.",
    },
    {
      channel: "Marine VHF Channel 16 (156.800 MHz)",
      use: "International distress, safety, and calling for marine use only; monitor and use under marine-VHF rules.",
    },
    {
      channel: "Backcountry reality",
      use: "No US backcountry calling channel is reliably monitored. A satellite messenger or PLB is the dependable emergency layer outside cellular coverage.",
    },
  ];
}

/** PACE communications planning doctrine: define an independent Primary, Alternate, Contingency, and Emergency method before departure. */
export function pacePlan(input: PacePlan): PacePlan {
  return {
    primary: input.primary.trim(),
    alternate: input.alternate.trim(),
    contingency: input.contingency.trim(),
    emergency: input.emergency.trim(),
  };
}

/** PACE communications planning doctrine: a concise, labelled plan is easier for a party and home contact to use under stress. */
export function formatPacePlan(plan: PacePlan): string {
  return [
    "PACE COMMUNICATIONS PLAN",
    `P — PRIMARY: ${plan.primary}`,
    `A — ALTERNATE: ${plan.alternate}`,
    `C — CONTINGENCY: ${plan.contingency}`,
    `E — EMERGENCY: ${plan.emergency}`,
  ].join("\n");
}

/** PACE communications planning doctrine adapted for US backcountry travel; use independent communications paths rather than four versions of a phone. */
export function pacePlanTemplate(): PacePlan {
  return {
    primary: "Satellite messenger two-way check-in and SOS",
    alternate: "Licensed radio on the agreed channel or repeater",
    contingency: "Prearranged check-in with a home contact and overdue-action time",
    emergency: "Registered PLB activation; stay put if the site is safe",
  };
}

/** NOAA SARSAT and manufacturer guidance: PLBs send a 406 MHz distress through government SARSAT systems; commercial messengers use subscriptions and support two-way text. */
export function satelliteDeviceGuidance(): string[] {
  return [
    "Register a PLB in the NOAA beacon database and keep emergency contacts and trip details current.",
    "A PLB sends a 406 MHz distress through the government SARSAT system. It has no routine two-way messaging and normally has no subscription.",
    "A commercial satellite messenger normally needs an active subscription and can provide two-way text, tracking, and SOS through its provider.",
    "Test and charge the device before departure; carry it on your body or the outside of the pack, not buried in it.",
    "For messages or SOS, use an open area with the clearest practical sky view and keep the antenna oriented as instructed by its maker.",
  ];
}

/** NOAA SARSAT personal locator beacon guidance: an activated beacon must remain on and have the best available sky view so responders can locate it. */
export function plbActivationSteps(): string[] {
  return [
    "Use the PLB only for grave and imminent danger when other practical options are not enough.",
    "Activate it in the open with the clearest available sky view; follow the beacon's labelled deployment steps.",
    "Once activated, leave it on. Do not switch it off because you have not yet heard a response.",
    "Stay put once activated if the location is safe; make shelter, signal visibly, and conserve battery on other devices.",
    "If you must move from immediate danger, take the active beacon with you and leave a clear note or marker at the original location.",
  ];
}

/** Backcountry trip-plan practice: a predictable schedule and an explicit cap prevent an accidental notification flood on long itineraries. */
export function checkInSchedule(input: {
  departureIso: string;
  expectedReturnIso: string;
  intervalHours: number;
}): string[] | null {
  const departureMs = Date.parse(input.departureIso);
  const returnMs = Date.parse(input.expectedReturnIso);
  if (
    !Number.isFinite(departureMs) ||
    !Number.isFinite(returnMs) ||
    !Number.isFinite(input.intervalHours) ||
    input.intervalHours <= 0 ||
    returnMs <= departureMs
  ) {
    return null;
  }

  const intervalMs = input.intervalHours * 60 * 60 * 1000;
  const schedule: string[] = [new Date(departureMs).toISOString()];
  for (let at = departureMs + intervalMs; at < returnMs && schedule.length < MAX_CHECK_INS - 1; at += intervalMs) {
    schedule.push(new Date(at).toISOString());
  }
  if (schedule.length < MAX_CHECK_INS) schedule.push(new Date(returnMs).toISOString());
  return schedule;
}

/** National Park Service trip-plan guidance: a home contact needs a defined overdue threshold and enough facts to give SAR, not an immediate vague alarm. */
export function missedCheckInPolicy(): string[] {
  return [
    "Before departure, give the home contact the route, party names, vehicle description and plate, devices carried, check-in times, and expected return time.",
    "At a missed check-in, try the agreed message, phone, and satellite channels once or twice; do not assume silence means a rescue is needed.",
    "At the pre-agreed overdue-action time, check the trailhead or vehicle only if it can be done safely and without delaying a report.",
    "Call the responsible county sheriff, park dispatch, or 911 when the party is overdue by the agreed threshold, an SOS arrives, or there is evidence of distress.",
    "Give SAR the exact itinerary, last confirmed time and location, medical concerns, clothing and equipment, and device/account information. Do not organize an uncoordinated search.",
  ];
}
