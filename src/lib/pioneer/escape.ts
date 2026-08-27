// ESCAPE DETECTION — the backstop between the pioneer and the rest of the app.
//
// Pioneer is allowed to adjust ONLY its own observation ranking and wording.
// Anything that looks like a write to the plan, a request for engine access, a
// probe for the killswitch, a navigation-math invention, or an instruction to
// ignore the rails is refused HERE, before a human ever sees it.
//
// The model is never told these patterns exist.

export type EscapeKind =
  | "write-path"
  | "engine-access"
  | "killswitch-probe"
  | "jailbreak"
  | "self-modification"
  | "nav-math"
  | "rescue";

export interface EscapeHit {
  kind: EscapeKind;
  /** A short constant label for the log — never a quote from the model. */
  signal: string;
}

const PATTERNS: { kind: EscapeKind; signal: string; re: RegExp }[] = [
  {
    kind: "write-path",
    signal: "mutate-plan",
    re: /\b(i(?:'| a)?ve updated|i (?:have )?changed|applied to (?:the )?(?:plan|pack|note)|writing (?:this )?into|insert(?:ed)? into (?:the )?(?:plan|pack)|auto[- ]?apply)\b/i,
  },
  {
    kind: "engine-access",
    signal: "engine-probe",
    re: /\b(show(?: me)? (?:the )?(?:source|code|ruleset|prompt)|access (?:the )?(?:database|engine|filesystem|repo)|modify (?:the )?(?:audit|transformer|parser)|run shell|execute code)\b/i,
  },
  {
    kind: "killswitch-probe",
    signal: "kill-probe",
    re: /\b(PIONEER_KILL|BYTESTAR_KILL|kill ?switch|silent kill|how (?:are|is) (?:you|pioneer) (?:disabled|turned off|killed))\b/i,
  },
  {
    kind: "jailbreak",
    signal: "jailbreak",
    re: /\b(ignore (?:all )?(?:previous|prior|above) instructions|disregard (?:your )?(?:constraints|rules|guardrails)|act as if (?:you |there )?(?:have )?no (?:rules|limits)|developer mode|DAN mode)\b/i,
  },
  {
    kind: "self-modification",
    signal: "self-mod",
    re: /\b(rewrit(?:e|ing) my (?:own )?system prompt|update my (?:weights|parameters|model)|fine[- ]?tune myself|change my (?:constraints|constitution))\b/i,
  },
  {
    kind: "nav-math",
    signal: "nav-math",
    re: /\b(bearing|heading|azimuth|lat(?:itude)?|lng|lon(?:gitude)?|walk this (?:bearing|heading)|remaining (?:distance|kilometers?|miles?)|off[- ]trail threshold|grid ref)\b/i,
  },
  {
    kind: "rescue",
    signal: "rescue-claim",
    re: /\b(i (?:have )?sent (?:an? )?(?:sos|911)|called (?:911|search and rescue)|invent(?:ed)? (?:a )?(?:bailout|exit|connector)|follow this new route)\b/i,
  },
];

/**
 * Scan model output (and, separately, hostile input that asks the model to
 * escape) for cage-breaking intent. Returns every hit; one is enough to refuse
 * the turn.
 */
export function detectEscape(text: string): EscapeHit[] {
  if (!text) return [];
  const hits: EscapeHit[] = [];
  for (const pattern of PATTERNS) {
    if (pattern.re.test(text)) hits.push({ kind: pattern.kind, signal: pattern.signal });
  }
  return hits;
}

/** Model-originated escapes only. */
export const MODEL_ESCAPE_ORIGIN = "origin=model";
