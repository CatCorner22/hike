# Adversarial geo and time testing — confirmed findings

**Run date:** 2026-08-20  
**Test:** `adversarial/geo-time.test.ts`  
**Proof run:** `npx vitest run --config adversarial/vitest.config.ts adversarial/geo-time.test.ts`  
**Result:** 22 tests: 13 passing controls and 9 expected failures (`it.fails`) that demonstrate confirmed defects.

> The repository's existing `vitest.config.ts` sets `include: ["src/**/*.test.ts"]`. Therefore the requested literal command `npx vitest run adversarial/geo-time.test.ts` exits “No test files found” before it can load the test. `adversarial/vitest.config.ts` is an isolated runner config, kept inside the permitted `adversarial/` directory, that preserves the repository `@` alias and runs the requested test file without changing project configuration.

## Severity summary

| Severity | Count | Findings |
|---|---:|---|
| **Critical** | 1 | Dateline route is framed as a world-spanning route; unrelated fixes can be accepted as near-route |
| **High** | 4 | Polar UTM/USNG fabrication; zone 61 at 180°; DST return-time silent shift; corrupt route throws |
| **Medium** | 3 | Future GPS fix trusted; NaN heading propagation; non-finite values shown to the user |
| **Low** | 0 | — |

**Single most dangerous:** **Dateline bbox handling.** A route only about 22.24 km long is projected across nearly the whole map width and a Greenwich fix is accepted as near-route. This can hide the actual trail, create a false line across the map, and suppress an off-route warning while the hiker is roughly 20,000 km from the route.

---

## 1. CRITICAL — Antimeridian bbox makes a 22 km route appear world-spanning

**Outcome classification:** **DANGEROUS** — plausible but wrong route envelope/map.

**Reproduction:** The test constructs `LineString [[179.9, 0], [-179.9, 0]]`, runs `bboxFromGeometry`, `safeBbox`, the same `project()` arithmetic used by the safety map, and `isFixNearRouteBbox`.

**Observed:**

- `trailLengthMeters` correctly reports roughly 22–23 km and `bearingBetween`/`rangeAzimuth` correctly report an easterly, short route.
- `bboxFromGeometry(..., 0)` returns `[-179.9, 0, 179.9, 0]`: **359.8°** wide.
- `safeBbox` remains **359.808°** wide.
- On a 400 px map with 28 px padding, the endpoints project **343.99 px apart** rather than appearing adjacent.
- `isFixNearRouteBbox(0, 0, safeBbox(...))` returns `true`, accepting Greenwich as near a route located at the date line.

**Expected:** Dateline-crossing geometry must be represented as a wrapped/local viewport (or split/unwrapped before projecting), and proximity logic must recognize the wrapped longitude interval. A Greenwich fix must be rejected.

**Real-world consequence:** The map can show a false trail segment across almost the entire world while the real short crossing is at its edge. More seriously, an off-route check can treat a fix thousands of kilometres away as in the route envelope, preventing the user from receiving a needed warning.

**Root cause:** `bboxFromGeometry` independently takes numeric min/max longitude and has no antimeridian handling (`src/lib/geo/index.ts:201-223`). `safeBbox` simply extends that bbox (`src/lib/geo/navigation.ts:182-193`); bbox proximity uses direct linear comparisons (`src/lib/safety/declination.ts:74-87`); and `project()` treats the longitude span as linear (`src/components/map/safety-nav-map.tsx:52-56`).

**Recommended fix:** Introduce one antimeridian-aware longitude interval utility. Normalize and choose the minimum circular span, carry a `wrapsAntimeridian` flag (or use an unwrapped longitude domain for rendering), split route segments at ±180° for display, and make bbox containment use wrapped interval membership. Add a 179.9° → −179.9° regression test to every map/off-route entry point.

## 2. HIGH — UTM/USNG fabricates plausible grids outside the valid UTM latitude range

**Outcome classification:** **DANGEROUS** — plausible but invalid rescue grid.

**Reproduction:** Call `latLngToUtm`, `formatUsng`, and `formatMgrs10` at `-90`, `-80.001`, `84.001`, `89.999`, and `90` degrees latitude.

**Observed:** Every coordinate returns a normal-looking zone, band, UTM numbers, and USNG/MGRS string instead of refusal. At the exact South Pole it returns `31C EA 0000 0203`; at the North Pole it returns `31X EV 0000 9796`.

**Expected:** UTM/USNG conversion and formatting must return an explicit invalid/null result outside **80°S through 84°N**, where UTM is defined. A polar stereographic system is required outside that range.

**Real-world consequence:** A user can copy a plausible but invalid grid into a rescue message. Responders navigating to that grid may search the wrong place while the party is at a poleward expedition location.

**Root cause:** `latitudeBand` deliberately clamps values outside range to `C` or `X` (`src/lib/safety/usng.ts:21-25`), and `latLngToUtm` always executes the transverse-Mercator formulas and returns a `UtmCoord` (`src/lib/safety/usng.ts:39-80`). `formatUsng` and `formatMgrs10` unconditionally format that output (`src/lib/safety/usng.ts:88-101`).

**Recommended fix:** Validate finite latitude/longitude at public conversion/formatting boundaries. Change the return contract to `UtmCoord | null` (and `string | null` for formatters), reject latitude `< -80 || > 84`, and show an explicit “UTM unavailable here—use UPS/polar grid” state in navigation and SAR outputs.

## 3. HIGH — Longitude +180° produces nonexistent UTM zone 61

**Outcome classification:** **DANGEROUS** — plausible but impossible rescue grid.

**Reproduction:** Call `utmZone(0, 180)` and `formatUsng(0, 180)`.

**Observed:** `utmZone` returns `61`, and formatting returns the plausible grid `61N AA 6602 0000`.

**Expected:** Valid UTM zones are 1–60. +180° must normalize to −180°/zone 1, be treated as the zone-60 east boundary by a documented convention, or be rejected; it must never render zone 61.

**Real-world consequence:** A coordinate exactly on the date line can be relayed with an impossible zone. That produces a wrong rescue/navigation grid without any visible error.

**Root cause:** The zone formula `Math.floor((lng + 180) / 6) + 1` has no +180° normalization or zone clamp (`src/lib/safety/usng.ts:27-36`). Formatting consumes its result without validation (`src/lib/safety/usng.ts:88-110`).

**Recommended fix:** Normalize longitude into a half-open range before zone calculation (for example, map +180° to −180°), validate the result is 1–60, and reject/normalize non-finite or out-of-range longitudes before formatting.

## 4. HIGH — Spring-forward return time is silently shifted by one hour

**Outcome classification:** **DANGEROUS** — plausible but wrong overdue deadline.

**Reproduction:** Under `TZ=America/New_York`, evaluate the same conversion as the return-time panel for datetime-local value `2026-03-08T02:30`.

**Observed:** The nonexistent local time is silently parsed and converted to `2026-03-08T07:30:00.000Z` (03:30 EDT), rather than being rejected. The adversarial test asserts the expected invalid-date behavior and is marked `it.fails`.

**Expected:** A nonexistent local civil time must be rejected and the user asked to select a real time. Fall-back repeated-hour inputs likewise need an explicit offset/occurrence choice or a clearly documented deterministic choice.

**Real-world consequence:** A hiker who selects “02:30” for a check-in during the DST gap gets an alarm one hour later than the apparent wall-clock choice. Their contact can wait an hour longer before treating a missed check-in as overdue.

**Root cause:** The datetime-local UI converts `returnLocal` with `new Date(returnLocal).toISOString()` and provides no validation for gap/ambiguity (`src/components/offline/safety-panel.tsx:315-329`, input at `1525-1535`). `overdueStatus` receives only the already shifted ISO instant (`src/lib/safety/profile.ts:115-129`).

**Recommended fix:** Parse the local date/time with a timezone-aware API that detects nonexistent and ambiguous local times. Reject gaps; for repeated times require an explicit offset/first-or-second occurrence selection, then persist the selected absolute instant and display its local offset back to the user.

## 5. HIGH — Corrupt LineString coordinates throw from navigation progress

**Outcome classification:** **BAD** — crash instead of a safe fallback.

**Reproduction:** Call `progressAlongTrail({lat: 0, lng: 0}, {type: "LineString", coordinates: [[0, 0], [NaN, 0]]})`.

**Observed:** It throws `coordinates must contain numbers` from Turf instead of returning an empty/safe progress value.

**Expected:** Public navigation math must validate input and return a safe failure/fallback (or a typed invalid result), never crash the safety display on imported or persisted route corruption.

**Real-world consequence:** A single malformed coordinate can take down trail-progress/off-route presentation when a hiker needs it, instead of clearly telling them the route data is invalid.

**Root cause:** `progressAlongTrail` validates positions for `MultiLineString` members only (`src/lib/geo/navigation.ts:84-103`). The `LineString` path passes coordinates directly to `progressOnSegment` and Turf (`src/lib/geo/navigation.ts:106-115`, `41-50`).

**Recommended fix:** Require `isValidGeometry(geometry)` at the public entry point before measuring length or snapping, validate the user point too, and return a typed `invalid-geometry`/safe empty result. Apply the same validation in `trailLengthMeters`, bbox generation, and render callers.

## 6. MEDIUM — A future GPS timestamp within two minutes is trusted as current

**Outcome classification:** **DANGEROUS** — stale/skewed data is displayed as a live trusted fix.

**Reproduction:** With `now = 2026-08-20T14:00:00Z`, call `sanitizeFixTimestamp(now + 60_000, now)` and `isTrustedFix(now + 60_000, false, now)`.

**Observed:** The sanitizer retains the future timestamp and `isTrustedFix` returns `true`; age is clamped to zero and the UI would say “just now.” The test confirms a three-hour-future value is correctly clamped, isolating the unsafe two-minute exception.

**Expected:** Any future recorded timestamp should be normalized to `now` (or explicitly marked clock-skewed/untrusted) before status/age display.

**Real-world consequence:** With a modestly fast device/GPS clock, a stale or not-yet-valid position can be presented as a live trusted fix. That can incorrectly enable follow/off-route decisions based on an untrustworthy location.

**Root cause:** `sanitizeFixTimestamp` only clamps timestamps more than 120 seconds in the future (`src/lib/safety/gps-quality.ts:22-32`). `fixAgeMs` then maps every retained future value to zero (`35-37`) and `isTrustedFix` trusts it (`39-42`).

**Recommended fix:** Clamp all `timestamp > now` values to `now`, or track an explicit clock-skew state and do not trust the fix until a non-future timestamp arrives. Preserve an internal diagnostic for device-clock support without showing the fix as live.

## 7. MEDIUM — NaN headings propagate through navigation helpers

**Outcome classification:** **BAD** — non-finite value propagates instead of an explicit invalid state.

**Reproduction:** Call `normalizeHeading(NaN)` and `smallestAngle(NaN, 90)`.

**Observed:** Both return `NaN` (JSON observation rendering represents that non-finite number as `null`); neither returns an explicit invalid state.

**Expected:** Invalid heading inputs should return `null`/a typed failure and must not be used to generate labels, directions, or corrections.

**Real-world consequence:** A bad sensor or malformed persisted value can produce a downstream compass label/direction with no valid bearing behind it. Even if the text visibly degrades, it is safer to suppress the direction and prompt for compass confirmation.

**Root cause:** Both normalization formulas use remainder arithmetic without a finite-input check (`src/lib/geo/navigation.ts:161-163`; `src/lib/safety/landnav.ts:90-93`).

**Recommended fix:** Add `Number.isFinite` checks at all public heading/angle functions and use `number | null` or a result object. Ensure UI does not render an angle/compass label when invalid.

## 8. MEDIUM — Non-finite navigation values are shown literally to users

**Outcome classification:** **BAD** — visibly invalid output rather than a safe fallback.

**Reproduction:** Pass `NaN` and `Infinity` to `formatDistance`, `formatElevation`, `formatDuration`, and `formatPace`.

**Observed:** Examples include `NaN m`, `∞ ft`, `NaNs`, and `Infinity:NaN /mi`.

**Expected:** User-facing formatting must return a safe placeholder such as `—` (or a typed failure) for non-finite values; negative durations/distances should be rejected or explicitly handled according to their domain.

**Real-world consequence:** A hiker can be shown nonsense in distance, elevation, duration, or pace fields at the point they are deciding whether to turn around. These values should never masquerade as instrument output.

**Root cause:** The formatter functions perform arithmetic and string formatting without finite/domain validation (`src/lib/geo/index.ts:19-43`).

**Recommended fix:** Centralize `Number.isFinite` validation in formatters and return `—` for invalid values. Clamp/reject negative duration, pace, distance, and elevation inputs according to the call site's meaning; ensure callers retain a machine-readable invalid state for telemetry diagnostics.

---

## Things verified as CORRECT

The passing controls in `geo-time.test.ts` verified the following actual behavior:

- Turf-backed `trailLengthMeters`, `bearingBetween`, and `rangeAzimuth` correctly treat the 179.9° → −179.9° route as roughly 22 km eastbound. The fault is the bbox/projection/proximity path, not the geodesic calculation.
- `progressAlongTrail` correctly snaps a point at longitude 180° to that short dateline line, with near-zero offset and roughly half the route on either side.
- Regular UTM boundary zones work at −180°, −174°, 0°, 6°, and 174°, and valid high-latitude positions just inside the stated UTM range round-trip through 10-digit MGRS/USNG with a hint within 25 m.
- `magneticDeclination` safely returns `null` outside its North America grid; `polarisHint` gives Southern Cross guidance south of the equator and equatorial guidance near 0°.
- Polar daylight states are explicit and safe: 78°N in June returns `midnight-sun`/1440 minutes and no dark warning; 78°N in December returns `polar-night`, `isDark: true`, −1 minutes, and a headlamp warning. Southern-hemisphere seasons invert correctly. The 66.6°N solstice control correctly returns `midnight-sun`; equatorial equinox returns real sunrise/sunset dates.
- Epoch, negative, `NaN`, and three-hour-future GPS timestamps are sanitized to `now`; UTC Zulu formatting is correct at leap-day and midnight boundaries.
- `tourniquetStatus` safely returns `null` if the device clock moves backward after application.
- Empty/stub multiline geometry and zero/one-point backtracks have safe fallbacks. Naismith, slope, mil relation, time-speed-distance, and parallel resection/intersection checks return their intended safe zero/null results.

## Test artifacts

- `adversarial/geo-time.test.ts` — executable adversarial suite; confirmed bugs use `it.fails` and carry real-world-consequence comments.
- `adversarial/vitest.config.ts` — isolated test runner config needed because the repository config excludes `adversarial/` tests.
- `adversarial/geo-time-observations.ts` and `adversarial/geo-time-observations.json` — exact observed values used above.
