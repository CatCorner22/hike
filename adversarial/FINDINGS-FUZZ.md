# Fuzz safety calculations — adversarial findings

## Summary
**3 genuine findings: 2 HIGH, 1 MEDIUM; 0 CRITICAL, 0 LOW.** The core safety rules are mostly careful about finite scalars, explicit timestamps, unit round trips, and the previously fixed movement/medical contradiction. The remaining exposure is a fail-confident boundary: a minute altitude crossing downgrades advice, and several public geo/emergency calculators either fabricate a plausible answer, emit an unusable SOS, or throw when their supposedly numeric input is corrupt.

Scope/harness: `adversarial/probe-fuzz.test.ts` dynamically inventories callable exports from all 46 `src/lib/safety/*.ts` and `src/lib/geo/*.ts` calculation modules (the only source module without a callable export is `safety/severity.ts`). It sweeps `NaN`, infinities, signed zero, subnormal and maximum finite values, exact bands and adjacent floating-point values, empty/singleton/corrupt arrays, and controlled unit/action cases. Run with:

    cd /home/user/workspace/hike && npx vitest run adversarial/probe-fuzz.test.ts

Most recent full run: 3/7 properties passed; the four failed properties are the three issues below plus the broader text-leak bucket. The latter includes already-known generic formatter `NaN m` variants and is not separately reported here.

Existing-test check (run before reporting; excluding this new probe) found no test for the precise altitude pair or for `NaN`/out-of-range emergency and coordinate cases:

    cd /home/user/workspace/hike && grep -RInF 'previousNightElevationM: 3000, currentElevationM: 3000' src adversarial --include='*.test.ts' --include='*.test.tsx' | grep -v 'probe-fuzz.test.ts' || true && grep -RInE 'formatCoords\(NaN|lat: NaN|lat: 100' src adversarial --include='*.test.ts' --include='*.test.tsx' | grep -v 'probe-fuzz.test.ts' || true

Actual output: *(none; exit 0)*

## F-01 `ascentRateAdvice` downgrades at the 3000 m boundary — HIGH
**Hiker consequence:** A hiker who rises by an immeasurably small amount from 3000 m to 3000.0000000000005 m, with no change in sleeping gain, sees the safety severity drop from **caution** to **info** even though altitude did not become safer.

**Where:** `src/lib/safety/altitude.ts:222-248`, specifically the `currentElevationM <= 3000` caution branch at lines 230-236 followed by the zero/low-gain `info` branch at lines 244-248.

**Reproduction:**

    cd /home/user/workspace/hike && npx tsx -e 'import { ascentRateAdvice } from "./src/lib/safety/altitude"; for (const currentElevationM of [3000,3000.0000000000005]) console.log(JSON.stringify({currentElevationM,result:ascentRateAdvice({previousNightElevationM:3000,currentElevationM})}));'

Actual output:

    {"currentElevationM":3000,"result":{"gainM":0,"severity":"caution","message":"Approaching 3000 m: build in acclimatization time and do not ascend with symptoms."}}
    {"currentElevationM":3000.0000000000005,"result":{"gainM":0,"severity":"info","message":"Sleeping elevation gain 0 m is within the ~500 m/night guideline above 3000 m. Plan a rest day every 3–4 days or ~1000 m."}}

The reusable threshold/ULP probe independently fails with:

    ascent altitude: severity fell at 3000.0000000000005, rank 1 -> 0

**Why it happens:** The policy treats `<= 3000` as “approaching” and always returns `caution`, but immediately above that threshold it only warns for gain greater than 500 m. A zero-gain case thus takes the lower `info` return despite a greater current elevation.

**Suggested fix:** Define a monotonic policy for current sleeping elevation and gain together. At minimum, preserve `caution` for the just-above-3000/low-gain path (or replace the special “approaching” band with a policy that cannot outrank its more hazardous neighbor). Add exact threshold and `nextafter`-style tests; keep the existing `>500 m` warning escalation.

**Confidence:** **High.** It is deterministic, reproduced directly and by the full sweep, and no existing test exercises this exact no-gain boundary pair. The output is safety-relevant even though the physical delta is tiny because real elevation sources can round either side of the boundary.

## F-02 Coordinate calculations accept impossible locations and produce confident navigation — MEDIUM
**Hiker consequence:** If a corrupt or imported position with latitude 100 reaches the calculation layer, it can be transformed into a plausible bearing, distance, and dead-reckoned point instead of being refused, encouraging navigation from a location that cannot exist.

**Where:** `src/lib/geo/index.ts:41-76` (`distanceToTrailMeters`, `nearestPointOnTrail`); `src/lib/safety/landnav.ts:29-62` (`rangeAzimuth`, `deadReckon`); also `src/lib/safety/search.ts` and `src/lib/geo/project.ts` receive the same unchecked coordinate shape.

**Reproduction:**

    cd /home/user/workspace/hike && npx tsx -e 'import { distanceToTrailMeters,nearestPointOnTrail,bearingBetween } from "./src/lib/geo"; import { rangeAzimuth,deadReckon } from "./src/lib/safety/landnav"; const p={lat:100,lng:-105}, q={lat:40,lng:-105}, line={type:"LineString",coordinates:[[-105,40],[-104.99,40.01]]} as const; for(const [n,f] of [["distance",()=>distanceToTrailMeters(p,line)], ["nearest",()=>nearestPointOnTrail(p,line)], ["bearing",()=>bearingBetween(p,q)],["range",()=>rangeAzimuth(p,q)],["dead",()=>deadReckon(p,90,100)]]) {try {console.log(n,JSON.stringify(f()))} catch(e) {console.log(n,"THREW",(e as Error).message)}}'

Actual output:

    distance 6670592.848305507
    nearest {"lng":-104.99,"lat":40.01,"distanceMeters":6670592.848305507,"index":1}
    bearing 180
    range {"meters":6671704.814011974,"trueDeg":180,"magneticDeg":null,"mils":3200,"backTrueDeg":0,"backMils":0}
    dead {"lat":79.99999995997257,"lng":-105.00517897955183}

The same sweep also proves failure rather than a safe refusal for non-finite values:

    geo.distanceToTrailMeters(NaN): threw coordinates must contain numbers
    landnav.rangeAzimuth(NaN): threw coordinates must contain numbers
    landnav.deadReckon(Infinity): threw coordinates must contain numbers
    search.expandingSquareLine(Infinity): threw coordinates must contain numbers

**Why it happens:** These exported functions pass raw `lat`/`lng` to Turf. Turf normalizes or projects many finite but out-of-range values (for example, 100 degrees latitude) and throws on some non-finite values. The geo module already has finite/range validation for trail geometries but does not apply an equivalent guard to the input point.

**Suggested fix:** Put one shared `isValidLatLng` guard at each public calculation boundary (or return a typed `null`/unavailable result). Do not return `NaN` sentinels or call Turf for invalid input. Update display callers to render “position unavailable,” and test finite-range validation as well as `NaN`/infinities.

**Confidence:** **High that the calculations are wrong; medium that normal live GPS reaches them.** `src/hooks/use-gps.ts:65,91` validates cached and live fixes, which protects the ordinary GPS path. The exported safety/geo surface remains unsafe for imported, persisted, or future callers, and there is no local guard in the calculators themselves.

## F-03 Emergency-share message emits false coordinates and can throw on a bad timestamp — HIGH
**Hiker consequence:** With corrupt emergency metadata, the app can either generate a copyable SOS that says it was sent from `NaN,-105` or throw before producing any emergency text, depriving the hiker of a safe “no usable fix” fallback.

**Where:** `src/lib/safety/emergency.ts:5-10` formats all numeric values without validation; `:30-52` treats any non-null coordinate as valid and calls `toISOString()` for any truthy timestamp; `:75-85` still labels the malformed location as sent from offline-capable GPS.

**Reproduction:**

    cd /home/user/workspace/hike && npx tsx -e 'import { emergencyMessage } from "./src/lib/safety/emergency"; import { gpsAccuracyLabel } from "./src/lib/geo/navigation"; import { sunCompassHint } from "./src/lib/safety/astro"; console.log(emergencyMessage({lat:Number.NaN,lng:-105,accuracyM:Number.NaN})); console.log(gpsAccuracyLabel(Number.NaN)); console.log(sunCompassHint(new Date(Number.NaN),40,-105));'

Actual output:

    SOS / EMERGENCY LOCATION
    NaN°S, 105.00000°W (±NaN m)
    DDM: —
    UTM/USNG unavailable at this latitude — use latitude/longitude or a polar grid.
    https://maps.google.com/?q=NaN,-105
    Sent from Hike app (offline-capable GPS).
    GPS ±NaN m (poor — canyon/trees)
    Sun ~NaN° true (elev NaN°). Shadow points ~NaN° — check your compass against that.

    cd /home/user/workspace/hike && npx tsx -e 'import { emergencyMessage } from "./src/lib/safety/emergency"; for (const recordedAt of [Number.NaN,Infinity,-Infinity]) {try { console.log(String(recordedAt), JSON.stringify(emergencyMessage({lat:40,lng:-105,recordedAt}))) } catch(e) {console.log(String(recordedAt),"THREW",(e as Error).message)}}'

Actual output:

    NaN "SOS / EMERGENCY LOCATION\\n40.00000°N, 105.00000°W\\nDDM: 40°0.000'N 105°0.000'W\\nUSNG 8-digit: 13T EE 0000 2775\\nMGRS 10-digit: 13T EE 00000 27757\\nPHONETIC: One Three Tango Echo Echo Zero Zero Zero Zero Zero Two Seven Seven Five Seven\\nUTM: 13T 500000 4427757\\nhttps://maps.google.com/?q=40,-105\\nSent from Hike app (offline-capable GPS)."
    Infinity THREW Invalid time value
    -Infinity THREW Invalid time value

**Why it happens:** `lat != null`/`lng != null` admits `NaN` and infinity; `formatCoords` then interpolates them, and the Maps URL is assembled directly. `recordedAt` only receives a truthiness check, so `new Date(Infinity).toISOString()` throws a `RangeError`.

**Suggested fix:** Require a finite, in-range coordinate pair before formatting, grid conversion, URL creation, or the “Sent from ... GPS” label. Treat bad coordinates as the existing “No GPS fix available” state. Only add a fix-time line for a finite timestamp whose `Date#getTime()` is finite; otherwise omit it or explicitly mark it unavailable. Use the same validation for `accuracyM` and other displayed quantities.

**Confidence:** **High.** Both malformed SOS output and the exception reproduce exactly. The normal hook sanitizes live and cached GPS fixes, but `emergencyMessage` is also called from `dossier.ts` and remains an unguarded exported emergency formatter, so it should independently fail safe.

## Held up under attack
- **Unit calculations and round trips:** `formatElevation` used the expected m-to-ft factor at 0, 1, 100, 1609.344, 3000, and 8848 m; 1 km at 60 km/h produced 1 minute; UTM→lat/lng round-tripped within 4 decimal places. The dedicated unit property passed.
- **Action contradictions sampled:** severe-altitude illness selected `urgent-assisted-descent`, heat-stroke triage said not to force fluids, unsafe lake water said not to drink, litter advice said shelter in place, and food storage said no food in tent. The matrix test passed; I did not re-report the already-known altitude CASEVAC contradiction.
- **Explicit-time determinism:** `alerts.shouldRepeatAlert`, SAR communications reminders, TCCC tourniquet status, GPS fix age, and valid `stationaryMinutes` calls matched across repeated invocations with a supplied timestamp.
- **Expected upstream protection, not a finding by itself:** `use-gps.ts` rejects invalid live and stored latitude/longitude and discards non-finite accuracy before it reaches the normal navigation UI. This reduces reachability of F-02/F-03 but does not make their exported calculation boundaries fail safe.
- **Not reported because the probe assumption was too broad:** an invalid `Date` also makes moon/sun helpers produce `NaN` prose, but their current UI callers construct `new Date()` locally; I did not establish an externally reachable invalid-date path, so it is not counted as a finding.

## Coverage limitations
- I did not drive a browser GPS mock through every app screen or mutate IndexedDB route-pack contents; the report proves the exported calculation behavior directly.
- The dynamic inventory covers all 46 callable modules, but browser-only copy/storage helpers were inventoried rather than invoked with arbitrary argument shapes to avoid treating unavailable `navigator`/storage as a numerical-safety defect.
