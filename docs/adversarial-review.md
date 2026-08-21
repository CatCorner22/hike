# Adversarial review — Klandagi

Scope: whole repository at `0809db7` (current `main`). Focus weighted toward the
life-safety surface (`src/lib/safety/**`, `src/lib/geo/navigation.ts`,
`src/app/navigate/[planId]`, `src/hooks/use-gps.ts`), then the API/data layer, then
hygiene.

Baseline (after `npm install` — note `npm ci` does **not** work on this commit, F23):
`npx tsc --noEmit` clean, `npx vitest run` 239/239 green, `npx eslint` 2 errors / 0
warnings. **Every defect below survives that green run.** The suites assert the happy
path and, in three cases, assert the buggy behaviour from the wrong direction (see F2,
F4, F7).

Each finding marked **verified** was reproduced by executing the exported functions
against real inputs on this commit; the transcript is quoted inline.

Every module carrying a Severity 1 or 2 finding — `usng.ts`, `daylight.ts`,
`declination.ts`, `gps-quality.ts`, `field-ops.ts`, `alerts.ts`, `landnav.ts`,
`geo/navigation.ts` — is byte-identical to `a002c42`. The recent hardening work landed in
the API layer, `geo/index.ts`, `route-pack.ts` and the store; it did not reach the
navigation math.

---

## Status

Findings **F1–F10 and F12–F23 are fixed**, each with a regression test that fails against
the code described below. The prose is kept as the record of what was wrong and why.

**F11 (unauthenticated API) is now fixed too**, as multi-user with an owner column.
`hike_plans` and `activities` carry `owner_id`, and all eleven user-data handlers plus
the home page — a Server Component that read the database directly and so bypassed the
API entirely — constrain every query to the caller. A row belonging to someone else
answers `404`, never `403`, because a `403` confirms the id exists.

The column only means something if the server can trust who is asking, so it ships with
the identity to match: an HttpOnly, HMAC-signed `hike_owner` cookie, minted by
`src/proxy.ts` and re-verified inside each handler. It is deliberately not a login —
identity is one browser on one device — and that limitation is written down in the
README next to the feature. Swapping in a real identity provider means changing
`resolveOwnerId` and nothing else.

Two operational notes carried into the README and `drizzle/0002_owner_scoping.sql`:
`SESSION_SECRET` is required in production (a missing one returns `503` rather than
degrading to a single shared identity), and rotating it orphans every existing row.

Two pre-existing failures on `main` that were not in the original review were also fixed,
since they were red before any of this work started:

- `parseBbox` accepted a blank coordinate, because `Number("")` is `0`. `?bbox=,0,1,2`
  silently became a valid box off the coast of West Africa and the route answered 500
  instead of 400.
- `GET /api/activities/:id/points` returned `200 {"points": []}` for an activity that does
  not exist. "No points recorded" and "no such activity" are different facts, and the
  first one reads as a track that captured nothing.

Verification after the fixes: `tsc --noEmit` clean, `eslint` clean, `vitest run` 328/328
green (was 239 with 5 failing), `next build` succeeds warning-free, and `npm ci` installs.

---

## Third pass — the offline path, end to end

The ownership work in the second pass added a request-time auth layer to an offline-first
app, and nothing had verified that the offline promise still held afterwards. Running
`e2e/offline-navigation.mjs` against a production build showed it did not:

```
[FAIL] A1 navigate online          — "Plan not found on server."
[FAIL] A2 navigate offline          — "Plan not found on server."
[FAIL] B2 route packs in IndexedDB  — count=0
[FAIL] B3 cold offline navigate     — "This navigation screen was not saved…"
[FAIL] B4 app requested durable storage — persist() calls=0
```

### T1. The proxy minted a session for every request, not just navigations

`src/proxy.ts` minted a signed cookie on any request that lacked one — including API
calls. Three consequences:

1. An anonymous `POST /api/plans` silently received a **brand-new owner and created a
   row**, instead of the `401` the handlers document.
2. The `401` branch was therefore unreachable in production, so the behaviour described
   in the code comments and the README was not the behaviour that shipped.
3. A crawler could mint owners and rows without limit.

Verified before and after against a production build:

```
before:  POST /api/plans (no cookie) -> 200, ownerId=1b7054a7-…
after:   POST /api/plans (no cookie) -> 401
         GET  /plan      (document)  -> 200 + Set-Cookie: hike_owner=…
```

Minting is now restricted to document navigations (`sec-fetch-dest: document`, falling
back to an `Accept: text/html` negotiation for clients without Fetch Metadata). A browser
receives its cookie from the document response, so every subsequent fetch from the page
already carries one. `src/proxy.test.ts` pins all of it, including that a forged cookie is
replaced rather than trusted.

**What this was not:** the first suspicion was a race — several cookie-less requests in a
cold first visit each minting a different owner, with the last `Set-Cookie` winning and
orphaning anything written in between. Measured in a real browser, one cold visit to
`/plan` minted exactly **one** owner, the browser settled on it, and a plan created
immediately afterwards survived a reload. No fix was made for a problem that does not
exist.

### T2. The offline probe could not run, and could not have caught T1

Two defects in the harness itself, which is why the regression above reached a merged
branch:

- `chromium.launch()` was hardcoded, so the probe was unrunnable anywhere Chromium is
  supplied out of band — including this environment. It now honours `CHROMIUM_PATH`.
- `createPlan()` used a cookie-less `fetch`, so after owner scoping the plan belonged to
  a different owner than the browser. A plan owned by someone else is indistinguishable
  from a plan that does not exist — correct behaviour, and it silently invalidated every
  assertion downstream. The probe now establishes the session in the browser and reuses
  that exact cookie.

After both fixes, all five scenarios pass against a production build — including **B3,
the real backcountry case**: route prepared at the trailhead, navigate screen never
opened online, then opened with the network cut.

```
[PASS] A1 navigate online          [PASS] A2 navigate offline after warm visit
[PASS] B1 prepare offline          [PASS] B2 route packs in IndexedDB — count=1
[PASS] B3 cold offline navigate    [PASS] B4 app requested durable storage
[PASS] B5 UI is honest about eviction risk
```

### T3. Unsyncable GPS points retried forever and grew without bound

`flushActivityPoints` treated every non-OK response the same way: `break`, leave the
batch queued with `synced: 0`, try again later. But `deleteSyncedPointsOlderThan` only
prunes `synced: 1`, so nothing ever removed them, while `usePointSync` retries **every
30 s, on every `online` event, and on every queue event, for the life of the app**.

For a status that can never succeed — 404 because the activity was deleted or belongs to
another owner, 400 because the payload is rejected — that is:

- battery and cellular burned in exactly the place this app tells people to conserve both,
- unbounded IndexedDB growth **in the same quota that holds the offline route packs**
  navigation depends on. The readiness UI already warns that packs "may be evicted under
  storage pressure"; this was a mechanism for generating that pressure indefinitely.

Owner scoping made the 404 case newly reachable: clear cookies, and every queued point
belongs to an activity the server will never acknowledge again.

Permanent statuses (400, 404, 410, 413, 422) now delete the batch and report the count;
retryable ones (network failure, 5xx) still keep the points. **401 is deliberately not
permanent** — a session is re-minted on the next document navigation, so those points are
still deliverable. Dropping recorded track is a real loss, so the recorder now says so
instead of swallowing it.

### T4. Five of six IndexedDB stores tested for the wrong thing

`route-pack.ts` guards on `typeof indexedDB === "undefined"`. The offline point queue,
the breadcrumb track, the ICE profile, the nav log and the tourniquet clock all guarded
on `typeof window === "undefined"` and returned null — silently — otherwise.

Not a live defect: every one of those is reached from `"use client"` code where `window`
exists. But `window` is absent in workers while `indexedDB` is present, the two modules
disagreed about how to answer the same question, and the guard made the breadcrumb and
ICE stores — both life-safety, both untested — impossible to test at all. All five now
test the capability they actually need.

---

## Fourth pass — the offline map itself

`SafetyNavMap` is the map you look at when you are lost and there is no cell service. It
had two defects, both measured against the real `project()` on a 390x700 phone canvas.

### M1. Every bearing read off the map was wrong, by up to 15°

`project()` mapped longitude straight to x and latitude straight to y, stretched to fill
the canvas. Two errors compounded: no `cos(latitude)` correction, and a bbox square in
degrees forced into a canvas that is not square.

A **true 45° (north-east) bearing** rendered as:

```
lat 25.0  ->  29.7° on screen   (error -15.3°)
lat 37.7  ->  33.2° on screen   (error -11.8°)
lat 45.0  ->  36.2° on screen   (error  -8.8°)
lat 50.0  ->  38.9° on screen   (error  -6.1°)
lat 61.0  ->  46.9° on screen   (error  +1.9°)
```

The near-miss at 61° is coincidence — the two errors happen to cancel there — not
correctness. At 37.7°N a 100 m × 100 m patch of ground rendered at a **0.65 aspect**,
which also skewed the 100 m UTM grid the SAR readouts beside it assume is square.

The numeric "Walk 214° true" text was always right; it comes from turf. But the map is
what you orient yourself with, and a 12° error over 500 m puts you a hundred metres wide
of where you meant to be.

Replaced with `createProjector` in `src/lib/geo/project.ts`: one scale in pixels-per-metre
for both axes, longitude corrected by `cos(latitude)`, bbox letterboxed into the canvas
rather than stretched. Tests assert that true bearings render at the same angle at six
latitudes including the southern hemisphere, that a square of ground renders square, and
that 100 m UTM squares — built from the real `latLngToUtm`/`utmToLatLng` — render square.

### M2. The route left the screen exactly when it mattered

Follow mode used a fixed ±0.003° window around the user and ignored the route entirely.
That is ±264 m east-west at 37.7°N and only **±162 m at 61°N**, while the off-trail alert
escalates to critical at 80 m. Between roughly 160 m and 260 m off-route, the banner said
`OFF TRAIL — walk 214° back` over a canvas showing the user alone in an empty grid, with
the route and the dashed bearing line both off-canvas.

`followWindow` now takes the points the user is being sent to — the nearest point on the
route, and any go-to target — and expands to keep them on screen with a 25% margin, never
zooming tighter than the old minimum.

---

## Fifth pass — the pre-departure self-check and power

### W1. "Screen wake lock is held" could be false

The self-check shows six rows a hiker uses to decide whether they are ready to leave
coverage. One is the screen wake lock — if the screen sleeps mid-navigation, the
off-trail banner goes with it.

Nothing listened for the sentinel's `release` event. Per the Screen Wake Lock spec the
browser releases the sentinel on its own when the document is hidden, and may drop it for
its own reasons such as battery saver. `lockHeld` was set once on a successful acquire
and **stayed true forever** afterwards, so the check reported a lock that was gone.

`requestWakeLock` now attaches a `release` listener and publishes changes through a
subscription.

### W2. The self-check row never updated anyway

`isWakeLockHeld()` was called inside a `useMemo` whose dependency array did not — and
could not — contain it. The row was computed from a module global at whatever moment one
of the *other* dependencies last changed, and never recomputed when the lock changed.

Replaced with a `useSyncExternalStore` hook, which is the supported way to read a value
that lives outside React and changes on its own.

**A bug in the fix, caught by its own test.** The first version notified subscribers from
inside `acquire()`, before `activeLock` was assigned. Since `isWakeLockHeld()` is
`lockHeld && activeLock != null`, every subscriber read `false` for a lock that had just
been granted — and no further notification was coming, so the UI would have stayed wrong
in a new way. The handle is now published before acquiring.

### W3. The 20% battery tier was unreachable

`batterySafetyAdvice` has tiers at 20%, 10% and 5%. `useBatteryWarning` gated at
`threshold = 0.15`, so "Battery 20% — plan your next comms window before the phone dies"
could never display: between 16% and 20%, the band where there is still time to act on
it, the app said nothing. Threshold raised to 0.20 to match the advice it calls.

`getBattery()` could also resolve after unmount and subscribe listeners that then had
nothing to remove them; guarded.

---

## Sixth pass — land-nav fallbacks and fabricated inputs

### L1. The watch sun-compass pointed 180° wrong for half of every day

`watchMethodHeading` is the no-compass fallback: aim a hand at the sun, and the bisector
between the hour hand and the 12 mark gives you a pole. The bisector has to cross the
**smaller** arc between them. Before noon the hour hand sits more than 180° clockwise of
12, so the smaller arc is on the other side and the bisector is 180° away from
`hourOn12 / 2`.

The code used `hourOn12 / 2` unconditionally in the northern hemisphere and its reflex in
the southern. Checked against where the bisector actually points in true degrees, given
the sun's true azimuth at that solar hour:

```
cases: 18  |  old formula wrong in: 9  |  new formula wrong in: 0
```

Northern **mornings** and southern **afternoons** were exactly backwards — on the method
you reach for precisely when you have no compass. One shared bisector is correct for both
hemispheres; only which hand you aim at the sun, and whether the result reads south or
north, differ.

### L2. The watch method was fed the device clock instead of solar time

The method assumes the watch reads *solar* time. The panel passed
`new Date().getHours()` — zone time including daylight saving. One hour of error is 30° on
the dial, halved into **15° of heading error**, through the season when most people are
out. `solarHour(date, lng)` now derives it from longitude, which removes the DST and
zone-offset error together.

### L3. Travel heading was fabricated as slope aspect

The panel called `avalancheTerrainWarning({ slopePct, aspectDeg: heading })`. Aspect is
the direction a slope *faces* — its downhill direction. `heading` is where the hiker is
pointed. Traverse a slope and your heading is roughly perpendicular to its aspect; climb
it and your heading is its opposite.

That fed the "classic avalanche start zone" branch, so identical terrain warned or stayed
silent depending only on which way the hiker happened to be walking.

The app cannot derive aspect: the elevation profile is along-track only, which gives
gradient but not cross-slope orientation. So the parameter is gone rather than guessed —
the slope-angle warnings remain and now say to check the forecast for aspect and wind
loading, which is what `avalanche.ts` collects deliberately from a person.

### L4. Two disagreeing `gridConvergence` implementations

`tactics.ts` and `declination.ts` both exported a `gridConvergence`. `tactics.ts` derived
the UTM zone with a bare `Math.floor((lng + 180) / 6) + 1`, missing the Norway and
Svalbard exceptions that `utmZone()` handles, so the two picked different central
meridians there. Consolidated onto the tested one.

---

## Second pass — the safety decision aids

The first pass covered navigation, time, GPS and the API. A second pass over the ~2,000
lines of medical and hazard modules (`tccc`, `altitude`, `avalanche`, `thermal`, `water`,
`wildlife`, `comms`, `load`) and the SOS/beacon path found 14 more, all now fixed with
regression tests. They are recorded here in the same style.

### N1. A corrupt stored return time crashes the navigate screen

`toLocalInput` returned the string `"NaN-NaN-NaNTNaN:NaN"` for an unreadable stored
value. That string is truthy, so it reached
`overdueStatus(new Date(returnLocal).toISOString())` — and `.toISOString()` on an Invalid
Date **throws `RangeError`**, inside an effect, taking the navigation screen down. In the
field, offline, with no way back.

Underneath it, `overdueStatus` parsed `NaN`, and `NaN <= 0` is false, so the overdue
alarm reported `"Return in NaN min"` and **never fired** — an alarm that looked armed
while doing nothing. `overdueStatus` now returns `null` for an unreadable time and every
caller handles it; `toLocalInput` returns `""`; a new `localInputToIso` never throws.

### N2. The SOS tone was silent on iOS

`playSosTone` creates its `AudioContext` inside a `useEffect`, one tick after the button
press. iOS and Chrome's autoplay policy start a context in that position **suspended**,
and nothing ever called `resume()`. Pressing SOS to be heard produced no sound at all on
a large share of phones. Both tone functions now resume the context before playing.

### N3. `isDark` was regex-matched out of warning text

`SafetyPanel` derived darkness with
`/dark|sunset|headlamp|polar night/i` over whichever warning happened to rank first, then
fed it to `sereAssessment` and `casevacDecision`. The navigate page has the real boolean
and never passed it. This was already fragile; the F6 re-ranking above made
"…finish with a headlamp" rank fourth, so it would now read as darkness at midday. Fixed
by passing `isDark` as a prop.

### N4. Hypothermia staging false-positived on a well person

`moderate` included a bare `!shivering`, which describes every warm, comfortable person.
`hypothermiaStage({ shivering: false, alteredMental: false, conscious: true })` returned
**"moderate hypothermia"**, and the `"none"` stage was unreachable for any input at all.
Stopped shivering now counts only with a new `coldExposed` flag, surfaced as a
"Cold / wet / wind exposed" checkbox so the real clinical signal is still available.

### N5. Avalanche severity fell as risk rose

Every factor after the first used `severity === "info" ? x : severity`, so it could only
raise severity *from* `info`. On a **considerable** day, entering one ALPTRUTh yes
answer reported `caution` where entering none reported `warning` — adding a hazard made
the assessment look safer. Replaced with a monotonic `raise()`; a property test now walks
every danger level against every ALPTRUTh count.

### N6. "Moderate altitude illness" with zero symptoms

`amsAssessment` scored altitude and ascent rate into the same total as symptoms, so
3,500 m after a 450 m/h climb scored 6 and reported **"Moderate altitude illness — do not
go higher"** to a hiker reporting nothing wrong. Exposure and symptoms are now separate;
an illness level requires at least one symptom, and the exposure advisory still fires.

### N7. The 9-line reported the whole party as casualties

Patient count defaulted to `profile.partySize`, litter to 0 and ambulatory to the
remainder, so an uninjured group of four with one hurt member transmitted
`L5 PATIENTS BY TYPE: 0L 4A`. Rescue resourcing is built from those numbers. Counts now
come from the CASEVAC inputs the panel already collects; party size moved to L8 as
context.

### N8–N14

| # | Finding |
|---|---|
| N8 | `avalancheTerrainRisk` dropped from `warning` to `caution` above 50°, rating a 55° slope less serious than the 35–45° band above which it sits. Slab frequency falls there; consequence does not. |
| N9 | START triage had no respiratory-rate input, so a casualty breathing 40/min with a pulse who could follow commands was triaged **yellow**. RR > 30 is a red criterion in its own right; now an input and now red. |
| N10 | `estimateWbgtC` transposed the ISO 7243 globe and air weights (`0.2·air + 0.1·globe`), under-reading WBGT in sun by 0.5 °C — enough to drop a heat category at a boundary. |
| N11 | Pandolf has no upper bound outside its study conditions: 2.5 m/s through 35 cm of snow up a 35% grade returned ~23,000 W (~20,000 kcal/h), which `loadPlan` turned into **30.9 kg of food and a pack at 120% of body weight**, presented as a plan. Now refuses to report an extrapolation, and the UI says why. |
| N12 | `chemicalDoseWaitMinutes` rejected sub-zero water, so near-freezing meltwater — the case that most needs extended contact time — got no guidance. |
| N13 | A 9-point non-headache symptom load scored `severity: "info"`, burying it below a hydration nag. Correctly still "not AMS", now `caution`. |
| N14 | `altitudeFromProfile` accepted a single sample and reported `crosses3000` from one reading. |

Verification after this pass: `tsc --noEmit` clean, `eslint` clean, `vitest run` **310/310**
green, `next build` succeeds.

---

## Fifth pass — the route's stored direction

### D1. "Remaining" counted up as you walked toward your destination

`stitchRelationWays` normalises every stitched OSM relation chain so it runs west-east
(`overpass.ts`, the trailing `if (first[0] > last[0]) chain.reverse()`). That is fine for
determinism and says nothing about which end anyone starts from — but
`progressAlongTrail` computed `remainingMeters` as `totalMeters - traveledMeters`,
measured from coordinate 0, and `trailheadPoint` takes coordinate 0 as "the trailhead".

So for a hiker who parked at the east end — roughly half of all traversals — the primary
readout ran backwards. Measured on a 5.3 km route:

```
                    Remaining
at the trailhead     0.00 km
                     1.32 km
halfway              2.64 km
                     3.96 km
at the destination   5.28 km
```

"Climb left" was wrong the same way, summing the ascent behind the hiker rather than
ahead of them.

The consequence is not cosmetic. `turnaroundWarning` takes `remainingMeters`, so standing
at the trailhead with 40 minutes of daylight and a 5.3 km walk ahead:

```
before:  null                    <- silent
after:   "This route still needs ~63 min; sunset is in 40 min.
          Turn around or finish with a headlamp."
```

The daylight warning was switched off at exactly the moment it had something to say, and
"Est. time" read `Done` at the start of the walk.

**Fix.** `TrailProgress` is now direction-aware. `travelDirectionAlong` establishes which
way the hiker is moving from their own breadcrumb track (two line snaps, not one per fix),
and below 40 m of along-line movement it answers `unknown` rather than guessing from GPS
jitter. `remainingMeters` counts to the end being walked toward; `remainingElevationGain`
sums the climb in that direction. Before direction is established the readout reports the
nearer end and the label changes to **"To nearer end"**, rather than asserting a figure it
cannot know.

Verification after this pass: `tsc --noEmit` clean, `eslint` clean, `vitest run` 367/367
green, `next build` succeeds.


---

## Sixth pass — the SAR decision aids

### S1. It told a solo hiker they could litter-carry a casualty

`litterEvacTime` picked a rate straight off party size with no floor:

```
party 1, 3000 m  ->  "Litter carry ~3.7 h"
party 2, 3000 m  ->  "Litter carry ~2.3 h"
```

Neither is possible. A hand-carried litter takes **six people to lift at all**, and about
twice that to rotate over any distance. Party size is also not the carrier count — the
casualty cannot carry, and someone has to stay on their airway.

The failure mode is not a wrong number on a screen. A party of two reading "~2.3 h" may
try to move a casualty rather than shelter and send for help. With too few carriers they
drop them, or exhaust themselves into a second patient, which is exactly what wilderness
medicine teaches against.

The rate table was also flat above four carriers, so a party of eight was quoted the same
speed as a party of four — no credit for the one thing that actually makes a carry viable.

**Fix.** `litterEvacAdvice` computes carriers as `partySize - 2` and refuses to produce a
time below six of them, returning the honest instruction instead:

```
party 4, 8000 m  ->  "2 available carriers — a litter carry needs at least 6 to lift and
                      about twice that to rotate. Do not attempt to move them: shelter in
                      place, insulate from the ground, and send for help. Dropping a
                      casualty or exhausting a carrier makes a second patient."
```

The panel renders that case as a destructive-styled warning rather than a grey planning
note. Above six carriers the rates are conservative and improve with rotation — and the
realistic figure changes decisions: a party of eight covering 8 km is **~9.9 h**, not the
4.1 h the old table claimed. One is an overnight; the other sounds like a walk-out before
dark.

Verification after this pass: `tsc --noEmit` clean, `eslint` clean, `vitest run` 373/373
green, `next build` succeeds.


---

## Seventh pass — the activity recorder

### R1. Flat walks reported ~1,300 m of climb

The recorder summed every positive altitude delta between accepted GPS points. Phone GPS
altitude jitters by metres per fix, and positive noise deltas accumulate: **measured with
sigma = 5 m jitter, a perfectly flat 5 km walk (500 points) reported ~1,300 m of
elevation gain.** That number went to the live "Elev gain" stat, into the stored
activity, and into every pace judgement built on it.

Fixed with the standard two-stage filter in `lib/geo/elevation-gain.ts`: exponential
smoothing (alpha 0.25) then peak/valley hysteresis (8 m) — noise oscillating inside the
band counts for nothing, real ascent is banked valley-to-peak, and an unfinished climb
still counts at stop time. Property-tested against seeded noise: the flat walk now
reports < 60 m where the naive sum reports > 800, while a genuine 600 m climb through the
same noise still measures 540–680.

### R2–R3

- **R2** The unmount-time save had no `keepalive`, so closing the tab mid-hike killed the
  PATCH and abandoned the activity with no end time and stale stats.
- **R3** Starting a recording offline failed with a bare "Failed to start activity". The
  error now says the honest thing: recording needs signal to start — use Navigate, which
  records the track offline with GPX export.

Also verified consistent this pass: the recorder's batch upload shape against the points
API (union schema accepts both), and the AMS ascent-rate input (`gainLastHourM` is
range-based, not delta-summed, so it was already noise-robust).

### C1. CI could not boot the server: two names for one secret

The `Offline navigation e2e` job failed with "server did not become ready": the workflow
exported `OWNER_TOKEN_SECRET` while the merged code reads `SESSION_SECRET` — the two
parallel hardening efforts named the same secret differently, and the cross-merge kept
one side's code with the other side's workflow and docs. Every page render threw
`MissingSessionSecretError`, so the readiness probe never saw a 200.

`SESSION_SECRET` is now canonical everywhere; `OWNER_TOKEN_SECRET` is accepted as a
legacy alias so a deployment configured with the other name does not lock every device
out of its own data (regression-tested, including that fail-closed still holds with both
names absent). The e2e probe also lost its `CHROMIUM_PATH` support in the same merge;
restored, and the whole CI job re-run locally end to end — all scenarios pass including
cold offline navigate.


---

## Seventh pass — the sheet a searcher reads

`paper-backup.ts` is the artifact handed to SAR when the phone is dead. Its header says
"hand to SAR", so it is the one output where a wrong label costs the most.

### P1. It printed the literal string `null` for a grid

`formatUsng` started returning `string | null` when it began refusing latitudes outside
the UTM grid, but the paper sheet interpolated the result straight into a template:

```
=== KLANDAGI PAPER BACKUP (hand to SAR) ===
--- GRIDS ---
Start USNG: null
End USNG: null
```

Now a grid or an explicit `unavailable (outside the UTM grid at this latitude)` — never a
word a reader has to interpret.

### P2. It named a trailhead it could not know

The sheet labelled the westernmost end **"Start USNG"**. Stored line direction is
arbitrary — `stitchRelationWays` normalises every OSM chain to run west-east
(`overpass.ts`, the trailing `chain.reverse()`), which is the same root cause as the
backwards-"Remaining" bug. On a route walked east-to-west, the page telling a searcher
where to begin named **the wrong trailhead**.

Fixed by not guessing. With no known start the sheet names both ends by compass position
and says so plainly:

```
--- ROUTE ENDS ---
West end: 11S KB 7445 8116
East end: 11S KB 7974 8102
Which end the party set off from is NOT recorded on this sheet — ask the contact.
```

The panel now passes the hiker's first breadcrumb, which *is* where they set off, and the
sheet uses it when present:

```
TRAILHEAD (party set off here): 11S KB 7974 8102
Far end of route: 11S KB 7445 8116
```

An existing test asserted the old `Start USNG` label; it pinned the unsafe behaviour and
was updated deliberately.

### Also checked, and found sound

A regression sweep re-ran every earlier finding (F1–F17, N1–N14, S1) against current
`main` after ~9,400 lines landed from parallel branches. All still hold. `overdueStatus`
no longer matches the shape my fix used, but the change is an **improvement**: it fails
closed with `overdue: true` and `remainingMin: null` rather than returning `null`, and
DST-ambiguous local times are now resolved explicitly. Mutation-testing the direction fix
(reverting `travelDirectionAlong` to the whole-session comparison) fails four tests across
both the reference and cache paths, so that coverage genuinely bites.

Verification: `tsc --noEmit` clean, `eslint` clean, `vitest run` 575/575 green,
`next build` succeeds.


---

## Eighth pass — the compass fixes (`landnav.ts`)

Resection, three-point resection and intersection are how a party with a dead GPS
works out where they are and then reads that position to a dispatcher. Every finding
below was measured against a known truth position using **perfect, error-free
bearings**, so none of it is compass slop — it is all the code.

### L1. Every bearing fix was plotted on the wrong geometry

The rays were built with `turf.destination`, which walks a **great circle**, and then
crossed with `turf.lineIntersect`, which is a **planar** intersection of raw
longitude/latitude degrees. A great circle is a curve in degree space, so the straight
chord `lineIntersect` actually crossed did not carry the bearing that was shot.

With exact bearings, `resection` returned:

| Known points at | 25.1 N | 37.7 N | 45 N | 61.2 N | 70 N |
|---|---|---|---|---|---|
| 1 km | 3.6 m | 6.0 m | 7.8 m | 14.1 m | 21.2 m |
| 5 km | 18.8 m | 30.9 m | 40.0 m | 72.5 m | 109.1 m |
| 20 km | 83.2 m | **137.2 m** | 177.4 m | **321.9 m** | 484.9 m |
| 50 km | 241.9 m | 399.0 m | 516.0 m | 937.0 m | **1 412.4 m** |

The error fitted `range² · tan(latitude) / R` exactly — and because it was identical for
every pair of points, averaging three cuts did not cancel it.

Two things were wrong, and both are fixed:

1. **The crossing.** `greatCircleFix` intersects the two rays as what they are — great
   circles — using the plane normals `P × heading`. The circles meet at `±(N₁ × N₂)`,
   which is exact rather than fitted, and `dot(candidate, heading) > 0` keeps the
   crossing that lies ahead of both shooters rather than behind them. A range cap
   survives from the old 80 km ray length, so nonsense bearings still return `null`
   instead of a confident point on the far side of the continent.
2. **The back azimuth.** A resection bearing is read *at the unknown position*, so
   `bearing + 180` is only the true reverse azimuth on a flat sheet; on the globe the two
   ends of a long line differ by the convergence of the meridians. `resectionFix` re-reads
   the bearings at the current fix and nudges each plotted ray by however much they
   disagree. The correction is second order, so it settles in two passes.

Residual error after both fixes, over the same table plus the equator, the southern
hemisphere and the antimeridian: **0.00 m at every cell**, including 50 km at 70 N.

### L2. Three cuts agreeing was sold as the fix being accurate

`resection3` reported `spreadM` — how tightly the three pairwise cuts close — and the
readout printed it as the accuracy of the fix:

```
3-pt 11S KB 7445 8116 · spread 37 m — Fix spread ~37 m, typical compass error.
```

This is the cocked hat, and a small one has never meant a good fix. Bearings off by
0°, +3° and −3° to three points 8 km out put **all three cuts within half a metre of
each other, 499 m from the party** — reported as `spread 0 m`, no warning.

Monte Carlo, 500 fixes per case, three known points, a realistic 2° compass:

| Known points at | median error | p95 error | error > 3× the quoted spread | no warning at all while >100 m off |
|---|---|---|---|---|
| 2 km | 68 m | 163 m | 17% | 4% |
| 8 km | 310 m | 647 m | 18% | 4% |
| 15 km | 538 m | 1 264 m | 16% | 2% |

At 15 km the p95-error case carried a *smaller* spread (416 m) than the median-error
case (579 m). The number was uncorrelated with the thing it was labelled as.

Fixed by separating the two ideas:

- `spreadM` stays, but only as the blunder check it really is — a wide spread means a
  misidentified peak or a misread bearing, and it now says so
  (`"Cuts disagree by ~87 m — one bearing or peak is wrong; re-shoot."`). It no longer
  produces a reassuring message when it is small.
- `fixUncertaintyM` is the number that actually bounds the fix, and it comes from the
  geometry: each ray is off sideways by `range · σ`, and a shallow cut multiplies that by
  `1/sin(cut)`. Quoted at the Rayleigh 95th percentile (2.45 σ) with σ = 2°, because a
  fix goes out as a search radius and under-quoting sends searchers to the wrong side of
  a drainage.

Measured containment over 500 fixes per case, at 1–15 km known-point ranges:

| Party's real compass error | 3-point coverage | 2-point coverage |
|---|---|---|
| 1° | 100% | — |
| 2° | 99–100% | 100% |
| 3° (sloppier than assumed) | 94–98% | 93–95% |

`resection` and `intersection` carry the radius too, where before there was no error
figure at all. All three readouts now lead with `treat as ±N m`.

### L3. Smaller readouts that could mislead

- **A full circle read as `6400 mils`.** `degreesToMils(359.99)` rounded up to 6400,
  which is a whole revolution, not a bearing. Now wraps to 0 — north.
- **A wide heading error *shrank* the dead-reckon ring.** `deadReckonUncertaintyM` used
  `tan(headingError)`, which goes infinite at 90° and negative past it: a 120° error
  reported **−1 622 m** of uncertainty, and 179° reported less than 15° did. Clamped at
  80°, past which a heading carries no information anyway. No production caller passes
  the parameter today, so this was latent.
- **Aim-off told the party to turn when it had not offset anything.** `deliberateOffset`
  clamped a negative offset to zero but kept quoting the raw number:
  `"Aim 38° true, offset -100 m right. When you hit the catching feature, turn left."` —
  the aim point *was* the target, so there was nothing to turn from. The label now
  describes what was actually applied, and says plainly that there is no side to turn
  toward.

### L4. `null` grids reaching the reader, again

P1 fixed this on the paper sheet; the same `formatUsng` null was still interpolated raw
in four other places. It fires for a non-finite position and for anything off the UTM
band, not only at the poles:

| Where | Was |
|---|---|
| `dossier.ts` | `USNG: null` / `MGRS10: null` on the sheet handed to searchers |
| `reports.ts` | `LOC: null (LAST KNOWN)` in a SITREP read over the radio |
| `safety-panel.tsx` ×3 | `Resection null · cut 90°` |
| `navigate/[planId]` | the grid line silently rendered empty |

Each now names the problem: `USNG/MGRS: unavailable for this position — use the lat/long
above`, `NO GRID — LAT/LONG 86.20000 -60.00000 (LAST KNOWN)`, `grid unavailable at this
latitude — use lat/long`.

### Also checked, and found sound

`obstacleBox` returns to the original line to within 1 cm at every heading tried, and
resumes at exactly the requested depth. `milRelationRange`, `distanceFromPaces`,
`courseCorrection`, `timeSpeedDistance` and `parseTypedHeading` all behave. Magnetic
bearings *are* converted before they reach `resection`/`intersection`, and the panel
refuses to guess when declination is unavailable — that path was already right.
`emergency.ts` and `report-field.ts` were read in full with no findings; every
`formatReport` caller spreads its arrays, so no formatter-owned line can be collapsed.
A dense coordinate sweep (UTM round-trip over −78°..82°, 1 m MGRS over 1 540 contiguous-US
points, zone seams at ten 6° meridians, band seams at 32/40/48/56/64/72) produced worst
errors of 0.05–1.4 m and zero nulls — no finding.

Mutation testing: seven mutations, each reverting one fix above, are each caught by the
new tests (dropping the convergence refinement fails 1, dropping the forward-ray test
fails 6, quoting the spread as the radius again fails 1, and so on).

Verification: `tsc --noEmit` clean, `eslint` clean (3 pre-existing warnings, 0 errors),
`vitest run` 588/588 green, `npm run build` succeeds.


---

## Ninth pass — the sun compass and the pace count (`tactics.ts`)

### T1. The watch method was still 180° wrong, just in a narrower window

An earlier pass fixed `watchMethodHeading` from `hourOn12 / 2` to
`hourOn12 / 2 + (hourOn12 > 180 ? 180 : 0)`. That branch is correct from **06:00 to
18:00 solar and 180° wrong outside it** — and the test written alongside it sampled
`[6.5, 8, 9, 10.5, 12, 13.5, 15, 16, 17.5]`, exactly the window where it works.

Outside that window is not hypothetical. Measured against real ephemeris:

| | solar hour | sun elevation | claimed south | true south | error |
|---|---|---|---|---|---|
| Anchorage, 21 Jun | 05:30 | 16.7° up | az 349° | 180° | **169°** |
| Anchorage, 21 Jun | 20:00 | 7.5° up | az 6° | 180° | **174°** |
| Yosemite, 21 Jun | 19:00 | 3.3° up | az 12° | 180° | **168°** |

The Anchorage 05:30 case is not gated out — the panel renders it:

> Point the hour hand at the sun. Midway between the hour hand and 12 — the short way
> round, **~83° clockwise from the 12 mark — is south.**

That points at azimuth 349°. North.

Both readings collapse to one dial angle — `15 · h + 180`, the same in both hemispheres —
so the branch is gone. Every case above is now within the method's own error (169° → 11°,
174° → 6°). The property test now runs 04:00–21:00 solar.

### T2. Even when it points the right way, the dial can be 38° out

The watch method assumes the sun's azimuth sweeps a uniform 15°/hour. That holds near
the equinox and near the horizon and fails badly in summer at mid-latitude:

| | error vs real ephemeris |
|---|---|
| Yosemite, 21 Dec, 09:00 solar | 2.8° |
| Yosemite, 21 Mar, 09:00 solar | 15.7° |
| Yosemite, 21 Jun, 09:00 solar | **38.3°** |
| Patagonia, 21 Dec, 15:00 solar | **34.0°** |

The hint was quoted flat, with no indication of which day you were having. But this
string only ever renders on a phone that is *already computing the sun's position*, so
it does not have to approximate at all. `sunVsWatchCheck` now leads with the exact
shadow line, and measures the dial against the real sun rather than guessing:

```
Sun bears 97° true, so your shadow points 277° true — lay a stick along it and read
directions off the shadow (do not compare the sun azimuth number to the watch-dial
angle). The watch method is 38° out at this latitude and season — use the shadow, not
the dial.
```

and where the dial is fine it is kept, with its measured error attached:

```
Sun bears 138° true, so your shadow points 318° true — … Watch method: Point the hour
hand at the sun. … (dial runs ~3° out here)
```

### T3. Nine pace beads were counted as a kilometre

A Ranger pace counter has nine lower beads, one pulled per 100 m. The ninth bead is
**900 m** — the kilometre bead goes across on the *tenth* hundred and the lower nine
reset. `paceBeads` divided by 9:

| walked | reported | overstated by |
|---|---|---|
| 900 m | 1 km + 0 beads | 100 m |
| 1 000 m | 1 km + 1 bead | 100 m |
| 4 500 m | 5 km + 0 beads | 500 m |
| 10 000 m | 11 km + 1 bead | 1.1 km |

An 11% overstatement that grows linearly, fed straight into a GPS-denied dead-reckoning
position. Two existing assertions (`paceBeads(9).km === 1`, `paceBeads(10).beads === 1`)
pinned the wrong behaviour and were updated deliberately, as the `Start USNG` assertion
was in P2. The label now shows the metres too, and a property test over 0–25 km asserts
`km · 1000 + beads · 100 === hundreds · 100` — the arithmetic cannot drift again.

### T4. An unmeasured distance was reported as "close"

`casevacDecision`'s two distance branches defaulted a missing `remainingM` in **opposite
directions** — `?? 0` in the first, `?? 99999` in the second. An unknown distance
therefore satisfied `<= 1500` and came back as:

> **walk-out** — "Ambulatory and close — slow walk-out on the packed route with a buddy."

The panel passes `remainingMeters`, an optional prop that is undefined whenever the route
has not been matched — which is precisely when a party is most likely to be lost. An
injured, ambulatory party was being told the trailhead was within 1.5 km on no evidence.

Now the missing case is its own branch: injured → stay and fix your position first;
uninjured → walk out, but with `distance out NOT measured` said plainly. When the
distance *is* known the reason quotes it (`close (~400 m)`), so the claim is always
backed by a number.

### Verification

`tsc --noEmit` clean, `eslint` 0 errors, `vitest run` 595/595 green, `npm run build`
succeeds. Five mutations — restoring the `hourOn12 > 180` branch, restoring `/ 9` beads,
restoring the `?? 0` distance default, never withdrawing the dial, and always withdrawing
it — are each caught.


---

## Tenth pass — the store everything else depends on (`profile.ts`)

The ICE contact, the overdue deadline, the waypoints and the check-ins all live in one
IndexedDB database. Every failure mode of that database was silent, and two of them were
permanent.

### DB1. A failed open was cached for the life of the page

```ts
let dbPromise: Promise<IDBPDatabase<SafetyDB>> | null = null;
export function getSafetyDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) dbPromise = openDB<SafetyDB>("hike-safety", 2, { … });
  return dbPromise;
}
```

The `typeof indexedDB === "undefined"` guard shows the intent — degrade, don't throw —
but a **rejected** `openDB` bypasses it entirely. Storage denied in a private window,
quota exhausted, a corrupt store: the rejection is cached in `dbPromise` and re-thrown by
every later call, forever.

And **no caller has a `catch`**:

| Caller | What actually happens |
|---|---|
| `safety-panel.tsx` | `void getIceProfile().then(setProfile)` — profile stays empty, unhandled rejection |
| `readiness-gate.tsx` | the whole `Promise.all` rejects, so no state is set at all |
| `navigate/[planId]` `unlockIfReady` | never reaches `setNavUnlocked(true)` — **Navigate stays locked, with nothing on screen saying why** |

### DB2. A blocked upgrade never settled at all

`openDB` does not reject when another tab holds an older version open — it simply
**never settles**. Same symptom as DB1, reached without any error occurring: an installed
PWA plus an open browser tab is enough, and the schema has already gone 1 → 2.

Both are fixed in one place. `getSafetyDb` now resolves to `null` — which every caller
already handles as "no stored profile" — and clears its cache so the next call genuinely
retries. A blocked open is raced against a 5 s ceiling; the pending open is kept rather
than discarded, so a retry re-awaits it instead of stacking a second connection. The
`blocking` callback closes this tab's connection so it is not the one hanging somebody
else, including in the microtask window between `openDB` resolving and the module
assigning the connection.

### DB3. Writes that were refused looked like writes that landed

`persistReturn` printed the deadline **before** awaiting the store:

```ts
setReturnTimeMessage(`Deadline: ${…}.`);
await setOverdueAlarm(resolved.value);   // may throw; nobody catches
```

So a phone that refused the write showed a deadline that read as armed and did nothing —
the same failure `overdueStatus` was hardened against from the other side. The ICE
profile was worse: `void saveIceProfile(next)` from a debounce, so a quota error became
an unhandled rejection while the hiker looked at their emergency contact sitting in React
state, gone on next launch. The phone most likely to be out of quota is the one that has
been caching map tiles all week — the same phone this is meant to protect.

`saveIceProfile` and `setOverdueAlarm` now return whether the write landed, and the panel
says so:

```
NOT SAVED — this phone refused to store 2026-08-20T19:00 (GMT-7, America/Los_Angeles).
Nothing here will warn you when it passes: write it down and tell your contact.
```

```
NOT SAVED — this phone refused to store these details, so they will be gone on next
launch. Free up storage, or write them on the paper backup.
```

### Also checked, and found sound

`resolveLocalDateTime` is correct: it scans ±15 h, which covers the real offset range of
−12:00 to +14:00, rejects DST gaps, and requires an explicit choice for a repeated wall
time. `overdueStatus` and `formatElapsed` fail closed and degrade units. The `parseLocalParts`
round-trip catches out-of-range component values that `Date.UTC` would otherwise roll over.

### Verification

`tsc --noEmit` clean, `eslint` 0 errors, `vitest run` 599/599 green, `npm run build`
succeeds. Seven mutations — rethrowing the open failure, re-caching it, removing the
blocked-open timeout, missing the `blocking` microtask window, stacking a second
connection on retry, rethrowing a refused ICE save, and claiming a deadline saved with no
store — are each caught.


---

## Eleventh pass — the sun as a direction reference (`astro.ts`)

The ninth pass promoted the shadow line over the watch dial, so `sunPosition` is now the
app's primary direction reference when there is no compass. That made verifying it my
own responsibility rather than an optional extra.

### A1. `sunPosition` itself is sound

It works from **day-of-year**, not days since J2000 — the year is dropped entirely. That
only holds because the mean-motion constants nearly close over a year, so the residual is
the leap cycle, and it has to be measured rather than assumed. Against the same
low-precision algorithm anchored correctly at J2000, over 2024–2035 at Yosemite,
Anchorage, Key West and New Zealand, every hour of the day where the sun is above 5°:

| | worst azimuth | worst elevation |
|---|---|---|
| 2024 | 1.13° | 0.53° |
| 2026 | 0.70° | 0.32° |
| 2035 | 0.86° | 0.39° |

Comfortably inside what a shadow stick can resolve. Midsummer noon in London comes out at
179.06° / 61.93°, which is where it should be. **No finding** — but now pinned by a test,
because the whole shadow-line change rests on it.

### A2. The shadow line was offered when there is no shadow

Neither `sunCompassHint` nor `sunVsWatchCheck` had an **upper** elevation gate. Measured:

| | sun elevation | shadow from a 1 m stick | azimuth drift |
|---|---|---|---|
| Yosemite, 21 Jun noon | 75.7° | 25 cm | 0.9°/min |
| Maui, Lahaina Noon | 87.5° | **4.5 cm** | 0.4°/min |
| Key West, 21 Jun noon | 88.9° | **2.0 cm** | **11.0°/min** |

At Key West the app said *"Shadow points ~10° true — lay a stick along it and read
directions off the shadow."* The shadow is two centimetres long and has swung further
than the width of a compass rose by the time the stick is down. Hawaii gets this twice a
year by definition — the subsolar point reaches 23.4°N.

Gated at 80° (still 18 cm of shadow), with the reason given rather than a bare refusal:

```
Sun is 89° up — nearly overhead. A 1 m stick throws only ~2 cm of shadow and its bearing
swings fast this close to noon, so neither the shadow nor a watch dial is a direction
now. Use the compass, or wait an hour.
```

### A3. A bearing of 360°

`Math.round(359.6)` is 360, so Yosemite at midsummer noon rendered *"Shadow points ~360°"*
— a compass reading that does not exist, and the same slip as the 6400-mils one in the
ninth pass. A shared `roundBearing` now keeps every rendered bearing inside [0, 360), with
a property test over −720…720.

### Verification

`tsc --noEmit` clean, `eslint` 0 errors, `vitest run` 608/608 green, `npm run build`
succeeds. Five mutations — removing either upper gate, letting `roundBearing` emit 360,
over-tightening the gate to 60°, and dropping the minutes term from GMST — are each
caught.


---

## Twelfth pass — merging round 3, and what CI is telling us

### M1. Dead reckoning died at the antimeridian

Surfaced by merging `main` (PR #34), which made `deadReckon` validate the point it
returns. `turf.destination` walks straight past ±180 rather than wrapping, so a leg
crossing the antimeridian comes back as `180.019` and the on-globe validator discarded
it:

| from | bearing | distance | turf returns | `deadReckon` returned |
|---|---|---|---|---|
| 37.7, 179.98 | 20° | 10 km | lng 180.019 | **null** |
| 51.9, 179.90 | 90° | 20 km | lng 180.192 | **null** |
| −16.5, −179.95 | 270° | 15 km | lng −180.091 | **null** |

Every dead-reckoning step across the seam returned null — in the western Aleutians,
Fiji and the Chathams — and dead reckoning exists precisely for when there is no GPS to
fall back on. `utmToLatLng` already normalizes exactly this case, with a comment saying
not to let a valid fix disappear; `deadReckon` now does the same.

### Merge resolutions

Four conflicts, all resolved toward the union rather than either side: main's separate
"sun position unavailable" case and `isValidCoordinate` guard **plus** this branch's
upper elevation gate; main's stricter `deliberateOffset` guard (which refuses a negative
offset outright) **plus** this branch's zero-offset branch, since zero still reaches the
body and is not an aim-off; main's nullable `rangeAzimuth` threaded through the spread
and uncertainty loops; main's larger grid readout **plus** this branch's no-grid
fallback.

### B3 is red on `main`, and it is not this branch's

`main` at `3fde385` fails **B3 cold offline navigate**: the service worker serves
`/offline` instead of the cached shell, even though B1 proves the shell is in Cache
Storage. Its verify job (typecheck, lint, tests, build) passes; only the e2e is red.

Investigated rather than waved off, because this is the app's central promise:

- Reproduced? **No.** 5/5 local runs pass on the merged branch.
- Is the mechanism real, or was the probe passing for a bad reason? **Real.** Killing the
  production server outright between B2 and B3 — a genuinely dead network, not a
  Playwright flag — still passes B3 from the cached shell.
- Where does the `/offline` text come from? `navigateShellHandler`'s own catch calls
  `serwist.matchPrecache("/offline")`. So on CI the cache lookup missed *and* the fetch
  failed. No client-side route pushes `/offline`, so it is the worker.

So the failure is real on the runner and not caused by this branch's changes. Rather than
push a speculative fix, the probe now reports the worker-side state whenever B3 fails —
controller and registration state, cache names, the shell cache keys, and for the exact
URL the status, content type, marker header, byte count and whether it satisfies the
predicate `sw.ts` actually gates on. The next failure will name the cause instead of
being read backwards from a screenshot of text. The block was exercised by forcing it to
run, not just written.

### A green B3 now has to have earned it

Chasing the above turned up a real weakness in the harness. B3 judged the cold open
without ever confirming the network was actually cut, so if offline enforcement ever
stops reaching service-worker fetches, B3 goes green having tested nothing — a pass on
the app's most important promise, proving nothing. It now checks: `/api/` is
`NetworkOnly` in the worker, so any response at all after `setOffline` means the worker
still has a network, and B3's result is marked `PASS*` with a warning rather than
reported as evidence.

(One of my own intermediate readings here was wrong and is worth recording: an experiment
appeared to show the worker bypassing `setOffline`, but the patch had landed on scenario
A's call site, not scenario B's. Offline **is** enforced — confirmed by the new check
reporting a genuinely cut network.)

### Hygiene noted, not acted on

`public/sw.js` is listed in `.gitignore` yet tracked, so every build dirties the tree and
any `git add -A` commits build churn. Left alone deliberately: removing a tracked
artifact could break a deployment path I cannot verify from here.


---

## Thirteenth pass — three findings from review on PR #35

An automated reviewer (Codex) raised three issues on the land-nav work. All three were
verified by execution before being touched, and all three were real. One was mine, one
predated me in code I had edited, one was overstated in magnitude but correct in kind.

### R1. The watch hint's words contradicted its own number

The ninth pass corrected the dial angle to the long arc outside 06:00–18:00 solar — and
left the prose saying **"midway between the hour hand and 12 — the short way round"**.

At 05:00 solar the hour hand is 150° from 12. The short-arc midpoint is 75°; the correct
answer is 255°. So the hint quoted 255° while instructing the reader to find 75° — a
party following the words walked **180° from the south the same sentence promised them**.
The number was fixed and the instruction was left carrying the original bug.

| solar hour | short-arc midpoint | value returned | on the short arc? |
|---|---|---|---|
| 05:00 | 75° | 255° | **no** |
| 05:30 | 82.5° | 262.5° | **no** |
| 09:00 | 315° | 315° | yes |
| 15:00 | 45° | 45° | yes |
| 19:00 | 285° | 105° | **no** |
| 20:00 | 300° | 120° | **no** |

Fixed by removing the choice rather than describing it better — one named dial position,
which is also easier to follow with cold hands:

```
Point the hour hand at the sun. South is then 255° clockwise from the 12 mark
(about the 8:30 mark).
```

A property test over all 24 hours in both hemispheres asserts the hint never says
"midway" or "short way", and always quotes the value the function actually returns.

### R2. The three-point fix averaged longitudes across the antimeridian

`resection3` took an arithmetic mean of the pairwise cuts' longitudes. Straddling ±180
that is not a mean at all. Measured, at 37.7°N / −179.9999° with ordinary bearing slop:

```
pairwise cuts at lng  -180.0000, +180.0000, -180.0000
arithmetic mean       -60.0000
fix returned          37.7000, -60.0000   →  9 619 013 m from the party
```

The Atlantic Ocean, and `SafetyPanel` passes it straight to `onGoto`. The same fixture now
returns 9 m. Replaced with a mean of the unit vectors, which has no seam — consistent
with the great-circle work in the eighth pass. This one predates the eighth pass, but it
was in code that pass edited, so it counts.

### R3. An intersection's cut angle was measured in the wrong place

`intersection` warns that observers should be 30–150° apart **"as seen from the target"**
— and then computed the angle by subtracting the bearings shot *at the observers*. Over a
curved Earth those are not the same quantity.

The review put the error at 148.8° for a true 160° cut. Measured, it is smaller than that:

| | reported | true, at the target |
|---|---|---|
| 83°N, observers 79 km out, 160° apart | 161.8° | 160.0° |
| 83°N, observers 79 km out, 90° apart | 95.8° | 90.0° |
| 70°N, 50 km, 120° apart | 121.1° | 120.0° |

1.8–5.8°, not 11°. Still worth fixing: it can flip the poor-cut warning either way within
a few degrees of the threshold, and the uncertainty radius is derived from `1/sin(cut)`,
so it carries the same skew. Now computed from the bearings back to each observer *from
the fix*, which is what the warning always claimed. Reported and true cuts now agree to
two decimal places at every case above.

`resection` and `resection3` were checked and are **not** affected: their bearings are
both taken at the party's own position, so their difference already is the cut angle
there.

### Verification

`tsc --noEmit` clean, `eslint` 0 errors, `vitest run` 672/672 green, `npm run build`
succeeds. Four mutations — restoring the arithmetic longitude mean, measuring the
intersection cut at the observers, restoring the "short way round" prose, and mis-scaling
the dial position — are each caught.

### CI

Both jobs pass on this branch at `d072f01`, **including the offline navigation e2e** that
is red on `main` at `3fde385`. So B3 is intermittent on the runner rather than broken by
either tree, and the diagnostics added in the twelfth pass remain armed for the next time
it fires.


---

## Fourteenth pass — the search patterns (`search.ts`)

These draw the ground a party actually walks when someone is missing, and the plan text
they report afterwards.

### SR1. The creeping-line search did not creep

The sideways step alternated **right, then left, then right** — walking straight back
onto the track it had just left. Measured against the drawn line for a 200 m leg and
50 m spacing, due north:

| passes | corridor covered — creeping line | corridor covered — parallel track | distance walked |
|---|---|---|---|
| 2 | 50 m | 50 m | 450 m |
| 4 | **50 m** | 150 m | 950 m |
| 6 | **50 m** | 250 m | 1 450 m |

Six passes: the searcher walks the full 1 450 m, re-walks the same two tracks three
times, and covers a corridor **one width wide**. The panel calls
`creepingLineLegs(L * 3, L, 4)`, so choosing "Creeping line" with a 100 m leg searched a
third of the ground the plan described — and the party reports the drainage clear.

`parallelTrackLegs`, sitting directly beneath it and nearly identical, was correct. The
two have been collapsed onto one `sweepLegs` implementation, because two copies of the
same geometry are exactly how one of them drifted. They differ in doctrine — creeping
line runs its legs across the search area's long axis, parallel track along it — which is
a choice the caller makes with `axisHeading`, not a difference in the pattern.

### SR2. Two exported functions disagreed about what a sector search draws

`sectorSearchLine` drew an out-and-back star centred on the datum. The panel plots the
same legs through `searchLineFromLegs`, which chains them into the equilateral triangle
off the datum that the pattern actually is. `sectorSearchLine` has no production caller,
so nothing was drawn wrongly — but leaving two exported functions that disagree about the
same named pattern is a trap for whoever wires it up next. It now chains too, and a test
pins the two to the same output.

### Checked, and found sound

`expandingSquareLegs` follows the L, L, 2L, 2L, 3L, 3L progression correctly, and the
tracks it lays down are one spacing apart with no gap wider than that — verified from the
drawn coordinates, not from the leg list. `sectorSearchLegs`' cumulative distance is right
for the triangle the panel draws, so an earlier suspicion that it halved the distance
walked was **wrong and is not a finding**: that would only have applied to the unused star.

### Verification

`tsc --noEmit` clean, `eslint` 0 errors, `vitest run` 675/675 green, `npm run build`
succeeds. Two mutations — restoring the alternating sideways step, and restoring the star
— are each caught. CI is green on this branch at `eec8f4c`, both jobs.


---

## Fifteenth pass — the route card (`route-card.ts`)

The route card is printed onto the SAR paper backup, so its legs are what a searcher
plots when the phone is dead.

### RC1. Each leg paired a trail distance with a straight-line bearing

`meters` is the distance **along the trail** since the last leg point. `trueDeg` is the
bearing of the **straight line** between those points. The card printed them as one
leg — `L1 7° true / 254 m` — as though they described the same thing.

On a straight route they do. On a switchbacked one they are nowhere near each other:

| route shape | printed distance | actual chord | plotting error |
|---|---|---|---|
| straight, 2 km | 250 m | 250 m | 0% |
| gentle arc, 1.3 km | 251 m | 250 m | 0% |
| **switchbacks, 3 km** | **254 m** | **176 m** | **+44%** |
| | 269 m | 180 m | +50% |

Switchbacks are what a mountain trail *is*, which is exactly when this card gets
carried. A searcher plotting `7° true / 254 m` off the paper sheet draws that leg 78 m
too long, and the error compounds down all twelve legs.

Both numbers are real and a party needs both — the chord is what pairs with the bearing,
the trail distance is what a pace count measures — so the card now prints both and says
which is which, and only adds the second number where the leg actually bends:

```
Each leg: bearing pairs with the STRAIGHT distance; the trail distance is what you pace.
L1 7° true / 176 m straight (254 m along the trail) cum 254 m 11S KB 7445 8116
```

A straight route still reads `L1 90° true / 334 m cum 334 m …` with no second figure.

### Also checked, and found sound

`routeCardLegs` samples by path distance rather than flattened chords, keeps
MultiLineString components independent so no leg is fabricated across a gap the hiker
cannot walk, warns when the route is discontinuous, and reports honestly when the printed
legs are only a prefix of the route. A null `rangeAzimuth` rolls the distance into the
next leg rather than dropping it. `formatRangeAzimuth` already accepts null.

### Verification

`tsc --noEmit` clean, `eslint` 0 errors, `vitest run` 702/702 green, `npm run build`
succeeds. Two mutations — making the chord equal the path distance, and printing only the
trail distance beside the bearing — are each caught.


---

## Sixteenth pass — altitude illness (`wilderness.ts`)

### W1. Altitude could manufacture an emergency out of a headache

`amsAssessment` already separates *exposure* (altitude, ascent rate) from *symptoms*, and
its own comment gives the reason: scoring exposure as illness produced "a false alarm that
teaches people to ignore the warning bar". That fix stopped exposure creating a diagnosis
out of nothing — but severity was still thresholded on `exposure + symptoms`, so exposure
could still drive the *level*:

| symptoms | 1 500 m, +100 | 2 600 m, +200 | 3 500 m, +450 |
|---|---|---|---|
| headache | mild | mild | **severe — "Possible HACE/HAPE … descend immediately. This is an emergency."** |
| headache + nausea | mild | moderate | **severe** |

A headache at 3 500 m after a fast climb is the most common altitude symptom there is and
is textbook **mild** AMS; the standard response is to stop ascending, rest and hydrate.
Two hikers with identical symptoms were also handed diagnoses three steps apart on
altitude alone.

There is a second problem in that string. HACE is defined by ataxia or altered mental
status; HAPE by breathlessness at rest — which this symptom list cannot record at all. So
the emergency wording named two conditions, one of which the input can never establish,
on symptoms that established neither.

Fixed by driving severity from the symptoms and letting exposure escalate it **one step,
not three**, and by reserving the HACE wording for the finding that earns it:

| symptoms | result now |
|---|---|
| headache, 3 500 m, +450 | moderate — "do not go higher. Rest, hydrate, monitor closely." |
| headache + nausea + dizziness | moderate at any altitude |
| all five non-ataxia symptoms | severe — "Severe AMS — descend now", **no** HACE/HAPE claim, plus an action naming what would make it one |
| ataxia | severe — "treat as HACE … this is an emergency", at every altitude, unchanged |
| fatigue alone below 2 500 m | none, unchanged |

An existing assertion pinned `headache` at 3 600 m as `severe`; like the `Start USNG` and
`paceBeads(9).km === 1` assertions before it, it encoded the behaviour being fixed and was
updated deliberately, with the reasoning recorded beside it. The test's intent — that
symptoms produce a diagnosis — is preserved; only the severity moves.

**This one is a judgement call in a medical area and is flagged as such.** It makes the
app *less* alarming in a specific case, which is the direction that deserves scrutiny. The
change aligns the ladder with ordinary wilderness-medicine practice (stop ascent for mild;
descend for moderate and severe; emergency for HACE) and does not touch the ataxia path,
which remains severe and unconditional.

### Verification

`tsc --noEmit` clean, `eslint` 0 errors, `vitest run` 705/705 green, `npm run build`
succeeds. Four mutations — thresholding on the combined score again, letting exposure
escalate all the way to severe, restoring the HACE/HAPE wording for every severe case, and
dropping the one-step escalation entirely — are each caught, so the tests pin both
directions.


---

## Seventeenth pass — the track-point window (`backtrack.ts`)

`gainLastHourM` and `rapidAscentWarning` decide whether the party is climbing fast enough
to be at risk of altitude illness, and `stationaryMinutes` decides whether they have
stopped moving. All three read the breadcrumb track through the same time window.

### T1. One corrupt timestamp made "not moving" return NaN

`sampleTime` guards `Date.parse` with `Number.isFinite`. `stationaryMinutes`, twenty
lines above it in the same file, called `Date.parse` raw:

```
[40 min ago, 20 min ago, now]                 -> 40
[40 min ago, "not-a-date",  now]              -> NaN
```

`Math.min(oldest, NaN)` is NaN and it propagates out. NaN compares false against every
threshold, so the not-moving warning did not misfire — it **silently stopped firing**,
which is the worse failure.

### T2. One NaN altitude deleted the rapid-ascent warning

`altitude != null` lets NaN through, and one NaN poisons `Math.min`. A real 900 m ascent:

| track | `gainLastHourM` | warning |
|---|---|---|
| clean | 900 m | "You gained ~900 m in the last hour above 2,400 m…" |
| one NaN altitude inserted | **NaN** | **null** |

So a single bad altitude sample removed the altitude-illness warning entirely *and* zeroed
the exposure that feeds `amsAssessment`. Fail-quiet, in the direction of under-warning.

### T3. A future-dated point counted as "the last hour"

The window test was `now - t <= windowMs`, which **any** future timestamp satisfies. A
point dated 90 minutes ahead at 9 000 m was inside the window and became the newest
sample:

```
You gained ~7000 m in the last hour above 2,400 m. Slow down and watch for altitude illness.
```

7 000 m in an hour is not a rate a human produces, and an impossible warning is how a party
learns to disbelieve the warning bar — the same failure `amsAssessment`'s own comment cites.

All three now share one guarded window: an unparseable timestamp drops the sample rather
than fabricating recency, a timestamp beyond two minutes of clock skew ahead of `now` is
rejected, and altitudes are filtered to finite values.

### Also checked, and found sound

`gainLastHourM` uses `last − min(window)` rather than summing positive deltas, so it does
not accumulate GPS altitude jitter the way the recorder's naive sum once did — the
residual bias from taking a minimum over a noisy series is on the order of 10–15 m against
300 m thresholds. `readiness.ts` is sound.

### Verification

`tsc --noEmit` clean, `eslint` 0 errors, `vitest run` 710/710 green, `npm run build`
succeeds. Five mutations are each caught — but only after a sixth test was added: the
first round left "corrupt timestamps read as `now`" **surviving** inside the altitude
window, covered only for `stationaryMinutes`. The gap was in the tests, not the fix, and
is recorded here because a mutation that survives is the only evidence that a test suite
is thinner than it looks.


---

## Severity 1 — position and time are silently wrong

### F1. `parseUsng` resolves the wrong 2 000 km northing band → ~4 000 km position error

`src/lib/safety/usng.ts:181-197`

A USNG/MGRS grid carries northing only modulo 100 000 m, and the 100 000 m square
letters repeat every 2 000 000 m. `parseUsng` therefore disambiguates against a hint
(the user's own GPS fix). The disambiguation is wrong:

```ts
const base = Math.floor(hintUtm.northing / 2_000_000) * 2_000_000;
northing = base + northingMod;
if (Math.abs(northing - hintUtm.northing) > 1_000_000) {
  northing = northingMod < hintUtm.northing
    ? base + 2_000_000 + northingMod      // <-- always taken
    : base - 2_000_000 + northingMod;     // <-- dead code
}
```

`northingMod` is always `< 2 000 000` and `hintUtm.northing` is `> 2 000 000` anywhere
north of ~18°N, so the condition is a constant `true` and the `base - 2_000_000` branch
can never execute. When the correct answer sits *below* the hint's band boundary, the
code adds 2 000 km instead of subtracting it.

The 4 000 000 m northing line sits at roughly **36.1°N** — through the southern Sierra,
Death Valley, southern Nevada, the Grand Canyon rim, northern New Mexico, Arkansas and
Tennessee. Any pair of points straddling it fails.

**Verified** (`hint` = Mount Whitney, target 62 km south):

```
grid "11S LV 82860 86948"  hint 36.5785,-118.2923  target 36.02,-118.30
parsed back -> 71.9527, -120.3893     error = 3997 km
```

The parse lands in the Canadian Arctic. Two points **17 km apart** straddling the line
reproduce the same error.

Blast radius — every SAR entry point in `src/components/offline/safety-panel.tsx` feeds
this function the user's fix as the hint: go-to grid (`:982`, `:1221`), two-point
resection (`:1088-1089`), three-point resection (`:1128-1130`), intersection
(`:1172-1173`). A grid read over the radio from a SAR team can plot 4 000 km away, and
`resection()` will return a "fix" with a plausible-looking cut angle to go with it.

Fix — pick the congruent candidate nearest the hint instead of guessing a direction:

```ts
const base = Math.round((hintUtm.northing - northingMod) / 2_000_000) * 2_000_000;
northing = base + northingMod;
```

Add a sanity gate too: if the result is more than ~500 km from the hint, return `null`
rather than a confident wrong answer. Note also that the no-hint southern-hemisphere path
(`:188-192`) leaves `northing` at `northingMod` and then subtracts 10 000 000 in
`utmToLatLng`, which is unrecoverable garbage.

---

### F2. `daylightStatus` uses the UTC calendar day → "It is dark" in broad daylight, every evening, across the Americas

`src/lib/safety/daylight.ts:38-67`, `solarEventsUtc` at `:72-102` (and
`minutesUntilSunset`, `:27-32`)

`solarEventsUtc` derives sunrise/sunset from `date.getUTCFullYear/Month/Date`. West of
Greenwich the local evening falls on the *next* UTC day, so from the moment local time
crosses 00:00 UTC the function returns **tomorrow's** solar events and compares today's
instant against them. `date < sunrise` is then trivially true and `isDark` flips on.

**Verified** (Yosemite 37.75, -119.60, 2026-08-20; real sunset ≈ 19:45 PDT):

```
16:00 PDT  isDark=false  minutesUntilSunset=227    warning=null
17:00 PDT  isDark=true   minutesUntilSunset=1605   "It is dark — use a headlamp and turn back if unsure."
19:00 PDT  isDark=true   minutesUntilSunset=1485   "It is dark — use a headlamp and turn back if unsure."
```

At 17:00 PDT there are 165 minutes of daylight left and the app reports darkness plus
"26.75 hours until sunset". Onset is 17:00 local Pacific, 18:00 Mountain, 19:00 Central,
20:00 Eastern (daylight time) — i.e. it begins *before* sunset in every US time zone, and
the error persists all night.

This is not merely a bad message. `isDark` gates real behaviour in
`src/app/navigate/[planId]/page.tsx`: it is the first argument to `hypothermiaWarning`
(`:411-412`), `sereAssessment` (`:424-425`) and `moonWarning` (`:420`) — all of which now
fire in daylight — and, worst, `turnaroundWarning` returns `null` outright when `isDark`
is set (`declination.ts:96`). **The "you will not finish before dark" warning is disabled
across exactly the window in which it is the only warning that matters.**

The existing test passes because both cases it checks (`21:00Z` = 14:00 PDT, same UTC
day; `06:00Z` = 23:00 PDT, genuinely dark) land on the correct answer anyway — the second
one via the broken `beforeSunrise` branch.

Fix — resolve the solar day at the location's own longitude rather than at UTC. Shift by
`lng/15` hours before extracting the calendar date, and return the *next* sunset when the
current instant is already past today's.

---

### F3. The repeating off-trail alert never repeats

`src/app/navigate/[planId]/page.tsx:352-358`

```ts
useEffect(() => {
  if (severity === "unknown" || severity === "ok") return;
  if (shouldRepeatAlert(lastAlertRef.current, severity)) {
    vibrateOffTrail(severity);
    lastAlertRef.current = Date.now();
  }
}, [severity]);
```

`severity` (`:347`) is a string union. The effect re-runs only when its *value* changes.
Once you are `"critical"` you stay `"critical"`, so the body executes exactly once and
`shouldRepeatAlert` is never consulted again.

`shouldRepeatAlert` exists solely to re-fire every 12 s (critical) or 30 s (warn) —
`src/lib/safety/alerts.ts:30-38` — so the intent is unambiguous. As written, a hiker who
walks off-route gets **one** vibration and then silence, no matter how far they continue.
The on-screen banner stays up, but the whole point of the haptic is the phone-in-pocket
case.

Fix — add a ticking dependency so the guard is re-evaluated; `shouldRepeatAlert` already
rate-limits, so the extra invocations are free:

```ts
}, [severity, progress]);
```

---

## Severity 2 — safety logic that misleads

### F4. `turnaroundWarning` assumes 5 km/h on the flat and contradicts the Naismith figure printed beside it

`src/lib/safety/declination.ts:89-104`

```ts
const WALK_MPS = 5000 / 3600;                        // 5 km/h, called "an easy pace"
const minutesNeeded = remainingMeters / WALK_MPS / 60;
if (minutesNeeded > minutesUntilSunset + 10) { ... }
```

Three optimistic assumptions stack, all pointing the unsafe way: 5 km/h is a brisk *road*
pace (trail is 3–4 km/h), remaining climb is ignored entirely, and a further 10-minute
grace is added before the warning fires.

The repo already has the right estimator and already renders it on the same screen —
`src/app/navigate/[planId]/page.tsx:882-884` prints
`naismithMinutes(progress.remainingMeters, progress.remainingElevationMeters)`.

**Verified** — 6 km remaining, 500 m of climb remaining, sunset in 95 minutes:

```
turnaroundWarning  -> null
naismithMinutes    -> 122 min needed        (printed on the same screen)
```

The screen simultaneously reads "~2 h 2 min remaining", "95 min until sunset", and issues
no turnaround warning. Fix — feed the warning the same numbers:

```ts
export function turnaroundWarning(
  remainingMeters: number, remainingGainMeters: number,
  minutesUntilSunset: number, isDark: boolean,
) {
  const minutesNeeded = naismithMinutes(remainingMeters, remainingGainMeters);
  if (minutesNeeded > minutesUntilSunset) { ... }
}
```

and drop the `+10`. Also reconsider `if (minutesUntilSunset <= 0) return null` (`:97`):
once F2 is fixed, a non-positive value means the sun has already set, which is precisely
when the warning should be loudest.

### F5. Dead-reckoned positions are marked `trusted`, and the DR heading silently defaults to due north

`src/app/navigate/[planId]/page.tsx:200-211`, `:689`, `:821`

```ts
const trusted = gpsDenied ? Boolean(drFix) : gpsTrusted;
const navFix  = gpsDenied && drFix ? drFix : gps.fix;
```

`drFix` (`:200-208`) is a pure dead-reckon from an anchor, advanced either by pace count
or by `(deniedNow - anchor.at) / 1000 * 1.15` (`deniedNow` ticks every 5 s) — i.e. it assumes the hiker has walked at
4.1 km/h continuously since the anchor was set, lunch stops included, with an error that
grows without bound and no accuracy estimate attached. That synthetic position then flows
into `progressAlongTrail`, `offTrailLevel` (`:347-350`), `backtrackProgress`, and is
rendered as a **USNG grid** at `:734`.

Worse, the anchor heading is taken as `fix.heading ?? 0` (`:689`, `:821`). Browser
geolocation reports `heading` as `null` whenever the device is not moving, and iOS Safari
frequently reports `null` outright. Arming DR while standing still therefore anchors the
heading to **0° — due north** — with no warning, and the app dead-reckons the user
northwards regardless of which way they actually walk, raising off-trail alerts against a
fabricated track.

Fix — refuse to arm DR without a real heading (or prompt for one); keep `trusted` false
in DR mode so `offTrailLevel`'s `trustedFix: false` short-circuit applies; and pair the
displayed grid with an explicit growing error radius. The `· DR` suffix at `:735` is the
right idea but it sits beside a 4-digit grid that implies 10 m precision.

### F6. Every other safety warning is suppressed exactly when you are off-trail

`src/app/navigate/[planId]/page.tsx:469-489` and `:773`

`skyWarning` collapses 19 independent conditions into one `??` chain, then renders it
only under `{skyWarning && severity === "ok" && ...}`. Two consequences:

1. **Off-trail hides everything else.** Overdue check-in, hypothermia, AMS, avalanche
   terrain, GPS-spoof, fall detection and the turnaround warning all vanish the moment
   `severity` leaves `"ok"` — that is, precisely when the situation is deteriorating.
2. **The priority order is inverted for the slow killers.** `turnaround` sits at
   position 17 of 19, below `slopeWarn` ("Slope ~30% — steep") and `hydrateWarning`
   ("No water logged for 31 min"). A hiker about to be benighted gets a hydration nag
   instead. The recent additions (`routeProfileWarnings.altitude`,
   `routeProfileWarnings.avalanche`) were inserted *above* `turnaround`, pushing it
   further down.

The suppression looks like collision avoidance — both banners are absolutely positioned
at `top-16`. Fix by stacking the banners rather than muting one, and by ranking the chain
on time-to-harm (overdue / turnaround / hypothermia / AMS first, comfort nags last).

---

## Severity 3 — correctness and data integrity

### F7. Negative true bearings are rendered to the user

`src/lib/safety/declination.ts:66-73`; source at `src/lib/geo/navigation.ts:73`

`progressOnSegment` sets `bearingToTrail: turf.bearing(...)`, which returns −180…180.
`formatWalkBearing` formats `Math.round(trueBearing)` without normalising — while the
magnetic half *is* normalised, so the two disagree.

**Verified:**

```
bearingToTrail = -122.3   rendered -> "Walk -122° true / 224° magnetic"
```

That string appears in the critical OFF TRAIL banner
(`src/app/navigate/[planId]/page.tsx:768`) and in the safety panel
(`safety-panel.tsx:590`, `:625`). "Walk −122°" is not a bearing anyone can set on a
compass. The unit test only ever passes `40`. Normalise in `formatWalkBearing`, or better
at the source in `progressOnSegment` — `TrailProgress.bearingToTrail` is documented as a
heading and every consumer expects 0…360.

### F8. `sanitizeFixTimestamp` revives ancient fixes; `isTrustedFix`'s `stale` flag is dead code

`src/lib/safety/gps-quality.ts:22-42`

```ts
if (now - t > DISPLAY_FIX_MS) return now;   // a 3-day-old fix becomes "now"
```

The intent (defend against clock skew) is right, but the fallback is the most dangerous
available value. **Verified:** `sanitizeFixTimestamp(now - 3 days)` returns exactly
`Date.now()`, and `isTrustedFix` on that result is `true` — a three-day-old position is
promoted to a live fix with no staleness marker. Prefer a sentinel the caller must
handle, or clamp to `now - DISPLAY_FIX_MS` so the fix reads as maximally old rather than
brand new.

Separately:

```ts
export function isTrustedFix(recordedAt, stale, now = Date.now()) {
  if (stale && fixAgeMs(recordedAt, now) > TRUSTED_FIX_MS) return false;   // no-op
  return fixAgeMs(recordedAt, now) <= TRUSTED_FIX_MS;
}
```

The first line can never change the result. **Verified:** `stale=true` and `stale=false`
both return `true` for a 60 s-old fix. Either honour the parameter (a fix the GPS layer
has explicitly flagged as held-over is arguably never "trusted") or remove it — as it
stands it reads as a safety check that does nothing.

### F9. `slopeWarning` never fires on a descent

`src/lib/safety/field-ops.ts:91-95`, fed by `slopeFromProfile` at `:97-110`

`slopeFromProfile` returns a signed percentage; `slopeWarning` only tests `percent >= 45`
/ `>= 25`. Every descent yields a negative value and is silently safe. **Verified:**
`slopeWarning(45)` returns the Class 3/4 warning, `slopeWarning(-45)` returns `null`.
Descending a 45 % slope is at least as hazardous as ascending it — and it is where falls
happen. Compare on `Math.abs(percent)` and word the message by sign.

### F10. Research-brief source URLs are unvalidated LLM output rendered as links

`src/lib/research/schema.ts:14-19`, `src/components/trails/research-brief.tsx:94-104`

`sources[].url` is `z.string()`, not `z.string().url()`, and is rendered straight into
`href`. The value originates from `generateObject` over a prompt that interpolates Tavily
search-result `content` verbatim (`src/lib/research/agent.ts:83-99`) — attacker-influenceable
text. A poisoned result can steer both the link target and the "hazards"/"permits" prose
the user reads as safety guidance. Constrain the schema to `z.string().url()`, reject
non-`https:` schemes at render time, and fence the retrieved text in the prompt as
untrusted data.

### F11. The API surface is still unauthenticated

Every route under `src/app/api/**` now carries an explicit `TODO(auth)` marker
(`plans/route.ts:28`, `:50`; `plans/[id]/route.ts:29`, `:60`, `:87`;
`activities/[id]/route.ts:22`, `:62`), so the gap is known rather than overlooked. It is
still live: `GET /api/plans` returns the 50 most recent plans **for the whole
deployment**, and `GET /api/activities/[id]/points` returns raw GPS traces to anyone with
an id. Plans carry names, notes and waypoints; activity points are a precise movement
history.

Decide the posture and write it down: if this is genuinely a single-user deployment, say
so in the README and put the whole app behind platform auth; otherwise add an owner
column and scope every query. (The related error-message leak is **fixed** — `errorResponse`
in `src/lib/api/errors.ts` now returns a fixed string plus a request id and logs the real
error server-side.)

---

## Severity 4 — hygiene and documentation

| # | Finding | Location |
|---|---|---|
| F12 | `gmAngleCard` presents magnetic declination as the **G-M angle**. In a UTM/USNG workflow the grid–true convergence (up to ~3° at zone edges) is part of that angle. Either add convergence or rename it a declination card. | `src/lib/safety/declination.ts:42-64` |
| F13 | Comment says the expanding square "doubles every two sides"; the code implements the correct linear `L, L, 2L, 2L, 3L, 3L`. The comment is wrong, not the code. | `src/lib/safety/search.ts:9-13` |
| F14 | README states off-trail warnings "use a 50 m threshold"; the code warns at 35 m and escalates at 80 m, after subtracting half the GPS accuracy. | `README.md:111` vs `src/lib/safety/alerts.ts:3-18` |
| F15 | `useGps` sets `deniedRef` permanently on `PERMISSION_DENIED`; the watchdog then never restarts the watch, so granting permission later requires a page reload. | `src/hooks/use-gps.ts:133`, `:179` |
| F16 | `saveLastFix` writes to IndexedDB on **every** position callback (up to 1 Hz) for the life of the hike. Throttle to ~10 s; battery is a stated constraint of this app. | `src/hooks/use-gps.ts:119` |
| F17 | `formatUtm` renders `11N` where `N` means hemisphere, but in UTM/MGRS a trailing letter is conventionally the latitude *band* (`11S` for California). Read aloud to a SAR team this is genuinely ambiguous. | `src/lib/safety/usng.ts:82-86` |
| F18 | `timeSpeedDistance({ distanceM: 0, speedKph: 5, minutes: 10 })` passes the `have >= 2` gate on the other two values and returns `{ distanceM: 0, minutes: 0 }`, discarding the supplied `minutes`. | `src/lib/safety/landnav.ts:189-209` |
| F19 | Morse timing in `playSosTone` is approximate — dash 320 ms against dot 120 ms (should be 3:1 = 360 ms), a uniform 80 ms gap with no inter-character spacing. Fine as a locator tone, not decodable as Morse. | `src/lib/safety/strobe.ts:66` |
| F20 | `loadPack` returns the cached pack unconditionally and never revalidates, so there is no way to refresh a route from the navigate screen even with full signal. Defensible offline-first behaviour now that `getRoutePack` rejects stale versions — but surface `cachedAt` and offer a manual refresh. | `src/app/navigate/[planId]/page.tsx:216-222` |
| F21 | `npm run lint` is not yet gate-clean: 2 × `react/no-unescaped-entities` in `safety-panel.tsx:763`, `:847`. Down from 14 errors — worth closing so lint can become a CI gate. | `src/components/offline/safety-panel.tsx` |
| F22 | `public/sw.js` (46 KB) is still a committed Serwist build artifact. It is now excluded from lint via `eslint.config.mjs`, but it will still conflict on every build; gitignore it. | `public/sw.js` |
| F23 | **`npm ci` fails on `main`** — `package.json` declares `playwright@^1.62.1` as a devDependency but `package-lock.json` has no entry for it. **Verified:** `npm ci` against the committed pair errors `EUSAGE … Missing: playwright@1.62.1 from lock file` (plus `playwright-core`, `fsevents`). Any CI job using `npm ci` cannot install. Fix is one `npm install` and a lockfile commit. | `package.json:50` vs `package-lock.json` |

---

## Already fixed since `a002c42` — no action needed

Recorded so a reader of an earlier draft is not chasing closed items:

- **`parseGpx`** now matches `lat`/`lon` in either order and either quote style, validates
  both floats with `Number.isFinite` plus range bounds, handles `<rtept>`, and returns a
  `MultiLineString` for multi-segment tracks (`src/lib/geo/index.ts:162-195`).
- **`PATCH /api/plans/[id]`** builds its update object with `"key" in body` guards on both
  the Drizzle and local-store branches, so a partial PATCH no longer nulls untouched
  fields. Bodies are zod-validated via `parseJsonBody`.
- **Route packs** are version-gated — `getRoutePack` returns a pack only when
  `routePackStatus` is `"ready"`, which requires `pack.version === ROUTE_PACK_VERSION`
  (`route-pack.ts:171-175`) — and aliases are now pointer records in a separate object
  store instead of full duplicate payloads.
- **API error responses** no longer echo internal exception text.
- **`computeTrackStats`** and its dead `startTime` / `0 / x` arithmetic were removed.
- **Lint noise** is down from 94 warnings to 0.

---

## What the tests are not covering

239 tests pass and the suites are well-written for what they assert — but they only ever
exercise inputs on the correct side of each defect:

- `daylight.test.ts` samples 21:00Z and 06:00Z — one on the same UTC day as local, one
  genuinely dark. It never samples the 00:00Z–06:00Z window where F2 lives.
- `declination.test.ts` calls `formatWalkBearing(40, …)` only — never a negative bearing (F7).
- `usng.test.ts` round-trips within a single 2 000 km band, so F1 is invisible.
- Nothing round-trips `parseUsng ∘ formatUsng` across a band boundary, and nothing checks
  `turnaroundWarning` against `naismithMinutes` for consistency.

Four property-style tests would have caught F1, F4, F7 and F9 outright:

1. `parseUsng(formatUsng(p, 5), hint)` is within 50 m of `p` for random `p` and `hint`
   within 200 km of each other.
2. `turnaroundWarning` fires whenever `naismithMinutes(remaining, gain) > minutesUntilSunset`.
3. Every bearing rendered to the user is in `[0, 360)`.
4. `slopeWarning(x)` and `slopeWarning(-x)` agree on whether a warning is warranted.

## Suggested order of work

1. **F1, F2, F3** — wrong position, wrong time-of-day, silent alert. Each is a small,
   contained diff with an obvious regression test.
2. **F4, F5, F6** — the warning layer telling the user the wrong thing at the wrong moment.
3. **F7–F10** — correctness and data integrity.
4. **F11** — decide the deployment's security posture and write it down.
5. **F12–F23** — hygiene. Take **F23 first**: until the lockfile is regenerated no CI job
   can `npm ci` at all, so nothing else here can be gated. Then F21, so `npm run lint`
   can become one of those gates.
