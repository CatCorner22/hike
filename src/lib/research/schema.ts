import { z } from "zod";

/**
 * Every field here is model output derived from untrusted web text, persisted to
 * jsonb, cached for 24 h and then shipped to every client that views the trail.
 * Unbounded strings therefore mean unbounded database growth and unbounded
 * payload to a phone on a dying battery, so each field is capped at a length
 * that is generous for real advice and hostile to abuse.
 */
const LINE = 400;
const PARAGRAPH = 4_000;
const LIST = 20;

export const SOURCE_SYNTHESIS_SUMMARY =
  "Source excerpts were checked for the individual fields shown below. Verify critical details with the land manager before departure.";
export const MAPPED_METADATA_SUMMARY =
  "Only mapped trail metadata was available. Season, crowd, current condition, parking, and current-rule information is unknown unless explicitly noted below.";
export const UNKNOWN_SOURCE_DIFFICULTY =
  "Unknown — no source-backed difficulty evidence was available.";
export const UNKNOWN_SOURCE_PARKING =
  "Unknown — no source-backed parking evidence was available. Check current land-manager information before departure.";
export const UNKNOWN_MAPPED_DIFFICULTY =
  "Unknown — no difficulty evidence was available.";
export const UNKNOWN_MAPPED_PARKING =
  "Unknown — no parking evidence was available. Check current land-manager information before departure.";

export const researchEvidenceSchema = z.object({
  // These fields were added after v2 briefs had already been cached. Keeping
  // them optional here lets the persistence boundary parse those legacy
  // records so isCurrentResearchBrief can reject and refresh them safely.
  summary: z.array(z.string().url().max(2_048)).max(LIST).optional(),
  bestSeasons: z.array(z.string().url().max(2_048)).max(LIST),
  difficultyReality: z.array(z.string().url().max(2_048)).max(LIST).optional(),
  hazards: z.array(z.string().url().max(2_048)).max(LIST).optional(),
  parking: z.array(z.string().url().max(2_048)).max(LIST).optional(),
  permits: z.array(z.string().url().max(2_048)).max(LIST).optional(),
  crowdLevel: z.array(z.string().url().max(2_048)).max(LIST),
  conditions: z.array(z.string().url().max(2_048)).max(LIST),
  dogPolicy: z.array(z.string().url().max(2_048)).max(LIST).optional(),
  campingNearby: z.array(z.string().url().max(2_048)).max(LIST).optional(),
});

const currentResearchEvidenceSchema = researchEvidenceSchema.required();

export const researchSourceSchema = z.object({
  title: z.string().max(LINE),
  // Model output derived from web search results, rendered as an href.
  // Scheme is allow-listed at the render sink by safeSourceUrl below.
  url: z.string().url().max(2_048),
  provider: z.enum(["openstreetmap", "nps", "web"]).optional(),
});

export const trailResearchBriefSchema = z.object({
  schemaVersion: z.literal(2).optional(),
  summary: z.string().max(PARAGRAPH),
  bestSeasons: z.array(z.string().max(LINE)).max(LIST),
  difficultyReality: z.string().max(PARAGRAPH),
  hazards: z.array(z.string().max(LINE)).max(LIST),
  parking: z.string().max(PARAGRAPH),
  permits: z.string().max(PARAGRAPH).nullable(),
  crowdLevel: z.enum(["low", "moderate", "high", "unknown"]),
  conditions: z.string().max(PARAGRAPH).nullable().optional(),
  dogPolicy: z.string().max(LINE).nullable(),
  campingNearby: z.array(z.string().max(LINE)).max(LIST),
  sources: z.array(researchSourceSchema).max(LIST),
  evidence: researchEvidenceSchema.optional(),
  provenance: z.object({
    mode: z.enum(["source_synthesis", "mapped_metadata_only"]),
    parkCode: z.string().regex(/^[a-z]{4}$/).nullable(),
    parkName: z.string().max(LINE).nullable(),
  }).optional(),
  lastResearchedAt: z.string().max(LINE),
});

export type TrailResearchBrief = z.infer<typeof trailResearchBriefSchema>;

export interface ResearchFreshness {
  label: string;
  stale: boolean;
}

export interface ResearchBriefFieldTrust {
  cacheReusable: boolean;
  summary: boolean;
  bestSeasons: boolean;
  difficultyReality: boolean;
  hazards: boolean;
  parking: boolean;
  permits: boolean;
  crowdLevel: boolean;
  conditions: boolean;
  dogPolicy: boolean;
  campingNearby: boolean;
  sourceUrls: string[];
}

/**
 * The check time is not the observation time of every source. This helper
 * deliberately says "checked" rather than "current" and treats timestamps
 * far in the future as untrusted instead of letting them hide stale data.
 */
export function researchFreshness(
  researchedAt: string,
  nowMs = Date.now(),
): ResearchFreshness {
  const researchedMs = Date.parse(researchedAt);
  if (!Number.isFinite(researchedMs) || researchedMs > nowMs + 5 * 60 * 1_000) {
    return { label: "Research check time unavailable", stale: true };
  }

  const ageMs = Math.max(0, nowMs - researchedMs);
  const hours = Math.floor(ageMs / (60 * 60 * 1_000));
  if (hours < 1) return { label: "Checked less than an hour ago", stale: false };
  if (hours < 24) return { label: `Checked ${hours}h ago`, stale: false };

  const days = Math.floor(hours / 24);
  return { label: `Checked ${days}d ago`, stale: true };
}

const untrustedResearchFields = (): ResearchBriefFieldTrust => ({
  cacheReusable: false,
  summary: false,
  bestSeasons: false,
  difficultyReality: false,
  hazards: false,
  parking: false,
  permits: false,
  crowdLevel: false,
  conditions: false,
  dogPolicy: false,
  campingNearby: false,
  sourceUrls: [],
});

function isMappedDifficulty(value: string): boolean {
  return value === UNKNOWN_MAPPED_DIFFICULTY
    || /^OpenStreetMap (?:SAC scale|difficulty) tag: [\s\S]+$/.test(value);
}

function isMappedHazard(value: string): boolean {
  return value === "OpenStreetMap tags identify a ford on this route."
    || /^OpenStreetMap (?:hazard|exposure) tag: [\s\S]+$/.test(value);
}

function isMappedPermit(value: string | null): boolean {
  return value === null
    || value === "OpenStreetMap tags indicate a permit requirement. Verify the current rule with the land manager."
    || value === "OpenStreetMap tags indicate no permit requirement. Verify the current rule with the land manager.";
}

function isMappedDogPolicy(value: string | null): boolean {
  return value === null
    || /^OpenStreetMap dog-access tag: [\s\S]+\. Verify current land-manager rules\.$/.test(value);
}

function mappedMetadataTrust(brief: TrailResearchBrief): ResearchBriefFieldTrust {
  const evidence = currentResearchEvidenceSchema.safeParse(brief.evidence);
  if (!evidence.success) return untrustedResearchFields();
  const hasNoModelEvidence = Object.values(evidence.data).every((urls) => urls.length === 0);
  const sourceUrls = brief.sources.flatMap((source) => {
    const url = safeSourceUrl(source.url);
    return source.provider === "openstreetmap"
      && source.title === "OpenStreetMap trail record"
      && url
      && /^https:\/\/www\.openstreetmap\.org\/(?:node|way|relation)\/\d+$/.test(url)
      ? [url]
      : [];
  });
  const valid = hasNoModelEvidence
    && brief.summary === MAPPED_METADATA_SUMMARY
    && brief.bestSeasons.length === 0
    && isMappedDifficulty(brief.difficultyReality)
    && brief.hazards.every(isMappedHazard)
    && brief.parking === UNKNOWN_MAPPED_PARKING
    && isMappedPermit(brief.permits)
    && brief.crowdLevel === "unknown"
    && brief.conditions == null
    && isMappedDogPolicy(brief.dogPolicy)
    && brief.campingNearby.length === 0
    && sourceUrls.length === brief.sources.length
    && sourceUrls.length <= 1;
  if (!valid) return untrustedResearchFields();

  return {
    cacheReusable: true,
    summary: true,
    bestSeasons: true,
    difficultyReality: true,
    hazards: true,
    parking: true,
    permits: true,
    crowdLevel: true,
    conditions: true,
    dogPolicy: true,
    campingNearby: true,
    sourceUrls,
  };
}

function sourceSynthesisTrust(brief: TrailResearchBrief): ResearchBriefFieldTrust {
  const evidence = currentResearchEvidenceSchema.safeParse(brief.evidence);
  if (!evidence.success) return untrustedResearchFields();

  const sourceUrls = new Map<string, string>();
  let sourcesWellFormed = true;
  for (const source of brief.sources) {
    const url = safeSourceUrl(source.url);
    if (!url || (source.provider !== "nps" && source.provider !== "web") || sourceUrls.has(url)) {
      sourcesWellFormed = false;
      continue;
    }
    sourceUrls.set(url, url);
  }
  const evidenceIsDisplayed = (urls: string[]) => urls.length > 0 && urls.every((value) => {
    const url = safeSourceUrl(value);
    return Boolean(url && sourceUrls.has(url));
  });

  const summary = brief.summary === SOURCE_SYNTHESIS_SUMMARY
    && evidence.data.summary.length === 0;
  const bestSeasons = brief.bestSeasons.length === 0
    ? evidence.data.bestSeasons.length === 0
    : evidenceIsDisplayed(evidence.data.bestSeasons);
  const difficultyReality = brief.difficultyReality === UNKNOWN_SOURCE_DIFFICULTY
    ? evidence.data.difficultyReality.length === 0
    : evidenceIsDisplayed(evidence.data.difficultyReality);
  const hazards = brief.hazards.length === 0
    ? evidence.data.hazards.length === 0
    : evidenceIsDisplayed(evidence.data.hazards);
  const parking = brief.parking === UNKNOWN_SOURCE_PARKING
    ? evidence.data.parking.length === 0
    : evidenceIsDisplayed(evidence.data.parking);
  const permits = brief.permits === null
    ? evidence.data.permits.length === 0
    : evidenceIsDisplayed(evidence.data.permits);
  const crowdLevel = brief.crowdLevel === "unknown"
    ? evidence.data.crowdLevel.length === 0
    : evidenceIsDisplayed(evidence.data.crowdLevel);
  const conditions = brief.conditions == null
    ? evidence.data.conditions.length === 0
    : evidenceIsDisplayed(evidence.data.conditions);
  const dogPolicy = brief.dogPolicy === null
    ? evidence.data.dogPolicy.length === 0
    : evidenceIsDisplayed(evidence.data.dogPolicy);
  const campingNearby = brief.campingNearby.length === 0
    ? evidence.data.campingNearby.length === 0
    : evidenceIsDisplayed(evidence.data.campingNearby);

  const usedUrls = new Set<string>();
  const addEvidence = (trusted: boolean, hasClaim: boolean, urls: string[]) => {
    if (!trusted || !hasClaim) return;
    for (const value of urls) {
      const url = safeSourceUrl(value);
      if (url) usedUrls.add(url);
    }
  };
  addEvidence(bestSeasons, brief.bestSeasons.length > 0, evidence.data.bestSeasons);
  addEvidence(
    difficultyReality,
    brief.difficultyReality !== UNKNOWN_SOURCE_DIFFICULTY,
    evidence.data.difficultyReality,
  );
  addEvidence(hazards, brief.hazards.length > 0, evidence.data.hazards);
  addEvidence(parking, brief.parking !== UNKNOWN_SOURCE_PARKING, evidence.data.parking);
  addEvidence(permits, brief.permits !== null, evidence.data.permits);
  addEvidence(crowdLevel, brief.crowdLevel !== "unknown", evidence.data.crowdLevel);
  addEvidence(conditions, brief.conditions != null, evidence.data.conditions);
  addEvidence(dogPolicy, brief.dogPolicy !== null, evidence.data.dogPolicy);
  addEvidence(campingNearby, brief.campingNearby.length > 0, evidence.data.campingNearby);

  const everyDisplayedSourceUsed = sourceUrls.size === usedUrls.size
    && Array.from(sourceUrls.keys()).every((url) => usedUrls.has(url));
  const cacheReusable = sourcesWellFormed
    && everyDisplayedSourceUsed
    && summary
    && bestSeasons
    && difficultyReality
    && hazards
    && parking
    && permits
    && crowdLevel
    && conditions
    && dogPolicy
    && campingNearby;

  return {
    cacheReusable,
    summary,
    bestSeasons,
    difficultyReality,
    hazards,
    parking,
    permits,
    crowdLevel,
    conditions,
    dogPolicy,
    campingNearby,
    sourceUrls: Array.from(usedUrls),
  };
}

/**
 * Evaluates trust one field at a time so malformed cached data cannot turn the
 * presence of an evidence object into permission to render every claim.
 */
export function researchBriefFieldTrust(value: unknown): ResearchBriefFieldTrust {
  const parsed = trailResearchBriefSchema.safeParse(value);
  if (!parsed.success || parsed.data.schemaVersion !== 2 || !parsed.data.provenance) {
    return untrustedResearchFields();
  }
  return parsed.data.provenance.mode === "mapped_metadata_only"
    ? mappedMetadataTrust(parsed.data)
    : sourceSynthesisTrust(parsed.data);
}

/** Only briefs that satisfy every field/source invariant are safe to cache. */
export function isCurrentResearchBrief(value: unknown): value is TrailResearchBrief {
  return researchBriefFieldTrust(value).cacheReusable;
}

/**
 * Source URLs reach the brief by way of the model, which reads attacker-influenceable
 * web-search text. Only http(s) is ever safe to put in an href — everything else
 * (javascript:, data:, file:) is dropped rather than rendered.
 */
export function safeSourceUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}
