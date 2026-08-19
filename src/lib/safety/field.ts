import { gpxFromTrack } from "@/lib/geo";
import { formatRangeAzimuth, rangeAzimuth, type RangeAzimuth } from "@/lib/safety/landnav";
import type { IceProfile, SafetyWaypoint } from "@/lib/safety/profile";

export function isIceFilled(profile: IceProfile): boolean {
  const digits = profile.icePhone.replace(/\D/g, "");
  return profile.iceName.trim().length >= 2 && digits.length >= 7;
}

export function hypothermiaWarning(input: {
  isDark: boolean;
  altitudeM?: number;
  stationaryMin?: number;
}): string | null {
  const alt = input.altitudeM ?? 0;
  const still = input.stationaryMin ?? 0;
  if (input.isDark && alt >= 2000) {
    return "Night above 2,000 m — hypothermia risk. Stay dry, add layers, keep moving if you can.";
  }
  if (input.isDark && still >= 15) {
    return "Stopped after dark. Put on a layer now — heat loss is fast when still.";
  }
  if (alt >= 3000 && still >= 10) {
    return "High and still. Wind chill and altitude illness both rise if you stay put.";
  }
  return null;
}

export function waterReminder(
  lastDrinkAt: number | null,
  startedAt: number | null,
  now = Date.now(),
  intervalMs = 30 * 60_000,
): string | null {
  const baseline = lastDrinkAt ?? startedAt;
  if (baseline == null) return null;
  const elapsed = now - baseline;
  if (elapsed < intervalMs) return null;
  return `No water logged for ${Math.round(elapsed / 60_000)} min. Sip now — dehydration hits before thirst in dry air.`;
}

export interface TrackSample {
  lat: number;
  lng: number;
  recordedAt?: number | string;
}

function sampleTime(p: TrackSample, fallback: number): number {
  if (typeof p.recordedAt === "number") return p.recordedAt;
  if (p.recordedAt) {
    const t = Date.parse(p.recordedAt);
    return Number.isFinite(t) ? t : fallback;
  }
  return fallback;
}

function haversineMeters(a: TrackSample, b: TrackSample): number {
  const r = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * GPS-only fall heuristic: a walking pace that collapses to nearly still
 * within ~20 s. Not a medical sensor — just a “check yourself” prompt.
 */
export function suddenStopWarning(points: TrackSample[], now = Date.now()): string | null {
  if (points.length < 4) return null;
  const recent = points.slice(-6);
  let sawFast = false;
  let stopAt: number | null = null;

  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1];
    const b = recent[i];
    const dt = sampleTime(b, now) - sampleTime(a, now);
    if (dt <= 400 || dt > 45_000) continue;
    const speed = haversineMeters(a, b) / (dt / 1000);
    if (speed >= 1.6) {
      sawFast = true;
      stopAt = null;
    } else if (sawFast && speed < 0.2) {
      stopAt = sampleTime(b, now);
    }
  }

  if (stopAt == null || now - stopAt > 2 * 60_000) return null;
  return "Sudden stop after moving. If you fell, stay put and open SOS. If you are OK, keep walking.";
}

export function nearestWaypoint(
  here: { lat: number; lng: number },
  waypoints: Array<Pick<SafetyWaypoint, "lat" | "lng" | "kind" | "id">>,
): { point: (typeof waypoints)[number]; range: RangeAzimuth; label: string } | null {
  if (waypoints.length === 0) return null;
  let best: { point: (typeof waypoints)[number]; range: RangeAzimuth } | null = null;
  for (const point of waypoints) {
    const range = rangeAzimuth(here, point);
    if (!best || range.meters < best.range.meters) best = { point, range };
  }
  if (!best) return null;
  return {
    ...best,
    label: `Nearest ${best.point.kind.toUpperCase()}: ${formatRangeAzimuth(best.range)}`,
  };
}

export interface SelfCheckItem {
  id: string;
  ok: boolean;
  label: string;
}

export function safetySelfCheck(input: {
  packReady: boolean;
  gpsTrusted: boolean;
  iceFilled: boolean;
  returnSet: boolean;
  wakeLock: boolean;
  crumbs: number;
}): SelfCheckItem[] {
  return [
    {
      id: "pack",
      ok: input.packReady,
      label: input.packReady
        ? "Offline route pack is on this phone"
        : "No offline pack — do not leave coverage",
    },
    {
      id: "gps",
      ok: input.gpsTrusted,
      label: input.gpsTrusted ? "GPS fix is live" : "GPS is not live — last-known only",
    },
    {
      id: "ice",
      ok: input.iceFilled,
      label: input.iceFilled
        ? "ICE name and phone are filled"
        : "Add an ICE name and phone before you need them",
    },
    {
      id: "return",
      ok: input.returnSet,
      label: input.returnSet
        ? "Return / overdue timer is set"
        : "Set a planned return so this phone can flag overdue",
    },
    {
      id: "wake",
      ok: input.wakeLock,
      label: input.wakeLock
        ? "Screen wake lock is held"
        : "Screen may sleep — keep the display on if you can",
    },
    {
      id: "crumbs",
      ok: input.crumbs >= 2,
      label:
        input.crumbs >= 2
          ? `Breadcrumbs ready (${input.crumbs} points) — backtrack / GPX available`
          : "Walk a few meters so breadcrumbs can start",
    },
  ];
}

export function breadcrumbGpx(
  name: string,
  points: Array<{ lat: number; lng: number; altitude?: number; recordedAt?: string | number }>,
): string {
  return gpxFromTrack(
    name,
    points.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      elevation: p.altitude,
      recordedAt: p.recordedAt != null ? new Date(p.recordedAt) : undefined,
    })),
  );
}

export function downloadTextFile(filename: string, text: string, mime = "application/gpx+xml") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "hike-track";
}
