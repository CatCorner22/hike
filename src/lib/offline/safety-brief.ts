import type { DecisionPoint } from "@/lib/safety/decision-support";
import type { PackWeather } from "@/lib/offline/pack-weather";

export interface SafetyBriefSource {
  label: string;
  observedAt?: string;
  retrievedAt: string;
  expiresAt?: string;
  url?: string;
}

export interface SafetyBriefNotice {
  id: string;
  severity: "info" | "watch" | "critical";
  title: string;
  detail?: string;
  source?: SafetyBriefSource;
}

export interface OfflineSafetyBrief {
  generatedAt: string;
  weather?: PackWeather;
  decisionPoints: DecisionPoint[];
  notices: SafetyBriefNotice[];
  /** Human-entered planning note; never represented as authoritative source data. */
  planningNote?: string;
}

export function safetyBriefFreshness(brief: OfflineSafetyBrief, now = Date.now()): "fresh" | "stale" | "unknown" {
  const expiries = brief.notices
    .map((notice) => notice.source?.expiresAt ? Date.parse(notice.source.expiresAt) : Number.NaN)
    .filter(Number.isFinite);
  if (!expiries.length) return "unknown";
  return expiries.some((expiry) => expiry < now) ? "stale" : "fresh";
}

export function criticalNotices(brief: OfflineSafetyBrief): SafetyBriefNotice[] {
  return brief.notices.filter((notice) => notice.severity === "critical");
}
