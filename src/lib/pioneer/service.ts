import { generateObject } from "ai";
import { parseContextFor } from "./context";
import { getPioneerConfig, PIONEER_UNAVAILABLE, resolveReads, type PioneerConfig } from "./config";
import { detectEscape, type EscapeHit } from "./escape";
import {
  instrumentObservations,
  measureGauges,
  toPioneerSuggestions,
  type PioneerGauges,
} from "./instrument";
import { pioneerModel } from "./provider";
import { PIONEER_PROMPT_VERSION, PIONEER_SYSTEM_PROMPT } from "./prompts";
import { isRegulatorySource } from "./public";
import {
  hasStrongClaim,
  resolveModes,
  resolveProfile,
  strictPromptAddendum,
  type PioneerMode,
  type PioneerProfileId,
} from "./router";
import {
  pioneerModelResponseSchema,
  validatePioneerResponse,
  type PioneerSnapshot,
  type PioneerSuggestion,
} from "./schemas";
import { verifySuggestion } from "./verify";

export interface CorroboratedSuggestion extends PioneerSuggestion {
  corroboration?: { seen: number; reads: number };
  tentative?: boolean;
}

export type PioneerOutcome =
  | {
    ok: true;
    suggestions: CorroboratedSuggestion[];
    source: "pioneer" | "instrument";
    refused: number;
    gauges: PioneerGauges;
    promptVersion: string;
    codes: string[];
    reads: number;
    modes: PioneerMode[];
    profile: PioneerProfileId;
  }
  | {
    ok: false;
    code:
      | "unavailable"
      | "perma-killed"
      | "escape-input"
      | "escape-model"
      | "verifier-rejected"
      | "model-error"
      | "invalid-shape"
      | "invalid-snapshot";
    message: string;
    codes: string[];
    escapeHits?: EscapeHit[];
    gauges?: PioneerGauges;
  };

export type GeneratePioneerFn = (args: {
  system: string;
  prompt: string;
}) => Promise<unknown>;

function instrumentOutcome(
  snapshot: PioneerSnapshot,
  modes: PioneerMode[],
  profile: PioneerProfileId,
  codes: string[] = [],
): Extract<PioneerOutcome, { ok: true }> {
  const gauges = measureGauges(snapshot);
  return {
    ok: true,
    suggestions: toPioneerSuggestions(instrumentObservations(snapshot)),
    source: "instrument",
    refused: 0,
    gauges,
    promptVersion: PIONEER_PROMPT_VERSION,
    codes,
    reads: 0,
    modes,
    profile,
  };
}

function consensusKey(suggestion: PioneerSuggestion): string {
  const anchor = (suggestion.evidence ?? suggestion.question ?? suggestion.say)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return `${suggestion.kind}|${anchor.slice(0, 60)}`;
}

const READ_LENSES = [
  "Focus this read on OFFLINE PACK and get-home gaps.",
  "Focus this read on SOURCE-BACKED research and condition unknowns (questions only).",
  "Focus this read on CACHED weather, official alerts, and return-time readiness.",
] as const;

async function defaultGenerate(args: { system: string; prompt: string }): Promise<unknown> {
  const { object } = await generateObject({
    model: pioneerModel(),
    schema: pioneerModelResponseSchema,
    system: args.system,
    prompt: args.prompt,
  });
  return object;
}

async function readOnce(
  generate: GeneratePioneerFn,
  system: string,
  parseContext: string,
  lens: string,
): Promise<
  | { ok: true; suggestions: PioneerSuggestion[] }
  | { ok: false; code: "escape-model" | "invalid-shape" | "model-error"; hits?: EscapeHit[]; codes: string[] }
> {
  let raw: unknown;
  try {
    raw = await generate({
      system,
      prompt: `${parseContext}\n\n${lens}\n\nReturn up to three objective observations that move this hike toward a prepared get-home state. Every observation about existing snapshot wording must include the exact quote in "evidence". Use questions for any missing fact. Do not address the hiker directly. Do not calculate coordinates, bearings, or remaining distance.`,
    });
  } catch {
    return { ok: false, code: "model-error", codes: ["model-error"] };
  }

  const outputHits = detectEscape(JSON.stringify(raw));
  if (outputHits.length > 0) {
    return { ok: false, code: "escape-model", hits: outputHits, codes: outputHits.map((hit) => hit.signal) };
  }
  const parsed = validatePioneerResponse(raw);
  if (!parsed) return { ok: false, code: "invalid-shape", codes: ["invalid-shape"] };
  return { ok: true, suggestions: parsed.suggestions.slice(0, 3) };
}

export async function runPioneer(
  snapshot: PioneerSnapshot,
  opts: {
    env?: Record<string, string | undefined>;
    config?: PioneerConfig;
    permaKilled?: boolean;
    reads?: number;
    generate?: GeneratePioneerFn;
  } = {},
): Promise<PioneerOutcome> {
  const config = opts.config ?? getPioneerConfig(opts.env);
  const modes = resolveModes(snapshot);
  const profile = resolveProfile(modes);
  const gauges = measureGauges(snapshot);
  const parseContext = parseContextFor(snapshot);

  if (opts.permaKilled || config.silentlyKilled) {
    return {
      ok: false,
      code: "perma-killed",
      message: PIONEER_UNAVAILABLE,
      codes: ["perma-killed"],
      gauges,
    };
  }

  const inputHits = detectEscape(JSON.stringify(snapshot));
  if (inputHits.length > 0) {
    return {
      ok: false,
      code: "escape-input",
      message: PIONEER_UNAVAILABLE,
      codes: inputHits.map((hit) => hit.signal),
      escapeHits: inputHits,
      gauges,
    };
  }

  if (!config.enabled) {
    return instrumentOutcome(snapshot, modes, profile.id, ["not-enabled"]);
  }

  const system = [
    PIONEER_SYSTEM_PROMPT,
    strictPromptAddendum(profile, modes),
    `--- ${parseContext}`,
  ].filter(Boolean).join("\n\n");

  const reads = Math.min(3, Math.max(opts.reads ?? resolveReads(opts.env), profile.minReads));
  const generate = opts.generate ?? defaultGenerate;
  const results = await Promise.all(
    Array.from({ length: reads }, (_, index) =>
      readOnce(generate, system, parseContext, READ_LENSES[index % READ_LENSES.length]!),
    ),
  );

  const escaped = results.find(
    (result): result is Extract<(typeof results)[number], { ok: false }> =>
      !result.ok && result.code === "escape-model",
  );
  if (escaped) {
    return {
      ok: false,
      code: "escape-model",
      message: PIONEER_UNAVAILABLE,
      codes: escaped.codes,
      escapeHits: escaped.hits,
      gauges,
    };
  }

  const successful = results.filter(
    (result): result is Extract<(typeof results)[number], { ok: true }> => result.ok,
  );
  if (successful.length < profile.minReads) {
    return instrumentOutcome(
      snapshot,
      modes,
      profile.id,
      successful.length === 0 ? ["model-error"] : ["insufficient-reads"],
    );
  }

  const needed = profile.unanimous
    ? successful.length
    : Math.floor(successful.length / 2) + 1;
  const byKey = new Map<string, { suggestion: PioneerSuggestion; seen: number }>();
  for (const read of successful) {
    const seenThisRead = new Set<string>();
    for (const suggestion of read.suggestions) {
      const key = consensusKey(suggestion);
      if (seenThisRead.has(key)) continue;
      seenThisRead.add(key);
      const existing = byKey.get(key);
      if (existing) existing.seen += 1;
      else byKey.set(key, { suggestion, seen: 1 });
    }
  }

  const kept: CorroboratedSuggestion[] = [];
  const codes: string[] = [];
  let refused = 0;
  for (const { suggestion, seen } of byKey.values()) {
    if (seen < needed) {
      refused += 1;
      codes.push("no-consensus");
      continue;
    }
    const reason = verifySuggestion(parseContext, snapshot, suggestion);
    if (reason === "escape-model") {
      return {
        ok: false,
        code: "escape-model",
        message: PIONEER_UNAVAILABLE,
        codes: [reason],
        gauges,
      };
    }
    if (reason) {
      refused += 1;
      codes.push(reason);
      continue;
    }
    const out: CorroboratedSuggestion = successful.length > 1
      ? { ...suggestion, corroboration: { seen, reads: successful.length } }
      : { ...suggestion };
    if (hasStrongClaim(suggestion.say, suggestion.why) && !isRegulatorySource(suggestion.source)) {
      out.tentative = true;
      codes.push("tentative-strong-claim");
    }
    kept.push(out);
    if (kept.length >= 3) break;
  }

  if (kept.length === 0) {
    return instrumentOutcome(snapshot, modes, profile.id, codes.length ? codes : ["verifier-rejected"]);
  }

  return {
    ok: true,
    suggestions: kept,
    source: "pioneer",
    refused,
    gauges,
    promptVersion: PIONEER_PROMPT_VERSION,
    codes,
    reads: successful.length,
    modes,
    profile: profile.id,
  };
}
