export type OffTrailLevel = "ok" | "warn" | "critical";

export function offTrailLevel(
  offsetMeters: number,
  accuracyMeters?: number,
): OffTrailLevel {
  const adjusted = Math.max(0, offsetMeters - (accuracyMeters ?? 0) * 0.5);
  if (adjusted > 80) return "critical";
  if (adjusted > 35) return "warn";
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
