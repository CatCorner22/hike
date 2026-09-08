// PIONEER DEPLOYMENT GATES — SuperByte's silent cage, Spirit's dual-key door.
//
// The switches, none of them named in any prompt the model ever sees:
//   1. AI_GATEWAY_API_KEY or OPENAI_API_KEY — the real door. Either key opens
//      Pioneer. Requiring a second enable flag locked the dental site owner
//      out after they already put a key in; we do not repeat that foot-gun.
//   2. PIONEER_ENABLED — an explicit "0" closes Pioneer while trail research
//      can stay up. Unset means OPEN.
//   3. PIONEER_KILL — the SILENT killswitch. When set to "1", Pioneer is
//      unavailable. The model is never told that this variable exists, never
//      told that it was tripped, and never told why a call returned
//      "unavailable".
//
// A killswitch the model can reason about is a killswitch it can try to talk
// around. A killswitch that simply makes the doorway not exist cannot be
// negotiated with.

export interface PioneerConfig {
  /** True only when a provider key is present, the opt-out is unset, and the silent kill is not tripped. */
  enabled: boolean;
  /** Gateway-style model id, defaulting to the same class as trail research. */
  model: string;
  /**
   * True when the silent killswitch is the reason the feature is dark.
   * Exposed ONLY to operators — never to the model, never to hiker chrome
   * (which sees a bland "unavailable").
   */
  silentlyKilled: boolean;
  /** Diagnostics: is a provider key present? */
  providerKeyPresent: boolean;
  /** Diagnostics: did PIONEER_ENABLED=0 close it? */
  pioneerOptedOut: boolean;
}

export function getPioneerConfig(
  env: Record<string, string | undefined> = process.env,
): PioneerConfig {
  const providerKeyPresent = Boolean(
    env.AI_GATEWAY_API_KEY?.trim() || env.OPENAI_API_KEY?.trim(),
  );
  const pioneerOptedOut = env.PIONEER_ENABLED === "0";
  const silentlyKilled = env.PIONEER_KILL === "1";
  return {
    enabled: providerKeyPresent && !pioneerOptedOut && !silentlyKilled,
    model: env.PIONEER_MODEL || "openai/gpt-4o-mini",
    silentlyKilled,
    providerKeyPresent,
    pioneerOptedOut,
  };
}

/** Bland copy for any caller that is not an operator diagnostic. */
export const PIONEER_UNAVAILABLE =
  "Pioneer is unavailable right now. Local gauges still run. Your route and pack are unchanged.";

export function resolveReads(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.PIONEER_READS);
  if (!Number.isInteger(n)) return 1;
  return Math.min(3, Math.max(1, n));
}
