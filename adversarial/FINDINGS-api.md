# Adversarial HTTP API assessment — confirmed findings

**Target:** Next.js production server, fallback JSON-store mode (`DATABASE_URL` absent)  
**Assessment time:** 2026-08-20  
**Evidence runner:** `adversarial/api-probe.mjs`  
**Scope note:** destructive concurrency testing used isolated `LOCAL_STORE_PATH` files under `adversarial/`; no application source file was changed by this assessment. The local store was rewritten during the assessment, so the final concurrency result below is a fresh remeasurement of the current code, built immediately before test.

## Finding count

| Severity | Count | Findings |
|---|---:|---|
| Critical | 1 | F-01 |
| High | 2 | F-02, F-03 |
| Medium | 3 | F-04, F-05, F-06 |
| Low | 3 | F-07, F-08, F-09 |

## Ranked findings

### F-01 — Complete unauthenticated plan/activity IDOR and enumeration
**Severity:** Critical  
**Reproduction:** Probe cases `IDOR plan enumeration`, `IDOR read by UUID`, `IDOR unauthenticated PATCH`, `IDOR unauthenticated DELETE`, `IDOR activity enumeration`, `IDOR activity PATCH`, and `unauthenticated activity-point read`.

```bash
# create a record, then from an unauthenticated client:
curl -s http://127.0.0.1:3111/api/plans
curl -s http://127.0.0.1:3111/api/plans/<uuid>
curl -s -X PATCH -H 'content-type: application/json' \
  --data '{"notes":"mutated-without-auth"}' http://127.0.0.1:3111/api/plans/<uuid>
curl -s -X DELETE http://127.0.0.1:3111/api/plans/<uuid>
```

**Observed:** the probe created an Owner-A synthetic plan/activity and, with no credentials, listed it, read it by UUID, changed it, deleted a second plan, listed the activity, changed it, and read its points. All mutation requests returned HTTP 200.  
**Expected:** every list/read/mutate endpoint must identify the caller and scope records to ownership; cross-user IDs must not be readable, mutable, or deletable.

**Root cause:** explicit TODOs acknowledge no ownership enforcement: `src/app/api/plans/route.ts:28,50`, `src/app/api/plans/[id]/route.ts:29,60,87`, `src/app/api/activities/route.ts:21,39`, `src/app/api/activities/[id]/route.ts:22,62`, and `src/app/api/activities/[id]/points/route.ts:29,58`. The schema also has no owner/user column (`src/lib/db/schema.ts:62-97`).

**Real Postgres impact:** unchanged and arguably broader: Drizzle queries are not scoped to an owner, so all database-backed plans, activities, and points are exposed/mutable.  
**Recommended fix:** require authentication in a shared route guard; add `ownerId` plus foreign key/indexes; derive the owner only from the session; add `WHERE id = ? AND owner_id = session.user.id` to every read/update/delete; scope list queries; return 404 for out-of-scope objects.

---

### F-02 — Fallback-store plan updates lose 49 of 50 acknowledged concurrent writes
**Severity:** High (when the JSON fallback is deployed)  
**Reproduction:** Final remeasurement output in `adversarial/retest-concurrency-output.json` after rebuilding the just-modified application and starting it with `LOCAL_STORE_PATH=/home/user/workspace/adversarial/retest-store.json`:

```json
{
  "pointHttp200": 50,
  "pointPersisted": 50,
  "patchHttp200": 50,
  "patchRetained": 1,
  "plansVisible": 50
}
```

The test created 50 plans serially, then issued 50 simultaneous `PATCH /api/plans/:id` operations, each setting a different plan's `notes` value. **All 50 requests returned HTTP 200, but only 1 of the 50 acknowledged note changes remained.**

**Observed:** data loss still exists for plan metadata. The concurrent point result is now **50/50 persisted**: the new append-only journal fixes the specific point-insert race. This report deliberately does **not** report the previous 0/50 point result, because it was superseded by the current-code remeasurement.

**Expected:** acknowledged writes to different resources must all persist.  
**Root cause:** `createPlan`, `updatePlan`, and `deletePlan` still do unsynchronized whole-file read–modify–write sequences in `src/lib/store/local.ts:102-148`; `writeStore` overwrites the entire base JSON file at lines 83-90. Concurrent writers overwrite one another's snapshots. The append-only change at lines 194-201 applies only to activity points.

**Real Postgres impact:** the JSON-file lost-update mechanism does not apply to individual SQL `UPDATE`/`INSERT` statements. However, Postgres still has last-write-wins behavior for concurrent updates to the same row unless optimistic concurrency/version checks are added.  
**Recommended fix:** do not expose the JSON fallback in multi-request production; use Postgres. If a file fallback is retained, serialize all base-store mutations through a process-wide queue/mutex and use atomic temp-file+rename writes; for multi-process deployments, use a file lock or a transactional embedded DB. Add revision/version columns and conditional writes for user-facing conflict detection.

---

### F-03 — No general JSON body-size cap; arbitrary 10 MB data is retained
**Severity:** High  
**Reproduction:** Probe case `10MB waypoints persisted without limit`:

```bash
node adversarial/api-probe.mjs
# Evidence: HTTP 200; 10,485,760-byte waypoints.blob returned/stored
```

Equivalent request pattern:

```bash
node -e 'const b="z".repeat(10*1024*1024);fetch("http://127.0.0.1:3111/api/plans",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"large",waypoints:{blob:b}})}).then(r=>console.log(r.status))'
```

**Observed:** a plan with a 10 MiB `waypoints.blob` was accepted and returned. The probe also sent 10 MiB and 60 MiB JSON bodies to every POST/PATCH route: all non-GPX routes read and processed the request (HTTP 200 where the target record still existed; one activity PATCH later returned 404 because the earlier old-store race had erased that synthetic record, not because of a size check).  
**Expected:** an API should reject oversized request bodies before full JSON parse/allocation and impose field-level limits on arbitrary JSON fields.

**Root cause:** `parseJsonBody` unconditionally calls `await request.json()` with no byte limit (`src/lib/api/validation.ts:50-65`). `waypoints` is `z.unknown()` in both plan schemas (`src/app/api/plans/route.ts:19`, `src/app/api/plans/[id]/route.ts:19`) and is written verbatim to the store (`src/lib/store/local.ts:119`).

**Real Postgres impact:** the request-memory/CPU cost and unbounded JSONB database/storage growth remain; only the file-write behavior differs.  
**Recommended fix:** enforce a shared content-length and streaming byte cap before parsing (for example 1 MiB normal JSON, a separately justified cap for GPX), reject missing/invalid content lengths where appropriate, and bound/deep-validate `waypoints` (max serialized bytes, depth, item count, and schema).

---

### F-04 — State-changing GET endpoints can create/update database rows and trigger paid upstream work
**Severity:** Medium  
**Reproduction:** Code-confirmed paths (runtime proof against the no-DB instance is necessarily unavailable because writes are skipped in fallback mode):

```bash
curl -i 'http://127.0.0.1:3111/api/trails/osm-relation-123'
curl -i 'http://127.0.0.1:3111/api/research/osm-relation-123?refresh=true'
curl -i 'http://127.0.0.1:3111/api/sync/offline?trailId=osm-relation-123'
```

**Observed:** 
* `GET /api/trails/:id` calls `findOrCreateTrail` for an OSM ID (`src/app/api/trails/[id]/route.ts:10-14`). With Postgres, that function updates or inserts a trail (`src/lib/trails/service.ts:28-79`) and calls Open Elevation.
* `GET /api/sync/offline?trailId=osm-*` also calls `findOrCreateTrail` (`src/app/api/sync/offline/route.ts:22-25`).
* `GET /api/research/:trailId` calls `findOrCreateTrail`, calls the research agent, and inserts a `trail_research` row (`src/app/api/research/[trailId]/route.ts:16-18,32-39`). `refresh=true` bypasses the 24-hour cache check at line 30.

These handlers set no `Cache-Control`/other cache-control headers (the route responses use bare `NextResponse.json`); the normal `/api/plans` response observed in the probe likewise lacked `Cache-Control`. The OSM route requests were each still waiting on an unavailable Overpass service after 15 seconds in this environment, so header capture for their final response is **unconfirmed**; source review confirms the handlers do not add cache headers.

**Expected:** GET is safe/read-only; expensive refresh/import/research operations are authenticated, rate-limited jobs initiated by POST, with server-side cooldowns that cannot be bypassed by an untrusted query parameter.

**Real Postgres impact:** this finding only becomes state-changing with Postgres, but that is the production database configuration.  
**Recommended fix:** make discovery GET-only; move refresh/import/research to authenticated POST endpoints with CSRF protection, per-user/IP quotas, idempotency keys, queueing, and a server-enforced cooldown. Set explicit `Cache-Control: no-store` on user/stateful APIs.

---

### F-05 — Outbound Overpass requests have no timeout; adversarial search requests exceeded 10 seconds
**Severity:** Medium  
**Reproduction:** Original probe cases `Overpass payload "\\" under 2s`, `"\""`, `".*"`, `"(a+)+$"`, `"["`, and a second-statement payload. Each client request timed out at approximately **10,001 ms** with HTTP status 0. Server logs later recorded upstream Overpass HTTP 500/502 failures. The same behavior occurred for OSM-ID GETs after 15 seconds.

**Observed:** requests took more than the required 2-second ReDoS threshold, but the evidence attributes the delay to unavailable upstream Overpass hosts, **not to catastrophic regular-expression evaluation**. `runOverpass` invokes two remote `fetch` calls with no `AbortSignal`/timeout (`src/lib/osm/overpass.ts:49-76`). An unauthenticated caller can create distinct cache keys and concurrently hold outbound requests open.

**Expected:** bounded outbound request time, concurrency, and retry budget.

**Overpass injection/ReDoS conclusion:** **solid against the tested syntax; no injection or regex-ReDoS confirmed.** Route input is capped at 64 characters before use (`src/app/api/trails/search/route.ts:8-15`). `escapeOverpassRegex` slices to 64, escapes backslash and quote, then escapes all Overpass regex metacharacters (`src/lib/osm/overpass.ts:79-86`). Therefore `\\`, `"`, `\\"`, `.*`, `(a+)+$`, `[`, and the statement-breakout payload are embedded as literal regex text rather than executable Overpass syntax. The network was too unhealthy to obtain successful end-to-end Overpass responses for each payload, but source-level escape coverage is complete for these cases.

**Recommended fix:** apply `AbortSignal.timeout(...)` (or a manual controller) to each upstream call, a total request deadline, bounded retry/backoff, a concurrency limiter, and endpoint rate limits. Cache normalized search queries before calling upstream.

---

### F-06 — Activity-point list is unbounded and unpaginated
**Severity:** Medium  
**Reproduction:** `GET /api/activities/<id>/points`; probe case `activity point GET has no pagination metadata`.

**Observed:** the response returns all points in one JSON array. There is no limit, cursor, or pagination metadata in either path: `src/app/api/activities/[id]/points/route.ts:53-68`; fallback `listActivityPoints` filters/sorts all points at `src/lib/store/local.ts:204-208`; Postgres `findMany` at route lines 59-63 has no limit.  
**Expected:** bounded/paginated point retrieval, especially for long recordings.

**Qualification:** a 100,000-point live response was **not** generated in the wrap-up window, so the exact memory/latency at that size is unconfirmed. The absence of a limit is confirmed by code and a normal unpaginated response.  
**Recommended fix:** require `limit` with a hard maximum, use a stable cursor (`recordedAt,id`), support viewport/time ranges, and consider compressed GPX/line endpoints for bulk export.

---

### F-07 — Baseline browser security headers are absent
**Severity:** Low  
**Reproduction:**

```bash
curl -i http://127.0.0.1:3111/api/plans
```

**Observed:** API response had no `Content-Security-Policy`, `X-Content-Type-Options`, or `Referrer-Policy`; probe case `missing baseline security response headers` confirmed all three missing.  
**Expected:** baseline response headers consistent with the UI's threat model.

**Root cause:** `next.config.ts` has no `headers()` policy and route handlers do not set these headers.  
**Recommended fix:** configure CSP (tailored for required map assets), `X-Content-Type-Options: nosniff`, a restrictive `Referrer-Policy`, `Permissions-Policy`, and clickjacking protection (`frame-ancestors` in CSP).

---

### F-08 — GPX parser accepts malformed coordinate strings by prefix
**Severity:** Low  
**Reproduction:** Probe case `GPX accepts malformed numeric attribute prefixes`:

```bash
curl -s -X POST http://127.0.0.1:3111/api/sync/offline \
  -H 'content-type: application/json' \
  --data '{"gpx":"<gpx><trkseg><trkpt lat=\"12evil\" lon=\"34junk\"/><trkpt lat=\"13oops\" lon=\"35bad\"/></trkseg></gpx>"}'
# Observed geometry coordinates: [[34,12],[35,13]]
```

**Observed:** HTTP 200 imported values with nonnumeric suffixes.  
**Expected:** malformed numeric attributes are rejected.

**Root cause:** `Number.parseFloat` accepts valid numeric prefixes in `src/lib/geo/index.ts:170-173`.  
**Recommended fix:** require an entire trimmed attribute to match a strict decimal grammar before conversion and reject the complete GPX if any presented point coordinate is malformed.

---

### F-09 — JavaScript integer precision is silently lost in activity stats
**Severity:** Low  
**Reproduction:** Probe case `unsafe integer silently rounded in stats`:

```bash
curl -s -X PATCH -H 'content-type: application/json' \
  --data '{"stats":{"unsafe":9007199254740993}}' \
  http://127.0.0.1:3111/api/activities/<id>
# returned: 9007199254740992
```

**Observed:** the server accepted the unsafe JSON integer and returned the rounded IEEE-754 value.  
**Expected:** integer-like measurements needing exactness should reject values outside the safe-integer range or represent them as strings/decimal values.

**Root cause:** stats only uses `z.number().finite()` (`src/app/api/activities/[id]/route.ts:11-15`).  
**Recommended fix:** use `z.number().safe()` for integer counters or explicit bounded schemas per statistic.

## Verified solid / negative results

* Malformed, empty, truncated JSON and `[]` where an object was required returned HTTP 400 on every mutating API route tested.
* Point schemas rejected strings, objects, nested arrays, null, `NaN`/infinity JSON literals, out-of-range latitude/longitude, and `1e308`; accepted exact coordinate boundaries and finite subnormals as intended.
* Bbox validation rejected invalid ranges, reversed bounds, and `NaN`; query length caps were enforced: trail search 64 and camping search 128 characters.
* GPX upload correctly enforced its approximately 5 MiB limit: 10 MiB and 60 MiB requests returned HTTP 413. GPX entities were inert: the XXE file entity did not expose `/etc/passwd`; a billion-laughs-shaped payload completed in 3 ms; a pathological attribute test completed in 5 ms. The parser is regex-based and does not resolve XML entities.
* GPX export implementation escapes `&`, `<`, `>`, quotes, and apostrophes (`src/lib/geo/index.ts:153-160`); its Content-Disposition filename replaces every non-alphanumeric character (`src/app/api/sync/offline/route.ts:31-33`), preventing CR/LF filename injection. Direct end-to-end control of a trail name was unavailable without a database/OSM fixture.
* Path traversal/ID abuse strings against plans, activities, trails, and research returned 404 without stack traces, SQL, filesystem paths, or environment values. The shared unexpected-error body is only `{error, requestId}` (`src/lib/api/errors.ts:3-7`). I did not obtain a controlled 500 from every route before wrap-up; the claim is limited to tested responses and source inspection.
* ILIKE is parameterized (`sql\`${campgrounds.name} ILIKE ${`%${q}%`}\`` at `src/app/api/camping/search/route.ts:73`), so SQL injection through `q` is not supported by this code. `campingType`/`source` are unsafe TypeScript-only enum casts (`:69,72`) and should be allow-listed, but Drizzle still passes them as values; this is an invalid-enum/error-risk on Postgres, not demonstrated SQL/identifier injection.
* Outbound hosts are fixed in code for Overpass, Open Elevation, NPS, RIDB, Tavily, and OpenAI. User input only becomes body/query data. An OSM `wikipedia` tag may become a URL (`src/lib/osm/overpass.ts:113-121`) but this code does not server-fetch that URL; it is passed as research context/returned data. No SSRF to an attacker-controlled host was confirmed.
* The original prototype-pollution probe produced a false positive because the literal word `polluted` was stored inside `waypoints`; it did **not** demonstrate `Object.prototype` pollution. This line of inquiry is not reported as a finding.
* In no-DB fallback mode, `syncCampgrounds` immediately returns (`src/app/api/camping/search/route.ts:13-15`), so hammering zero-result camping searches did **not** invoke the four external sources. With Postgres, the zero-result path does call `syncCampgrounds` (`route.ts:83-84`), which starts NPS, two RIDB calls, and state-parks fetch in parallel (`:24-29`), without a request coalescing lock. The production-db stampede/call count is **unconfirmed / needs follow-up**.

## Artifacts

* `adversarial/api-probe.mjs` — runnable plain-Node probe; it exits nonzero when VULN cases are observed. It predates the append-only point-journal change, so its old point-race output must not be used; the remeasurement artifact below supersedes it.
* `adversarial/api-probe-output.txt` — original run evidence.
* `adversarial/retest-concurrency.mjs` and `adversarial/retest-concurrency-output.json` — current-build remeasurement evidence.
* `adversarial/retest-store.json` — isolated test storage evidence.
