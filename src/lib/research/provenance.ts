/**
 * Research language is not evidence. These classes describe where a displayed
 * source came from so a hiker can decide whether to verify it before relying on
 * it. They do not make an AI summary authoritative.
 */
export const RESEARCH_EVIDENCE_CLASSES = [
  "official",
  "community",
  "ai-inferred",
  "unverified",
] as const;

export type ResearchEvidenceClass = (typeof RESEARCH_EVIDENCE_CLASSES)[number];

export const RESEARCH_FRESHNESS_STATES = ["fresh", "aging", "stale", "unknown"] as const;

export type ResearchFreshness = (typeof RESEARCH_FRESHNESS_STATES)[number];

/**
 * Source citations can identify supporting material, but a model-authored
 * synthesis remains an inference. This prevents a citation from laundering an
 * AI claim into an asserted fact.
 */
export function classifyResearchClaim(): ResearchEvidenceClass {
  return "ai-inferred";
}

/** A web result is current enough to be called fresh for only one day. */
export const RESEARCH_SOURCE_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * A week-old trail source may still be useful context, but conditions and
 * regulations can change quickly enough that it must no longer look current.
 */
export const RESEARCH_SOURCE_AGING_MS = 7 * 24 * 60 * 60 * 1000;

const COMMUNITY_DOMAINS = [
  "alltrails.com",
  "hikingproject.com",
  "mountainproject.com",
  "openstreetmap.org",
  "reddit.com",
  "summitpost.org",
  "trailforks.com",
  "wikiloc.com",
  "wikipedia.org",
] as const;

function isDomainOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Classify only syntactically valid http(s) source URLs. Unknown publishers and
 * malformed inputs are deliberately unverified: a reassuring guess about the
 * publisher is less safe than exposing the uncertainty.
 */
export function classifyResearchSourceUrl(url: unknown): ResearchEvidenceClass {
  if (typeof url !== "string" || url.trim().length === 0) return "unverified";

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "unverified";

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname) return "unverified";

    // A .gov registrant is a government entity; the explicit recreation.gov
    // check retains that classification even if domain policy changes later.
    if (hostname.endsWith(".gov") || hostname === "recreation.gov") return "official";
    if (COMMUNITY_DOMAINS.some((domain) => isDomainOrSubdomain(hostname, domain))) {
      return "community";
    }
  } catch {
    return "unverified";
  }

  return "unverified";
}

/**
 * Compute freshness at display time rather than trusting a state cached with
 * the brief. A cached "fresh" label is dangerous once the source ages.
 */
export function researchSourceFreshness(retrievedAt: unknown, now = Date.now()): ResearchFreshness {
  if (typeof retrievedAt !== "string" || !Number.isFinite(now)) return "unknown";

  const retrievedMs = Date.parse(retrievedAt);
  if (!Number.isFinite(retrievedMs) || retrievedMs > now) return "unknown";

  const ageMs = now - retrievedMs;
  if (ageMs <= RESEARCH_SOURCE_FRESH_MS) return "fresh";
  if (ageMs <= RESEARCH_SOURCE_AGING_MS) return "aging";
  return "stale";
}
