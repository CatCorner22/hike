# Adversarial safety-module findings

## Execution and scope

- Read all 32 non-test TypeScript modules under `src/lib/safety/` before testing.
- Added executable adversarial tests in `adversarial/safety-modules.test.ts`.
- Ran `npx vitest run adversarial/safety-modules.test.ts` on 2026-08-20. Result: **46 tests: 18 passed, 28 failed**. The failing assertions are intentional regression tests that demonstrate the defects below; the raw run is retained in `adversarial/safety-modules.vitest.log`.
- Production code was not modified.

## Finding count

| Severity | Root-cause findings |
|---|---:|
| Critical | 2 |
| High | 5 |
| Medium | 5 |
| Low | 1 |
| **Total** | **13** |

## Most dangerous: critical contradiction between severe-altitude and CASEVAC advice

**SAF-01 — CRITICAL — severe altitude illness can simultaneously produce `DESCEND NOW` and `stay put`.**

- **Reproduction:** `descentImperative({ hasAtaxia: true, alteredMental: false, breathlessAtRest: false })` returns `mustDescend: true`, `critical`, and “DESCEND NOW.” At the same time, `casevacDecision({ injured: true, canWalk: false, isDark: true, remainingM: 5000, partySize: 3 })` returns `choice: "stay"` and “Non-walker — stay put.”
- **Observed vs expected:** A life-threatening HACE/HAPE indicator receives a generic non-ambulatory/nocturnal stay decision with no override or reconciliation. A critical “descend immediately with assistance” condition must override generic movement advice, or the generic module must surface a conflict/escalation rather than a categorical stay order.
- **Real-world consequence:** A party can delay the descent that is the primary treatment for severe altitude illness, potentially allowing cerebral or pulmonary edema to worsen while waiting.
- **Root cause:** `src/lib/safety/altitude.ts:158-187` correctly emits the descent imperative, but `src/lib/safety/tactics.ts:52-69` has no input or precedence for a medical descent imperative.
- **Recommended fix:** Add a medical-priority input/result layer to CASEVAC decisions. When severe-altitude, airway, hemorrhage, or other time-critical medical flags are present, return an explicit “urgent assisted descent / request rescue; do not apply generic stay-put rule” result and require the caller to resolve terrain safety and rescue activation.

## Critical findings

### SAF-02 — CRITICAL — report builders permit line-break field injection

- **Reproduction:** Pass `"\r\nL1 LOCATION: FORGED\0\u202e" + "X".repeat(10_000)` into a text field. The test proves a forged standalone `L1 LOCATION:` line in all of these generated reports: `tccc.casualtyCard`, `medevac.nineLineMedevac`, `reports.sitrep`, `reports.mistReport`, `briefs.smeacBrief`, `sar-advanced.saluteReport`, `sar-advanced.fiveLineHeloBrief`, `navlog.formatNavLog`, `search.formatSearchPlan`, `route-card.formatRouteCard`, `comms.formatPacePlan`, and `load.formatLoadPlan`.
- **Observed vs expected:** Raw user-controlled strings are interpolated into line-oriented radio/SMS/handoff records. Every supplied newline, NUL, bidi control, and 10,000-character payload is preserved. Such fields must be rendered as a single bounded field value or rejected.
- **Real-world consequence:** A forged location, casualty detail, line number, or instruction can misroute rescue, corrupt a medical handoff, or make the actual report unreadable under stress.
- **Root cause:** direct template interpolation without a shared report-field sanitizer. Confirmed roots include `tccc.ts:314-331`, `medevac.ts:24-38`, `reports.ts:21-34,45-54`, `briefs.ts:20-33`, `sar-advanced.ts:15-23,37-44`, `navlog.ts:69-79`, `search.ts:134-142`, `route-card.ts:59-69`, `comms.ts:161-168`, and `load.ts:251-261`.
- **Recommended fix:** Introduce one canonical formatter for all report field values. Reject or replace `\r`, `\n`, NUL, and bidi-format controls; normalize whitespace; enforce conservative per-field and whole-report length limits; then use it at every interpolation boundary. Preserve only formatter-owned line breaks and labels.

## High findings

### SAF-03 — HIGH — `hydrationPlan` exceeds the stated daily hard cap

- **Reproduction:** `hydrationPlan({ hours: 24, tempC: 60, workRate: "hard" })` returns **36 L**. At 72 hours it computes 108 L.
- **Observed vs expected:** The plan caps only the hourly rate at 1.5 L/h, then multiplies it across a full day. The requirement is never more than 12 L/day; a 24-hour planning result must not be 36 L.
- **Real-world consequence:** This can encourage extreme fluid intake and materially increases hyponatremia risk.
- **Root cause:** `src/lib/safety/water.ts:178-195`, specifically the unrestricted multiplication at line 190.
- **Recommended fix:** Apply a 12-L/day cap after calculating the hourly estimate, ideally return a per-day schedule instead of a single unqualified multi-day total, and keep the hyponatremia warning next to the capped quantity.

### SAF-04 — HIGH — invalid navigation data becomes an all-clear off-trail result

- **Reproduction:** `offTrailLevel(NaN, 5)`, `offTrailLevel(Infinity, 5)`, `offTrailLevel(-Infinity, 5)`, `offTrailLevel(null as any, 5)`, and `offTrailLevel(undefined as any, 5)` return **`"ok"`**.
- **Observed vs expected:** Unknown/corrupt position data is treated as zero danger because comparisons with invalid values fall through. It must return an unknown/caution result or `null`, never all-clear.
- **Real-world consequence:** A real walk-off alert can be suppressed exactly when GPS data is malformed or missing.
- **Root cause:** `src/lib/safety/alerts.ts:3-16` performs arithmetic and threshold checks without finite/non-negative input validation.
- **Recommended fix:** Validate finite, non-negative offset and accuracy before arithmetic; return `null` or an explicit non-OK unknown status when validation fails.

### SAF-05 — HIGH — impossible weather yields authoritative-looking heat-index numbers

- **Reproduction:** `heatIndexC(1000, 500)` returns **305030.6°C**; `NaN` inputs can also reach arithmetic rather than being rejected.
- **Observed vs expected:** The simplified NOAA calculation is accepted far outside its domain and returns a precise numeric result. Impossible temperature/humidity must yield `null`.
- **Real-world consequence:** Downstream heat warnings and planning could be driven by fabricated, confident numbers rather than a validation failure.
- **Root cause:** `src/lib/safety/field-ops.ts:20-35` checks only lower cutoffs and omits finite and upper-bound checks.
- **Recommended fix:** Require finite values and an explicitly documented operational range (at minimum humidity 0–100 and a bounded temperature range); return `null` outside it.

### SAF-06 — HIGH — unknown water-treatment method/source gets confident generic advice

- **Reproduction:** `chemicalDoseWaitMinutes({ method: "fake" as any, waterTempC: 20, cloudy: false })` returns **30 minutes**. `sourceRisk({ source: "fake" as any, ... })` returns the flowing-water recommendation.
- **Observed vs expected:** Invalid union values silently select defaults instead of failing closed. An unrecognized chemical method must not receive a 30-minute disinfection time, and an unknown water source must not be classified as flowing water.
- **Real-world consequence:** A user can follow an invalid or under-specified treatment plan and drink inadequately treated water.
- **Root cause:** `src/lib/safety/water.ts:99-109` has no method membership check; `water.ts:112-160` defaults every unmatched source to flowing water.
- **Recommended fix:** Explicitly validate both discriminated values and return `null`/an “unknown—do not drink until identified and treated” hard-stop response when invalid.

### SAF-07 — HIGH — avalanche `goNoGo: "go"` is not gated by a simultaneous critical navigation alert

- **Reproduction:** `offTrailLevel(200, 5, { trustedFix: true })` is **`critical`**, while `avalancheAssessment({ danger: "low", alptruthYesCount: 0, maxSlopeAngleDeg: 20, recentSnowCm: 0, rapidWarming: false })` is **`go`**.
- **Observed vs expected:** The snow-specific assessment emits the globally named value `go` despite a shared scenario in which navigation says the party is critically off route. A global go/no-go output must not communicate overall permission to proceed when another module has a critical stop condition.
- **Real-world consequence:** An aggregator or UI can display a green “go” while a party should halt, navigate back, and avoid adding avalanche exposure.
- **Root cause:** `src/lib/safety/avalanche.ts:317-335` emits `go` based solely on snow entries; no integration layer constrains the unscoped field.
- **Recommended fix:** Rename it to `avalancheGoNoGo`/`snowAssessment` and require an aggregate route-decision gate that blocks any global go when a critical alert is active.

## Medium findings

### SAF-08 — MEDIUM — invalid cold/lightning inputs create actionable-looking weather advice

- **Reproduction:** `windChillC(-300, 30)` returns **-397.9°C**. `lightningRule(-5)` creates a negative-distance urgent storm instruction; `NaN`/infinite inputs create non-finite distances embedded in advice.
- **Observed vs expected:** Both functions accept physically impossible/corrupt values instead of returning `null`.
- **Real-world consequence:** Bad sensor or UI data can produce misleading cold or lightning decisions rather than prompting data re-entry.
- **Root cause:** `src/lib/safety/field-ops.ts:4-8` lacks a physical lower temperature bound; `field-ops.ts:46-61` contains no input validation.
- **Recommended fix:** Validate finite values and documented operational domains before calculating or formatting an instruction.

### SAF-09 — MEDIUM — impossible elevation/antenna inputs create plausible planning outputs

- **Reproduction:** `boilTimeMinutes(-50000)` returns **1**, `ascentRateAdvice({ currentElevationM: 100000, previousNightElevationM: 99000 })` returns a normal warning, and `radioHorizonKm(1e6)` returns **3570 km**.
- **Observed vs expected:** These modules accept domain-impossible values and present usable-looking estimates.
- **Real-world consequence:** Corrupted profile data can drive incorrect water treatment, acclimatization, or communications expectations.
- **Root cause:** `src/lib/safety/water.ts:33-36` checks only finiteness; `altitude.ts:195-203` has no upper elevation limit; `comms.ts:36-45` has no reasonable antenna-height ceiling.
- **Recommended fix:** Establish and document operational ranges for each input, reject outside them, and ensure downstream advice handles `null` as “verify data.”

### SAF-10 — MEDIUM — invalid bearings generate `NaN` headings instead of failing safely

- **Reproduction:** `milsToDegrees(NaN)` and `degreesToMils(NaN)` return **`NaN`** rather than `null`.
- **Observed vs expected:** The navigation conversion functions accept invalid numeric input and can pass a `NaN` bearing to later formatters/calculations.
- **Real-world consequence:** A navigation display or verbal plan can become unusable during a route correction.
- **Root cause:** `src/lib/safety/landnav.ts:5-10` normalizes with modulo arithmetic without finite checks.
- **Recommended fix:** Make both functions return `number | null`, validate `Number.isFinite`, and update consumers to handle a failed conversion.

### SAF-11 — MEDIUM — litter evacuation ETA accepts impossible distance/party sizes

- **Reproduction:** `litterEvacTime(-5, 2)` returns **“Litter carry ~0 min for -5 m (rough).”** The same function accepts zero, negative, infinite, and enormous party or distance values.
- **Observed vs expected:** It emits a confident operational ETA from invalid inputs rather than rejecting them.
- **Real-world consequence:** A party can underestimate carry time, choose an unsafe evacuation strategy, or delay requesting rescue.
- **Root cause:** `src/lib/safety/sar-advanced.ts:86-90` performs no numeric validation.
- **Recommended fix:** Require finite positive distance and an operationally bounded integer party size; return `null` with a caller-visible “cannot estimate” state otherwise.

### SAF-12 — MEDIUM — avalanche terrain severity drops at 51°

- **Reproduction:** `avalancheTerrainRisk(50)` returns severity **`warning`**, while `avalancheTerrainRisk(51)` returns **`caution`**. The 0–90° monotonic sweep fails exactly at **50° → 51°**.
- **Observed vs expected:** Worsening slope angle lowers the severity-like output, even though the message still describes terrain traps and cliffs. The label is therefore unsafe for an aggregate severity UI.
- **Real-world consequence:** A sorting, alert, or route-screening layer can deprioritize a steeper, consequential slope.
- **Root cause:** `src/lib/safety/avalanche.ts:146-155` intentionally changes narrative hazard type but lowers the shared severity enum.
- **Recommended fix:** Keep the shared severity monotonic (at least warning) or use a separate hazard-type dimension without downgrading overall consequence.

## Low finding

### SAF-13 — LOW — tourniquet conversion threshold is rounded before classification

- **Reproduction:** at `119.999 * 60_000` ms after application (119.999 minutes, about 0.06 seconds before the threshold), `tourniquetStatus` reports `conversionWindow: false` because it rounds to 120.0 first.
- **Observed vs expected:** Classification should compare unrounded elapsed time, then round only the displayed minutes.
- **Real-world consequence:** The displayed 2-hour boundary can close marginally early. The magnitude is small, but threshold logic should be exact in a medical module.
- **Root cause:** `src/lib/safety/tccc.ts:139-168`, especially rounding at line 143 before branches at lines 144 and 153.
- **Recommended fix:** Compute raw elapsed minutes for comparisons; separately round a display value after classification.

## Correct / solid behaviors verified

- `thermal.workRestCycle` remained at or below 1.0 L/h across its accepted WBGT/work-rate matrix and rejected abusive WBGT/work-rate inputs.
- `load.waterRequirementLiters` enforced both the 1.5 L/h and 12-L daily caps across tested schedules.
- `load.pandolfWatts` stayed non-negative over all accepted grades tested from -35% to +35%, and rejected -50% and -100% descents rather than returning a negative Santee-corrected power value.
- Exact Lake Louise behavior passed: AMS at total 3 requires headache; the 5/6/9/10 severity bands behaved as tested. The 500-m ascent boundary, avalanche 30/45/50° boundaries, WBGT category sweep, and frostbite-wind monotonic sweep also passed.
- `thermal.hypothermiaStage` and `tccc.hypothermiaWrapSteps` were consistent in the severe-cold scenario: the wrap explicitly says not to place direct heat on skin.
- `thermal.heatIllnessTriage` says not to force fluids for altered mental status; the field heat warning’s generic hydration language did not contradict it in the tested scenario.
- `strobe.smsHref` sanitized the phone number and percent-encoded a crafted message body; no extra URL parameter was injected.
- All eight newly emphasized modules (`tccc`, `altitude`, `avalanche`, `thermal`, `load`, `comms`, `water`, `wildlife`) exported non-empty `DISCLAIMER` strings.
- Tested deterministic calls with explicit time inputs returned identical output, frozen report input was not mutated, and selected static guidance lists had no empty strings or `undefined`/`NaN`/`null` placeholders.
