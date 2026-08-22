import { compassLabel, normalizeHeading } from "@/lib/geo/navigation";
import { gmAngleCard, toMagneticBearing } from "@/lib/safety/declination";
import { formatReport, reportField } from "@/lib/safety/report-field";

export interface CompassReadout {
  trueDeg: number;
  magneticDeg: number | null;
  cardinal: string;
  gmNote: string | null;
  label: string;
}

/** Format a heading for HUD and radio readback. */
export function compassReadout(
  headingTrue: number | null | undefined,
  lat?: number | null,
  lng?: number | null,
): CompassReadout | null {
  if (headingTrue == null || !Number.isFinite(headingTrue)) return null;
  const trueDeg = normalizeHeading(headingTrue);
  if (trueDeg == null) return null;
  const cardinal = compassLabel(trueDeg);
  if (cardinal == null) return null;
  const gm =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      ? gmAngleCard(lat, lng)
      : null;
  const magneticDeg =
    gm?.declination != null
      ? normalizeHeading(toMagneticBearing(trueDeg, gm.declination))
      : null;
  const label =
    magneticDeg != null
      ? `${Math.round(trueDeg)}° true · ${Math.round(magneticDeg)}° mag · ${cardinal}`
      : `${Math.round(trueDeg)}° true · ${cardinal}`;
  return {
    trueDeg,
    magneticDeg,
    cardinal,
    gmNote: gm ? `${gm.gridToMagnetic} · ${gm.lars}` : null,
    label,
  };
}

export function formatCompassCard(input: {
  headingTrue?: number | null;
  lat?: number | null;
  lng?: number | null;
  source?: string;
}): string {
  const readout = compassReadout(input.headingTrue, input.lat, input.lng);
  return formatReport([
    "COMPASS READOUT",
    input.source ? `Source: ${reportField(input.source)}` : null,
    readout ? readout.label : "Heading unavailable — enter true degrees for dead reckoning.",
    readout?.gmNote ? `G-M: ${reportField(readout.gmNote)}` : null,
    "Trust map + compass over phone GPS in timber or near cliffs.",
    "When stationary, GPS heading may freeze — use sun, watch, or last movement.",
  ]);
}

/** Cardinal tick labels for a compass rose (0 = north, clockwise). */
export const COMPASS_ROSE_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
