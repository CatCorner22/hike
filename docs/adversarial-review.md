# Adversarial review — Hike

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
