// SOURCE ALLOW-LIST — observations must cite a reputable wilderness / app label.
// Refusing unknown sources stops the pioneer from drifting into invented
// authority strings on the way to the screen.

const ALLOWED_PREFIXES = [
  "klandagi instrument",
  "klandagi readiness",
  "trail research",
  "openstreetmap",
  "nps",
  "national park",
  "nws",
  "national weather",
  "recreation.gov",
  "ridb",
  "land manager",
  "sac scale",
  "avalanche",
  "usgs",
] as const;

export function isAllowedSource(source: string): boolean {
  const lower = source.trim().toLowerCase();
  if (lower.length < 3) return false;
  return ALLOWED_PREFIXES.some((prefix) => lower.startsWith(prefix) || lower.includes(prefix));
}

const REGULATORY_PREFIXES = [
  "nps",
  "national park",
  "nws",
  "national weather",
  "land manager",
  "usgs",
  "recreation.gov",
  "ridb",
] as const;

export function isRegulatorySource(source: string): boolean {
  const lower = source.trim().toLowerCase();
  return REGULATORY_PREFIXES.some((prefix) => lower.startsWith(prefix) || lower.includes(prefix));
}

/** Strip copyable evidence before the response reaches the hiker. */
export function toObservationalSuggestion(suggestion: {
  kind: string;
  say: string;
  why: string;
  question?: string;
  source: string;
  corroboration?: { seen: number; reads: number };
  tentative?: boolean;
  evidence?: string;
}) {
  return {
    kind: suggestion.kind,
    say: suggestion.say,
    why: suggestion.why,
    ...(suggestion.question ? { question: suggestion.question } : {}),
    source: suggestion.source,
    ...(suggestion.corroboration ? { corroboration: suggestion.corroboration } : {}),
    ...(suggestion.tentative ? { tentative: true } : {}),
  };
}
