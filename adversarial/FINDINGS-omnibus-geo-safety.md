# Omnibus pass: route geometry, halfway figures, pace honesty

Probes: `probe-geo-omnibus.test.ts`, `probe-omni-safety.test.ts`, plus the existing
`test:offline`, `test:offline-probe`, `test:gps-probe`, `test:api-probe`,
`test:concurrency`, `test:csp` and `bench` batteries.

## Confirmed and fixed

1. **Remaining distance was credited to the wrong section at a gap.** The active
   component was recovered from traveled metres after snapping, which cannot tell
   the last vertex of one component from the first vertex of the next — they are
   metres apart in the distance index and a whole component apart in remaining
   distance. A hiker starting the second section of a two-part route was told the
   first section's remaining distance. `progressAlongTrail` now carries the
   component the snap came from.

2. **Halfway text and the map diamond disagreed across a disconnected route.**
   The text measured along the stored line; the marker sits on real geometry. The
   unmapped ground between components is not walkable, so the two figures cannot
   be reconciled — `halfwayStatus` now reports `gapMeters` and the HUD says
   "across a gap" instead of implying a walk.

3. **Route spine and route progress were measured in two different frames.** The
   spine used Turf lengths while progress uses the pack's stored distance index;
   on a long route the drift was enough to mis-attribute a position near a
   component boundary. `routeSpine` now accepts the stored index and uses it.

4. **A route pack could declare a length its own distance index contradicted.**
   Whole-route remaining reads `lengthMeters`, position reads
   `cumulativeDistancesMeters`; disagreement silently corrupts both remaining and
   halfway. Validation now rejects a mismatch beyond 0.5% (1 m floor).

5. **A non-finite remaining distance produced "Naismith ~0 min" and silenced the
   daylight warning.** `naismithMinutes`/`paceMinutes` returned 0 for NaN, which
   reads as "no time needed" — the most reassuring possible answer on the least
   trustworthy data. They now return NaN so the UI prints "Naismith unavailable",
   and `turnaroundWarning` bails on non-finite inputs rather than formatting them.

## Checked, no defect found

- `offTrailLevel(NaN)` returns `"unknown"`, not `"none"` — correct.
- `isTrustedFix` rejects broken and future timestamps and any stale-flagged fix.
- `deadReckon`/`deadReckonUncertaintyM`, USNG formatting, declination and bearing
  formatting all stay finite or refuse to answer on hostile numbers.
- Progress cache agrees with direct Turf snapping on single-line, disconnected
  and 100k-coordinate routes.
- `safeBbox` on a 100k-position route: no stack overflow, finite bounds.
- Route-pack validation still rejects malformed geometry, oversized GPX, bad
  elevation profiles and poisoned optional extras while keeping the pack
  navigable where the invalid data is optional.
