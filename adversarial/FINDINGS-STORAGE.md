# Storage — adversarial findings

## Summary

**1 CRITICAL, 2 HIGH, 1 MEDIUM.** The pack payload validator and atomic pack/alias transaction are strong, and persistent-storage refusal is visibly warned. The main unsafe gap is freshness: after IndexedDB contents disappear in an open plan page, the UI still positively says the map is on the device. The JSON fallback also accepts a valid but malformed envelope and overwrites recoverable plans.

## F-01 Evicted route pack continues to be claimed as saved — CRITICAL

**Hiker consequence:** A hiker can leave the trailhead after the app says “Route geometry and safety data are saved on this device,” even though the stored route pack has already disappeared and offline navigation will fail later.

**Where:** `src/components/offline/prepare-offline.tsx:34-40`; `src/components/offline/offline-readiness.tsx:68-93,110-120`

**Reproduction:**

    BASE=http://127.0.0.1:3111 node adversarial/probe-storage-browser.mjs
    PASS eviction-live-ui-claim — initial=true; stale-claim=true; button="Update offline pack"

The probe first seeds a schema-valid `plan-<id>` route pack, lets the real plan UI render its “Route pack saved” readiness row, then clears `routePacks` and `aliases` in that same isolated Chromium profile. It uses the real production app at `127.0.0.1:3111`; no application source is mocked.

**Why it happens:** `PrepareOffline` checks `hasRoutePack(packId)` only on mount and retains `ready=true`. `OfflineReadiness` refreshes only on mount and the app’s own `hike:offline-readiness-changed` event. Browser eviction/corruption produces neither event, so both the green readiness row and “Update offline pack” button remain stale.

**Suggested fix:** Revalidate the pack on `visibilitychange`/focus/pageshow and before displaying any affirmative saved state; also revalidate after storage estimates or storage errors. Treat any failed IDB read as **not saved** and render a high-visibility “route pack missing—re-download before relying on this device” warning. Do not assume the browser offers a reliable eviction event.

**Confidence:** High. The probe observed both the original affirmative readiness state and the same affirmative state after the only two pack stores were emptied.

## F-02 Valid but wrong-shaped JSON fallback data is silently overwritten — HIGH

**Hiker consequence:** If a recoverable fallback file is valid JSON but wrapped in an unexpected shape, the next plan write silently discards its saved plan rather than refusing and preserving data for recovery.

**Where:** `src/lib/store/local.ts:84-91,126-133`

**Reproduction:**

    node adversarial/probe-storage-local.mjs
    PASS valid-wrong-shape-is-silently-reinitialized — status=0; WRITE_OK; ; old-plan-lost=true

The probe writes valid JSON containing a complete “Good map” plan under an unexpected `data` envelope, calls the real `createPlan`, and reads the resulting file. The newly written root store no longer contains `Good map`.

**Why it happens:** `readStore()` casts parsed JSON to `LocalStore` without checking its shape. Missing root keys become empty arrays through `parsed.plans ?? []`, `parsed.activities ?? []`, and `parsed.points ?? []`; `mutateStore()` then atomically replaces the file with that empty interpretation plus the new mutation.

**Suggested fix:** Validate that the parsed root is a non-null object and that `plans`, `activities`, and `points` are arrays with minimally valid row shapes before returning it. On any shape mismatch, throw a named corruption error and leave the original file untouched; preserve a separate explicit migration path for known older schemas.

**Confidence:** High. The file transition and loss of the pre-existing plan were measured through the production fallback-store module.

## F-03 Offline point queue has no capacity reserve and quota failure is not surfaced to the recorder — HIGH

**Hiker consequence:** During a long offline recording, queued GPS points can grow until they consume storage needed by route packs; once a queue write hits storage exhaustion, the current point is lost with no recorder warning.

**Where:** `src/lib/offline/index.ts:64-73`; `src/lib/offline/activity-sync.ts:89-116`; `src/components/activities/activity-recorder.tsx:144-147`

**Reproduction:**

    node adversarial/probe-storage-local.mjs
    PASS point-queue-10000-no-app-limit — status=0; PENDING 10000;
    PASS queue-quota-rejects-to-caller — status=0; REJECTED QuotaExceededError probe full;

The first test queues 10,000 points through the real `queueActivityPoint()` API and reads the real `by-synced` count: there is no application ceiling. The second makes the storage `put` throw `QuotaExceededError`; `queueActivityPoint()` rejects. `ActivityRecorder` invokes `saveActivityPoint(...).then(...)` with no rejection handler, so that rejection never sets its `offline` state or a user-facing error.

**Why it happens:** Every point is accepted by `queueActivityPoint()` with no count/byte cap or reserved route-pack space. A failed `db.put()` propagates through `saveActivityPoint()`, while the recorder observes only successful boolean resolutions.

**Suggested fix:** Set a byte/count budget that preserves a route-pack reserve, show an increasingly prominent queued-points/storage warning before the limit, and handle queue-write rejection in the recorder with an explicit “point not saved—storage full” message. Avoid silently dropping points; offer a clear stop/export/retry path.

**Confidence:** High. Both unlimited growth through 10,000 records and the real propagated quota exception were executed.

## F-04 Incompatible or incomplete IndexedDB schema is refused with raw browser jargon — MEDIUM

**Hiker consequence:** When an app downgrade or interrupted schema creates an incompatible route-pack DB, the hiker gets an opaque browser implementation error rather than clear recovery instructions before losing signal.

**Where:** `src/lib/offline/route-pack.ts:232-266,360-385`; `src/app/navigate/[planId]/page.tsx:297-301`

**Reproduction:**

    BASE=http://127.0.0.1:3111 node adversarial/probe-storage-browser.mjs
    Back Cannot navigate offline The requested version (4) is less than the existing version (99). Retry First time here? How offline routes work
    Back Cannot navigate offline Failed to execute 'transaction' on 'IDBDatabase': One of the specified object stores was not found. Retry First time here? How offline routes work

The probe creates a fresh `hike-nav-packs` database at version 99, then separately creates a version-4 DB lacking `aliases`/`lastFix`, and opens the real navigate page offline.

**Why it happens:** `getDb()` caches the rejected `openDB()` promise or lets the object-store transaction throw. The navigate page safely catches the error but displays `error.message` unchanged.

**Suggested fix:** Classify `VersionError`, `NotFoundError`, and database open/transaction failures at the storage boundary. Display a safety-oriented message such as “Offline route storage is incompatible or damaged; do not rely on this route. Re-download it after updating the app while online.” Retain the raw error only for diagnostics.

**Confidence:** High that the error is user-visible and not a false readiness claim; medium on the exact desired recovery UX because the safe action depends on whether the user can update or clear a damaged DB.

## Held up under attack

- A refused `navigator.storage.persist()` is visibly rendered in both the post-save message and the Offline readiness card:

      BASE=http://127.0.0.1:3111 node adversarial/probe-storage-browser.mjs
      PASS persist-refused-visible — message=true; readiness-row=true

- Truncated geometry, non-monotonic distance indexes, and epoch `cachedAt` values were refused by the real offline navigate screen rather than rendered:

      PASS corrupt-truncated-geometry-refused — "Back Cannot navigate offline Route geometry is invalid. Retry First time here? How offline routes work"
      PASS corrupt-nonmonotonic-distance-refused — "Back Cannot navigate offline Saved route distance index is invalid. Retry First time here? How offline routes work"
      PASS corrupt-epoch-cached-at-refused — "Back Cannot navigate offline Saved route timestamp is invalid or the device clock is incorrect. Retry First time here? How offline routes work"

- An alias that points to no payload did not produce a false pack: `PASS orphan-alias-refused — "Back Cannot navigate offline No offline route pack and no network. Open the trail on Wi‑Fi and tap Prepare offline first. Retry First time here? How offline routes work"`.

- The fallback store preserved a syntactically truncated file, kept the last good file when a temp file represented a crash before rename, and failed without overwriting when its directory was read-only:

      PASS truncated-json-preserved — status=0; REJECTED SyntaxError; ; bytes=11
      PASS temp-file-crash-keeps-good-store — status=0; Good map;
      PASS read-only-directory-preserves-good-store — status=0; REJECTED EACCES; ; unchanged=true

## Unverified / limitations

- `Storage.overrideQuotaForOrigin` at a one-byte quota caused the browser preparation attempt not to resolve within the probe’s 10-second observation window, while `navigator.storage.estimate()` still reported approximately 2 GB. I did not treat that as an app finding because the CDP quota behavior in this environment was inconclusive. The queue quota boundary above was proven with a real propagated `QuotaExceededError`.
- Duplicate aliases were not reported: route-pack alias integrity is already listed as fixed in the swarm brief.
