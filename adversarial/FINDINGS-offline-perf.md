# Adversarial offline/PWA and performance findings

**Scope:** production server at `http://127.0.0.1:3111`; no production files changed.  
**Evidence runs:**

```sh
BASE=http://127.0.0.1:3111 node adversarial/offline-adversarial.mjs
node --expose-gc --max-old-space-size=4096 node_modules/tsx/dist/cli.mjs adversarial/perf.bench.ts
npx tsx adversarial/pending-migration-probe.ts
BASE=http://127.0.0.1:3111 node adversarial/gps-adversarial.mjs
```

Raw proof is retained in `offline-adversarial-run5.log`, `offline-adversarial-run2.log`, `perf.bench-run8.log`, `perf.bench-run6.log`, `perf-results.json`, `pending-migration-probe.log`, `gps-adversarial-run.log`, and `navigate-bundle-size.txt`.

## Finding count

| Severity | Count |
|---|---:|
| Critical | 1 |
| High | 4 |
| Medium | 6 |
| Low | 0 |
| **Total** | **11** |

**Worst offline bug:** a corrupt alias pointer can make `/navigate/<victim>` accept and navigate the payload of an unrelated canonical pack. The harness injected a payload whose `id` was `evil-canonical` and whose aliases were only `unrelated`; the victim URL rendered it as an offline route.

**Worst performance number:** 5,000 disconnected OSM ways took **24,700.31 ms** in `relationToLineString`—a 24.7-second CPU block. The second-worst navigation-path number was **1,502.91 ms** for one 500,000-point `progressAlongTrail` call, which runs on every trusted GPS update.

---

## Offline/PWA findings

### OFF-01 — HIGH — Route-pack alias pointer is trusted without proving ownership

**Reproduction.** Run `offline-adversarial.mjs`. It directly writes an `aliases` record mapping the requested `plan-<victim>` id to `evil-canonical`, then stores a valid-looking `evil-canonical` payload that does **not** list the victim id in `aliases`. Reloading offline on the victim URL renders the attacker/other route. The same run showed two claims for one alias silently select the final pointer.

**Observed.** `alias/pointer-payload-mismatch/rejected` fails with **“mismatched canonical payload accepted.”** The route screen did not white-screen; it rendered the mismatched payload. That is worse than a safe failure for navigation: a plausible but wrong route is displayed.

**Expected.** A requested alias must be rejected unless the retrieved payload’s canonical id and aliases prove that it owns that alias. Conflicting alias records must fail closed, not choose a last write.

**Root cause.** `findRoutePack` returns the pack targeted by any alias pointer without checking the requested id against `pack.id` or `pack.aliases` (`src/lib/offline/route-pack.ts:222-225`). `routePackStatus` validates only geometry and the version (`src/lib/offline/route-pack.ts:171-175`).

**Recommended fix.** Validate the pointer/payload invariant in the same read transaction: the requested id must equal the canonical id or appear in a de-duplicated pack-owned alias set. Treat an orphan/mismatch/duplicate collision as `invalid`, remove or quarantine it, and display “route pack corrupted—reprepare online.” Consider storing an immutable alias manifest or a digest with the canonical payload.

### OFF-02 — HIGH — Navigation service worker serves arbitrary poisoned HTML and produces a blank/foreign page

**Reproduction.** The harness opens the app under the active service worker, inserts `POISONED-SHELL` as the response for the exact `/navigate/...` URL in cache `hike-navigate-shell`, turns the context offline, and navigates to that URL.

**Observed.** `sw/cache-poisoning-degrades-safely` fails; body text is exactly **`POISONED-SHELL`**. The service worker served the response rather than an app shell, fallback, or explicit error.

**Expected.** A cached navigation shell must be identified as an app document for the current application build, and invalid cache entries must be rejected/fall back safely. A storage/cache corruption must not replace the navigator UI with arbitrary cached HTML.

**Root cause.** The handler opens a fixed cache, performs `cache.match(... ignoreVary: true)`, and returns the response unconditionally (`src/sw.ts:25-31`). The cache name is not build-versioned and there is no content type, response marker, URL/build, or document-shape check.

**Recommended fix.** Version the shell cache with the build identity and remove prior shell caches on activation. Store only app-owned navigations with a response marker, validate `Content-Type` and a build/document marker before serving, and treat an invalid cached response as a miss that proceeds to the fallback. Keep `ignoreVary` only if its implications are explicitly constrained by this validation.

### OFF-03 — MEDIUM — Corrupt but syntactically valid pack metadata is accepted with no integrity limits

**Reproduction.** `offline-adversarial.mjs` writes a route pack with: unsorted/negative/duplicate elevation distances and then a **50 MiB** GPX string. Both load into the offline navigator. It also shows a 3D GeoJSON line is accepted (3D is valid GeoJSON, so this subcase is informational rather than a defect).

**Observed.** `corrupt/bad-elevation/rejected` and `corrupt/50mb-gpx/rejected` fail as **“pack accepted/rendered.”** No white-screen occurred, but unbounded persisted payloads and malformed derived data are trusted. The only route-pack validation is geometry/version.

**Expected.** Offline pack persistence must bound payload size and validate derived metadata before it is used by safety displays. A corrupt pack should report an explicit reprepare error rather than look ready.

**Root cause.** `routePackStatus` does not validate `gpx`, `cachedAt`, `bbox`, `lengthMeters`, or elevation profile ordering/ranges (`src/lib/offline/route-pack.ts:171-175`). `buildRoutePack` creates and retains a full GPX duplicate in every route pack (`src/lib/offline/route-pack.ts:157-168`).

**Recommended fix.** Add a strict route-pack validator: finite bbox/length/cached time, maximum coordinate/GPX/total serialized byte budgets, monotonic non-negative elevation distances, finite elevations, and a pack schema/validation error state. Do not store GPX unless export is requested; otherwise cap or regenerate it from validated geometry.

### OFF-04 — MEDIUM — Synchronous alias-write failure commits an orphan route payload

**Reproduction.** `offline-adversarial-run5.log` deletes the existing pack, monkey-patches the `aliases` object-store `put` to synchronously throw `DOMException("QuotaExceededError")` after `routePacks.put` has completed, and clicks Prepare Offline.

**Observed.** The UI correctly displays **“synthetic alias quota failure”**, but the postcondition is `state={"pack":true,"alias":false}`. Thus a payload was committed without its alias. `findRoutePack` can still discover that orphan for the canonical id through its fallback path, so a later navigation can render a route that the Prepare Offline UI reported as failed.

**Expected.** Payload and all aliases are atomic under both request-level and synchronous/adapter failures; failure must neither claim nor leave a recoverable route as saved.

**Root cause.** Although both stores are opened in one transaction (`src/lib/offline/route-pack.ts:181-183`), an exception while composing the later alias operation is not caught with `tx.abort()`. The earlier `packStore.put` was already queued at `src/lib/offline/route-pack.ts:214`; execution exits before `tx.done` at line 219, allowing that pending transaction to commit in the injected synchronous-failure case.

**Recommended fix.** Wrap all writes after transaction creation in `try/catch`; explicitly abort the transaction before rethrowing if a synchronous exception occurs. Add a regression with both a synchronous throwing adapter and an asynchronous `request.onerror`/real quota failure, asserting no payload or alias remains unless all aliases committed.

---

## Performance findings

### PERFORMANCE TABLE — real measurements

Environment for the full run: Node `v20.20.1`, Linux, 2 CPUs, `--expose-gc --max-old-space-size=4096`; canvas timing is headless Chromium at 390×760. These are direct timings, not phone estimates. “RSS” is process resident memory observed immediately after the listed operation.

| Workload | 1k | 10k | 100k | 500k | Why it matters |
|---|---:|---:|---:|---:|---|
| `trailLengthMeters` | 2.29 ms | 3.90 ms | 17.52 ms | 101.56 ms | linear traversal |
| `progressAlongTrail` | 20.68 ms | 57.61 ms | 477.24 ms | **1,502.91 ms** | invoked per trusted GPS update |
| `bboxFromGeometry` | 0.91 ms | 4.17 ms | 12.42 ms | 144.10 ms | route preparation/render state |
| `gpxFromLineString` | 0.89 ms | 4.89 ms | 52.02 ms | 498.95 ms; 33,954,286 B GPX | duplicate large string |
| `parseGpx` round-trip | 1.44 ms | 9.50 ms | 105.57 ms | 366.24 ms | import/export path |
| `buildRoutePack` | 1.59 ms | 8.16 ms | 126.23 ms | 769.70 ms | prepare-offline UI block |
| Safety-map canvas line draw | 3.70 ms | 4.30 ms | 24.60 ms | **81.70 ms** | 16.7 ms frame budget already exceeded at 100k |

Additional measured hostile paths:

| Workload | Result |
|---|---:|
| `relationToLineString`, 5k ordered contiguous ways | 49.77 ms |
| `relationToLineString`, 5k disconnected ways | **24,700.31 ms** |
| `fetchElevationProfile`, 500k coordinates, mocked 51-result response | **1,819.54 ms**; only 3,204 B POST body |
| one `addActivityPoint` with 50k existing points | **727.46 ms**; JSON file grew from 9,733,402 B to 9,733,615 B |
| highest observed RSS in the 500k path | **593.92 MiB** after `buildRoutePack` in proof run 6; run 8 separately observed 421.00 MiB after parse and 430.00 MiB after the 50k-store measurement |
| `/navigate/[planId]` client entry graph | 445,168 B raw / 148,744 B gzip; page chunk alone 216,434 B raw / 66,983 B gzip |

### PERF-01 — CRITICAL — Disconnected OSM relation stitching is quadratic and blocks for 24.7 seconds at 5k ways

**Reproduction.** `perf.bench.ts` creates 5,000 otherwise valid ways with endpoints that do not join. `relationToLineString` took **24,700.31 ms** and returned a 5,000-line `MultiLineString`; the same count in ordered contiguous form took 49.77 ms.

**Observed vs expected.** Every disconnected chain scans the remaining list and tests every candidate endpoint before moving on. A relation with many disconnected/fragmented members turns a route fetch into a 24.7-second block. Large real OSM relations can contain thousands of members; behavior must remain near-linear/`n log n` even for fragmented inputs.

**Root cause.** Greedy `stitchRelationWays` repeatedly loops over `remaining` (`src/lib/osm/overpass.ts:171-206`), and each non-match computes up to four endpoint-distance comparisons (`src/lib/osm/overpass.ts:179-194`).

**Recommended fix.** Index ways by quantized endpoint (with a tolerance-aware neighbor lookup) and remove/pick candidates from that map, rather than rescanning all unjoined ways. Preserve components explicitly; add 5k disconnected and shuffled relations as performance regressions.

### PERF-02 — HIGH — GPS progress calculation freezes for 1.50 seconds on a 500k-point route

**Reproduction.** `perf.bench.ts` runs one `progressAlongTrail` call against a valid 500,000-coordinate LineString. Measured **1,502.91 ms**. At 100k points it already measured 477.24 ms.

**Observed vs expected.** The navigation page calls the function whenever a trusted `navFix` changes. One call takes longer than a one-second GPS cadence, so the calculation cannot keep up before considering rendering or safety UI work.

**Root cause.** The effect calls `progressAlongTrail` on each fix (`src/app/navigate/[planId]/page.tsx:272-283`). That function recomputes full trail length (`src/lib/geo/navigation.ts:82-91`) and constructs/snaps a Turf line over the full coordinate set (`src/lib/geo/navigation.ts:114-123`, `progressOnSegment` at `45-79`).

**Recommended fix.** Precompute cumulative segment lengths once per accepted pack, simplify/index geometry for navigation (grid/R-tree/segment buckets), then inspect only nearby segments on each fix. Move large preprocessing off the interaction path and impose a coordinate cap/LOD representation for offline navigation.

### PERF-03 — HIGH — A 500k-coordinate offline pack reaches a 34 MB duplicated GPX string and 593.92 MiB observed RSS

**Reproduction.** `perf.bench.ts` creates and packs 500,000 coordinates. The GPX serialization is **33,954,286 bytes** and takes 498.95 ms; full pack construction takes 769.70 ms. A repeated proof run observed **593.92 MiB RSS** immediately after build; the latest run still saw 421.00 MiB after GPX parse.

**Observed vs expected.** One route creates geometry, a giant XML duplicate, parsed/copy intermediates, bbox, and length work on the main path. The measured working set is far beyond a practical navigation safety margin and can cause eviction or termination under memory pressure.

**Root cause.** `gpxFromLineString` maps all points then joins all strings into one monolithic GPX (`src/lib/geo/index.ts:119-136`); `buildRoutePack` eagerly calls it as part of every offline save (`src/lib/offline/route-pack.ts:157-168`).

**Recommended fix.** Cap/simplify coordinate counts before packing; make GPX export lazy and streaming/Blob-based; do not retain geometry and a full XML duplicate in the route pack. Track serialized byte budget before IndexedDB write and fail with an actionable “route too detailed” state.

### PERF-04 — MEDIUM — Elevation sampling spends 1.82 seconds repeatedly walking 500k points despite posting only 51 samples

**Reproduction.** With `fetch` mocked to return immediately, `fetchElevationProfile` on 500k points took **1,819.54 ms**. The outbound JSON was only **3,204 bytes**, proving the delay is local geometry/cache work, not transfer.

**Observed vs expected.** The code serializes the complete geometry to make the cache key and calls Turf `along` 51 times against the full line. A small remote request therefore creates a multi-second prepare-offline CPU pause.

**Root cause.** Full-geometry `JSON.stringify` is used as `cacheKey` (`src/lib/geo/index.ts:62-69`), then `turf.length` and 51 `turf.along` operations operate on the full line (`src/lib/geo/index.ts:71-79`).

**Recommended fix.** Use an explicit pack/hash/version key rather than serializing geometry; build one cumulative-length sampler and binary-search it for all sample targets, or sample a pre-simplified line. Run this precomputation in a worker and surface progress/cancelation.

### PERF-05 — MEDIUM — Local JSON activity store rewrites the entire file for each point (727 ms at 50k)

**Reproduction.** The benchmark pre-seeds actual store JSON with 50,000 points (9,733,402 B), calls actual `addActivityPoint`, and measures **727.46 ms** for the one addition. At 0/1k/10k points the same run measured 0.80/3.94/25.91 ms, respectively.

**Observed vs expected.** Per-point latency grows with file size because every point performs full file read, JSON parse, full stringify, and complete rewrite. Continuous recording therefore accumulates quadratic total work.

**Root cause.** `addActivityPoint` reads the whole store, appends, then calls `writeStore` (`src/lib/store/local.ts:176-181`); `readStore` parses the entire file (`src/lib/store/local.ts:47-64`) and `writeStore` rewrites it (`src/lib/store/local.ts:67-71`).

**Recommended fix.** Move points to a real append/indexed database table or batch points in a queue with periodic atomic writes. At minimum serialize writes and append a line-oriented journal rather than rewriting every historical point.

### PERF-06 — MEDIUM — Canvas map misses a frame at 100k and consumes 81.7 ms at 500k points

**Reproduction.** Chromium executed the exact `SafetyNavMap` coordinate/projection/path loop. It measured 24.60 ms for 100k and **81.70 ms** for 500k points.

**Observed vs expected.** At 100k it exceeds a 60 Hz 16.7 ms frame budget; at 500k it occupies roughly five such frame intervals in the measured browser. GPS/map updates will visibly jank even before other map work.

**Root cause.** Every redraw projects and feeds every coordinate to canvas (`src/components/map/safety-nav-map.tsx:199-208`), and the effect redraws whenever the fix-dependent props change (`src/components/map/safety-nav-map.tsx:109-356`).

**Recommended fix.** Use zoom/follow-window-aware simplification, preproject/cache static route paths, and draw only segments visible in the viewport. Keep a coarse path for follow mode and delay full-detail rendering until interaction is idle.

### PERF-07 — MEDIUM — Capability tabs are not lazy; all safety capability code is in the initial navigation page graph

**Reproduction.** The production client-reference manifest names the `/navigate/[planId]/page` graph with `async:false`; source has no `dynamic`, `React.lazy`, or dynamic `import` in the safety panel/capability tabs. `navigate-bundle-size.txt` totals the exact nine entry-graph chunks at **445,168 B raw / 148,744 B gzip**; the navigation page chunk is **216,434 B raw / 66,983 B gzip** and contains the `Safety capabilities` marker.

**Observed vs expected.** `CapabilityTabs` conditionally renders inactive content but statically imports all eight panel modules. Hiding a tab does not defer code download/parse.

**Root cause.** Static imports of all sections at `src/components/safety/capability-tabs.tsx:3-12`; the navigation page statically imports `SafetyPanel` at `src/app/navigate/[planId]/page.tsx:9-11`.

**Recommended fix.** Use `next/dynamic` per tab or per capability group, with a small offline-safe loading/error state. Retain critical SOS/basic navigation in the initial graph; defer optional medical/hazard/planning calculators until the panel/tab opens. Add a build-manifest budget assertion.

---

## SOLID — controls that held under test

- **No browser/page white-screen from invalid geometry/version cases.** `null`, object, string, NaN coordinate, single-coordinate, stale v1, and future v999 route records did not produce a blank renderer in the harness. The route screen recovered via its network/cache path rather than crashing. This is a resilience control, although the malformed-metadata acceptance in OFF-03 remains.
- **Pending point v1 boolean migration works in the actual module.** `pending-migration-probe.ts` created a real v1 `synced:false` record, invoked `getOfflineDb()` from `src/lib/offline/index.ts`, and observed `{ version: 2, synced: 0, unsyncedIndexCount: 1 }` with no throw.
- **Quota/error reporting is honest in the tested UI injection.** The Prepare Offline UI displayed the synthetic write failure and did not show the normal success message. The separate partial-write finding above covers the important cleanup gap.
- **Two simultaneous tabs remained usable.** One tab prepared a pack while another navigated the same route; the navigation tab rendered offline navigation rather than blanking.
- **Cache deletion has mixed results and is not claimed as a control.** One run recovered an already-open pack; a later cold-style navigation produced no fallback body. This scenario is retained in the harness/logs but is not counted as a confirmed root-cause finding because deleting every service-worker cache also deliberately removes the precached fallback itself.
- **Clock skew did not give the tested dangerous reassurance.** A future overdue time produced no `Return in 0 min`; a 1970 deadline rendered `OVERDUE by 29787315 min`. Existing tourniquet logic returns no elapsed indication if the clock moves backward rather than a false zero.
- **GPS adversarial signals were surfaced.** The live-page probe recorded a teleport/off-route alert, emitted the GPS jump warning after a jump, recorded frozen fixes without throwing, and showed an off-trail warning at Null Island. Antimeridian on-route positioning did not falsely show an off-trail banner in that live-page control.

## Deliverables

- `adversarial/offline-adversarial.mjs` — production Playwright offline/PWA harness.
- `adversarial/perf.bench.ts` — hostile-scale benchmark that saves `perf-results.json`.
- `adversarial/pending-migration-probe.ts` — direct app-module legacy pending-point migration probe.
- `adversarial/gps-adversarial.mjs` — live-page GPS adversarial probe.
- This report and the raw execution logs listed above.
