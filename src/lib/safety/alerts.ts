import { OFF_TRAIL_CRITICAL_METERS, OFF_TRAIL_WARN_METERS } from "@/lib/constants";

export type OffTrailLevel = "ok" | "warn" | "critical";

export function offTrailLevel(
  offsetMeters: number,
  accuracyMeters?: number,
  options: { trustedFix?: boolean } = {},
): OffTrailLevel {
  if (options.trustedFix === false) return "ok";
  if (!Number.isFinite(offsetMeters)) return "ok";

  const accuracy = Number.isFinite(accuracyMeters) ? (accuracyMeters as number) : 0;
  const adjusted = Math.max(0, offsetMeters - accuracy * 0.5);
  if (adjusted > OFF_TRAIL_CRITICAL_METERS) return "critical";
  if (adjusted > OFF_TRAIL_WARN_METERS) return "warn";
  // Poor GPS can hide a real walk-off — still warn when raw offset is large.
  if (offsetMeters > 100 && accuracy > 40) return "warn";
  return "ok";
}

const VIBRATION_PATTERNS: Record<OffTrailLevel, number[]> = {
  ok: [],
  warn: [120, 80, 120],
  critical: [200, 100, 200, 100, 400],
};

export function vibrateOffTrail(level: OffTrailLevel) {
  if (level === "ok" || typeof navigator === "undefined" || !navigator.vibrate) return;
  navigator.vibrate(VIBRATION_PATTERNS[level]);
}

export function shouldRepeatAlert(
  lastAlertAt: number | null,
  level: OffTrailLevel,
  now = Date.now(),
): boolean {
  if (level === "ok") return false;
  const interval = level === "critical" ? 12_000 : 30_000;
  return lastAlertAt == null || now - lastAlertAt >= interval;
}
