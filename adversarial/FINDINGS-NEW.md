# New features — adversarial findings

## Summary

**3 HIGH, 3 MEDIUM, 0 LOW.** The newest safety export surface is not yet
hardened: a paper route card can materially understate a route or direct a
hiker across a discontinuity, and paper-backup content can forge its own SAR
fields. The readiness gate also gives a green result to absent/invisible names,
an unusable ICE number, and a return deadline 50 years away.

All findings below were reproduced by the new probes, not inferred from a
test name. I did not modify application source, existing tests, the running
server, or its data.

## F-01 Route card lies about long and disconnected routes — HIGH

**Hiker consequence:** A hiker carrying the exported card can prepare for an
8.34 km hike that is actually 30 km, or follow a 222 m / 45° leg that points
across a roughly 157 km gap between two route components.

**Where:** `src/lib/safety/route-card.ts:32-60`, especially the
`legs.length < maxLegs` loop condition at line 37 and the end-of-route
condition at line 43.

**Reproduction:**

    cd /home/user/workspace/hike && npx vitest run adversarial/probe-new-features.test.ts --reporter=verbose

Actual output:

    DISCONNECTED_ROUTE_CARD {"leg":{"index":1,"from":{"lng":0,"lat":0},"to":{"lng":1.001,"lat":1},"meters":222.37322491774813,"cumMeters":222.37322491774813,"trueDeg":45.02426711738394,"grid":"31N BB 7754 1059"},"card":"Total ~222 m · 1 legs · bearings are TRUE"}
    TRUNCATED_ROUTE_CARD {"legs":25,"printedTotal":"8340","actualMeters":30000}
    Test Files  1 passed (1)
         Tests  8 passed (8)

**Why it happens:** The loop stops processing entirely once it has generated
25 legs, then `formatRouteCard` labels the last processed cumulative value as
the route's `Total`. For a `MultiLineString`, `legStart` is not reset at a new
component, while `pathSinceLeg` and `cum` do not include the inter-component
gap. The next leg therefore uses a straight-line bearing across the gap but
reports only the sum of the short segments.

**Suggested fix:** Continue calculating the full route total after limiting
printed legs and label a shortened card explicitly (for example, “first 25
legs; route total X”). Treat components as separate legs/sections, with an
explicit “connection not navigable / verify transition” marker rather than a
leg across a discontinuity. Add exact tests for both cases.

**Confidence:** High. Both defects are deterministic pure-function outputs
from valid `LineString`/`MultiLineString` inputs. There is no dedicated
`route-card.test.ts`; the only existing paper-backup test is happy path.

## F-02 Paper backup allows forged SAR fields and sections — HIGH

**Hiker consequence:** A printed “last resort” sheet can say a forged return
time, a forged hiker identity, or a false “I am safe” check-in, leading a
contact or SAR responder to act on information that was never a real field.

**Where:** `src/lib/safety/paper-backup.ts:37-52`.

**Reproduction:**

    cd /home/user/workspace/hike && npx vitest run adversarial/probe-new-features.test.ts --reporter=verbose

Actual output:

    PAPER_FORGED_LINES ["Return by: 2099-01-01T00:00:00Z","ROUTE CARD — Normal trail --- RETURN --- Return by: 2099-01-01T00:00:00Z","Hiker: forged","I am safe"]
    Test Files  1 passed (1)
         Tests  8 passed (8)

**Why it happens:** `buildPaperBackup` directly interpolates `trailName`,
profile fields, `packAge`, and check-in text into a newline-delimited
document. `formatRouteCard` applies `reportField` to its own title, but the
surrounding paper-backup fields do not. Newlines are therefore interpreted as
real report layout rather than user data. This is a distinct path from the
already-fixed report-field CRLF issue.

**Suggested fix:** Apply the same report-field normalization to *every*
untrusted printed field (or render one escaped, bounded line per field) and
make section labels structurally generated only. Bound profile and note
lengths before persistence/export.

**Confidence:** High. The probe calls the production export function and
prints the exact forged lines. `src/lib/safety/readiness.test.ts` covers only
a normal name, ICE entry, and route.

## F-03 Readiness claims the safety card and overdue alarm are armed with unusable data — HIGH

**Hiker consequence:** A hiker can see a complete checklist despite an
invisible identity, a non-callable ICE number (`000-0000`), and a return
deadline in 2076, then leave believing contact and overdue safeguards exist.

**Where:** `src/lib/safety/readiness.ts:18-23`,
`src/lib/safety/field.ts:5-8`, and `src/components/offline/readiness-gate.tsx:78-95`.

**Reproduction:**

    cd /home/user/workspace/hike && npx vitest run adversarial/probe-new-features.test.ts --reporter=verbose

Actual output:

    READINESS_ACCEPTED {"ok":true,"missing":[]}
    INVISIBLE_ICE_ACCEPTED {"ok":true,"missing":[]}
    Test Files  1 passed (1)
         Tests  8 passed (8)

The first input had a 10,000-character name, ICE phone `000-0000`, and
`2076-08-20T18:00:00.000Z`. The second had a U+200B hiker name and U+200B
U+200B ICE name.

**Why it happens:** Readiness only checks that the hiker name survives
JavaScript `trim()`, `isIceFilled` only asks for two name code units and seven
digits, and the return time only has to parse as a finite date. U+200B is not
removed by `trim()`, all-zero digits satisfy the phone rule, and no usable
return-time window or input length exists.

**Suggested fix:** Normalize/strip Unicode format controls for required
display names; enforce sensible byte/code-point limits; validate ICE against
a deliberately documented international-phone policy (including rejecting
all-zero placeholders); and require an explicit confirmation for a deadline
outside a conservative trip window. The UI should describe incomplete/invalid
as such rather than green.

**Confidence:** High for the observed acceptance and missing bounds. Whether
to accept every valid international number is product policy, but these
specific values cannot provide the promised safety function. Existing
`field.test.ts` tests only short name/phone rejection, and
`readiness.test.ts` has no hostile-text, length, fake-number, or far-future
deadline probe.

## F-04 Fall-back return time cannot be selected in the readiness UI — MEDIUM

**Hiker consequence:** At a repeated DST wall time, the form tells a hiker to
choose first or second occurrence but offers no way to do so, so the overdue
alarm cannot be armed from this gate.

**Where:** `src/components/offline/readiness-gate.tsx:78-85, 189-194`.

**Reproduction:**

    cd /home/user/workspace/hike && npx vitest run adversarial/probe-new-features.test.ts --reporter=verbose

Actual output:

    AMBIGUOUS_RETURN {"kind":"ambiguous","message":"That local time occurs twice because clocks change. Choose the first or second occurrence."}
    Test Files  1 passed (1)
         Tests  8 passed (8)

**Why it happens:** `resolveLocalDateTime` correctly returns `ambiguous`
unless it receives an `earlier`/`later` occurrence. The gate has no occurrence
state or controls, calls it with the default `null`, clears the alarm on
non-resolved input, and the “Skip” path only persists a resolved result.

**Suggested fix:** Render the two returned choices, label their offsets, and
pass the chosen occurrence to `resolveLocalDateTime`. Preserve an existing
armed alarm until the user intentionally replaces it.

**Confidence:** High for the code path; medium for field impact because this
affects only the fall-back hour. The resolver itself is already well tested in
`src/lib/safety/profile.test.ts`; the missing UI completion path is not.

## F-05 Pack weather has no freshness or location provenance at the decision point — MEDIUM

**Hiker consequence:** A three-day-old -8 °C / 70 km/h snapshot can be used as
field weather with no displayed age and no way for the hiker to tell whether
it came from this route rather than another location.

**Where:** `src/lib/offline/pack-weather.ts:1-42`,
`src/lib/offline/route-pack.ts:142-151`, and
`src/components/offline/safety-panel.tsx:1480-1484`.

**Reproduction:**

    cd /home/user/workspace/hike && npx vitest run adversarial/probe-new-features.test.ts --reporter=verbose

Actual output:

    STALE_WEATHER_ACCEPTED {"validation":null,"weather":{"source":"open-meteo","cachedAt":"2026-08-17T19:42:10.213Z","tempC":-8,"windKph":70},"hasLatitude":false,"hasLongitude":false}
    Test Files  1 passed (1)
         Tests  8 passed (8)

**Why it happens:** `PackWeather` retains current conditions and a timestamp
but no forecast-coordinate, source-observation time, or expiry. Route-pack
validation only requires a parseable timestamp. The Safety panel says
“pack-time snapshot” and “Not a live forecast” but renders neither the
timestamp nor a relative age, while it pre-fills field weather values from the
snapshot.

**Suggested fix:** Store request coordinates and source observation time;
display “saved X ago at [location]”; distinguish current observation from
forecast; and visibly mark/require confirmation for stale values before using
them in field calculations.

**Confidence:** High. The probe builds and validates a real route pack, and
the UI source confirms that `cachedAt` is not rendered there. There is no
`pack-weather.test.ts`; route-pack tests do not cover stale provenance.

## F-06 Paused movement is added to activity distance on resume — MEDIUM

**Hiker consequence:** If a hiker pauses recording, walks to a new position,
then resumes, the entire paused displacement is recorded as active hiking
distance and corrupts distance and pace.

**Where:** `src/components/activities/activity-recorder.tsx:120-145, 210-218`.

**Reproduction:**

    cd /home/user/workspace/hike && node adversarial/probe-new-activity-pause.mjs

Actual output:

    PAUSE_DISTANCE_RESULT {"patchCount":1,"distanceMeters":851.8025561446004,"durationSeconds":1.35}

The browser probe loads the actual production UI with only API responses and
geolocation mocked. It records an initial fix, pauses, moves 0.01° longitude
while paused (about 852 m at 40° latitude), resumes, emits the next fix, and
captures the final PATCH body. The whole paused displacement was persisted as
active distance.

**Why it happens:** `pauseRecording` stops the watcher but retains
`lastPointRef`. `resumeRecording` starts a new watcher without resetting that
reference or marking the first post-resume fix as a new baseline. The normal
distance block therefore compares the resumed point with the pre-pause point.

**Suggested fix:** Clear/rebaseline `lastPointRef` (and decide explicitly
whether elevation gain should also reset) when resuming, then add a
component/browser regression test that moves while paused.

**Confidence:** High. This was reproduced through the rendered component and
its real stats persistence path. No `activity-recorder.test.tsx` exists;
`activity-sync.test.ts` tests offline queueing only.

## Feature-by-feature test inventory

| Feature | Existing test? | Gap exercised here |
| --- | --- | --- |
| Readiness / ICE / overdue | Yes: `readiness.test.ts`, `field.test.ts`, `profile.test.ts` | No hostile Unicode, oversize input, fake phone, far-future deadline, or readiness-gate UI selection test. |
| Paper backup / route card | Only a happy-path paper-backup assertion inside `readiness.test.ts` | No route-card-specific test; no hostile field, long route, or disconnected `MultiLineString` test. |
| `src/lib/urls.ts` and SMS | Yes: `urls.test.ts`, `strobe.test.ts`, plus existing adversarial SMS coverage | No `tel:`, `mailto:`, or `geo:` constructor exists in the reviewed new code. |
| Pack weather | No `pack-weather.test.ts` | No stale snapshot, source-location, or age-display test. |
| Offline activity pause | No component test | `activity-sync.test.ts` covers syncing, not pause/resume stats. |
| Camping stops | API search has `src/app/api/camping/search/route.test.ts` | No `src/app/plan/[id]/page.tsx` camping-stop UI test. |
| First-run guide | No | No guide page or urgent-navigation-path test. |

## Held up under attack

- `httpsUrl` rejected `javascript:`, `data:`, and `http:` values and preserved
  a normal HTTPS reservation URL. The same run printed:

      URL_CONTAINMENT {"href":"sms:5551234?body=Need%20help%26cc%3Dattacker%0D%0AL1%3Dforged","destination":"5551234","cc":null,"body":"Need help&cc=attacker\r\nL1=forged","safeUrls":[{"raw":"javascript:alert(1)","result":null},{"raw":"data:text/html,boom","result":null},{"raw":"http://example.test","result":null},{"raw":"https://example.test/ok","result":"https://example.test/ok"}]}

  The SMS body remained one encoded body parameter and hostile `&cc=` did not
  become an additional URL parameter.
- The resolver rejects spring-forward nonexistent local times and detects
  fall-back ambiguity rather than silently choosing an instant. The remaining
  issue is the gate’s lack of a choice control (F-04), not the resolver.
- A past stored return deadline is rendered overdue by existing
  `overdueStatus` coverage rather than quietly treated as future. I did not
  independently simulate a real device time-zone change end to end; the
  stored alarm uses an absolute ISO instant, which is the correct design.
- The first-run guide is a normal `/guide` page with links; the reviewed code
  has no auto-opening overlay or hard gate over an urgent map. I did not find
  an application behavior to report, but it has no direct automated test.

