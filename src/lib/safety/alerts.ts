import { vibratePattern } from "@/lib/platform/haptics";
export type OffTrailLevel = "ok" | "warn" | "critical" | "unknown";

export function offTrailLevel(
  offsetMeters: number,
  accuracyMeters?: number,
  options: { trustedFix?: boolean } = {},
): OffTrailLevel {
if (
    !Number.isFinite(offsetMeters) ||
    offsetMeters < 0 ||
    (accuracyMeters !== undefined && (!Number.isFinite(accuracyMeters) || accuracyMeters < 0))
  ) {
    return "unknown";
  }
  if (options.trustedFix === false) return "unknown";

  const accuracy = Number.isFinite(accuracyMeters) ? (accuracyMeters as number) : 0;
  const adjusted = Math.max(0, offsetMeters - accuracy * 0.5);
  if (adjusted > 80) return "critical";
  if (adjusted > 35) return "warn";
  // Poor GPS can hide a real walk-off — still warn when raw offset is large.
  if (offsetMeters > 100 && accuracy > 40) return "warn";
  return "ok";
}

const VIBRATION_PATTERNS: Record<OffTrailLevel, number[]> = {
  ok: [],
  warn: [120, 80, 120],
  critical: [200, 100, 200, 100, 400],
  unknown: [80, 80, 80],
};

export function vibrateOffTrail(level: OffTrailLevel) {
  if (level === "ok") return;
  // Through the platform seam: navigator.vibrate does not exist on iOS, where
  // the Capacitor shell registers a haptics adapter walking the same patterns.
  vibratePattern(VIBRATION_PATTERNS[level]);
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
