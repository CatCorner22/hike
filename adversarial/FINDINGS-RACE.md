# Concurrency, races, and lifecycle — adversarial findings

## Summary

**4 HIGH, 0 MEDIUM, 0 LOW.** The JSON mutation queue prevents same-process
file clobbering and route-pack saves are atomic, but the product has no
cross-request/cross-tab concurrency model. A retry can duplicate GPS fixes, a
late final fix can be omitted from the completed track, two full-document plan
saves overwrite each other, and an in-progress recording is abandoned by a
reload without recovery UI.

## F-01 Retried GPS point POSTs create duplicate track fixes — HIGH

**Hiker consequence:** If a phone loses the response after a GPS POST or two
tabs flush the same queued point, the completed track silently contains
duplicate fixes and can misstate the route a hiker or rescuer reviews.

**Where:** `src/lib/offline/activity-sync.ts:99-116`,
`src/lib/offline/index.ts:158-173`,
`src/app/api/activities/[id]/points/route.ts:58-79`

**Reproduction:**

    BASE=http://127.0.0.1:3111 node adversarial/probe-race-api.mjs

    POINT_RETRY_DUPLICATION {"postStatuses":[200,200],"matchingPersistedPoints":2}

The probe creates one activity and concurrently sends the exact same point
payload twice. Both responses are 200 and the activity read returns two
matching persisted fixes.

**Why it happens:** A queued point has a local `id`, but `flushActivityPoints`
does not send that id. The API creates a fresh UUID for every accepted point
(`addActivityPoint` at `local.ts:263-268`) and has neither a request id nor a
unique `(activityId, clientPointId)` constraint. `flushPromise` is only an
in-memory singleton in one tab, so it cannot serialize two tabs. An ambiguous
network failure after the server commit takes the normal `saveActivityPoint`
queue path and replays the already-accepted payload.

**Suggested fix:** Assign every recorded point a durable client-generated ID,
include it in direct and queued POSTs, and make it unique per activity in both
storage implementations. Return an idempotent successful response for a
duplicate client ID. Preserve the local ID when remapping an offline activity
to a remote ID.

**Confidence:** High. The live API accepted and persisted the duplicate exact
payload; the retry and cross-tab paths lack an idempotency key.

## F-02 A stop/final-fix race permanently omits the tail of a completed track — HIGH

**Hiker consequence:** A final GPS fix that reaches the server just after
“Stop & save” is excluded from the completed activity’s preferred map line,
leaving the last recorded position behind the hiker’s actual final position.

**Where:** `src/components/activities/activity-recorder.tsx:144-147,221-241`,
`src/app/api/activities/[id]/route.ts:93-123`,
`src/app/activities/[id]/page.tsx:43-50`

**Reproduction:**

    BASE=http://127.0.0.1:3111 node adversarial/probe-race-api.mjs

    STOP_FINAL_FIX_RACE {"finalizeStatus":200,"latePointStatus":200,"responsePointCount":3,"persistedTrackCoordinateCount":2,"detailPagePrefersPersistedTrack":true}

The probe seeds two points, sends the completion PATCH (which computes
`trackGeometry`), then sends a valid final point. The activity returns all
three points but has a two-coordinate `trackGeometry`; the detail page
explicitly uses that stale persisted geometry before falling back to points.

**Why it happens:** Position callbacks launch `saveActivityPoint` with `void`,
so Stop does not await an already-running save. `finishActivity` flushes only
the IndexedDB queue and then PATCHes the activity. The PATCH reads the points
available at that instant and persists a derived `trackGeometry`; a later POST
does not recompute it. The activity detail page prioritizes that stale
`activity.trackGeometry`.

**Suggested fix:** Serialize point append and activity finalization per
activity. On finalization, wait for all accepted/in-flight point saves, then
derive the geometry in the same server-side transaction as the terminal
activity update. Alternatively derive display geometry from points on reads;
do not prefer a stale cached line. Reject (or explicitly handle) point appends
after an activity is ended.

**Confidence:** High. The measured persisted geometry was shorter than the
accepted authoritative points through the real live API.

## F-03 Two plan tabs silently overwrite each other’s full stale snapshots — HIGH

**Hiker consequence:** Editing a plan in two tabs can report success in both
tabs while silently reverting one tab’s route, waypoint, campsite, name, or
note edit; a hiker can then prepare or follow the wrong saved plan.

**Where:** `src/app/plan/[id]/page.tsx:105-117`,
`src/app/api/plans/[id]/route.ts:49-88`,
`src/lib/store/local.ts:187-200`

**Reproduction:**

    BASE=http://127.0.0.1:3111 node adversarial/probe-race-api.mjs

    PLAN_STALE_SNAPSHOT_RACE {"patchStatuses":[200,200],"finalName":"race-plan-original","finalNotes":"changed-in-tab-B","bothIndependentEditsRetained":false}

The probe reproduces the page’s save shape: tab A has a stale full plan and
edits its name; tab B has a stale full plan and edits notes. Both PATCH
requests return 200. The final object has tab B’s notes but its stale old name,
so tab A’s successful name edit is lost.

**Why it happens:** `save()` sends `{ ...plan, ...updates }`, not just the
field changed. Every API PATCH accepts every supplied field and `updatePlan`
blindly spreads them over the current row. `mutationQueue` serializes file
writes but is not conflict detection: it makes the last stale snapshot win.
The same request shape can replace `customGeometry`, waypoints, and campground
IDs, not merely a display name.

**Suggested fix:** Send minimal field patches from the UI and add optimistic
concurrency (revision/ETag or `updatedAt` precondition) for compound plan
changes. On conflict, preserve the local draft and present an explicit
refresh/merge choice; do not report a silent 200 success for a superseded
snapshot.

**Confidence:** High. Two real concurrent PATCHes were both successful and
one independently changed field was demonstrably lost.

## F-04 Reloading an active recording abandons it with no recovery path — HIGH

**Hiker consequence:** If the browser reloads, the app is killed and restored,
or the hiker reopens the tab mid-hike, recording stops without warning while
the UI confidently offers a new “Start recording” button instead of resuming
or closing the open activity.

**Where:** `src/components/activities/activity-recorder.tsx:49-64,154,183-199`,
`src/lib/offline/activity-sync.ts:45-87,208-241`

**Reproduction:**

    BASE=http://127.0.0.1:3111 node adversarial/probe-race-reload.mjs

    RECORDER_RELOAD_LIFECYCLE {"activityCreated":true,"startButtonAfterReload":true,"resumeButtonsAfterReload":0,"persistedActivityEndedAt":null,"browserErrors":[]}

The browser probe starts recording a real activity, reloads the plan page, and
checks the live API. The server activity remains open (`endedAt: null`), but
the new page has only Start and no Resume control or recovery error.

**Why it happens:** Recorder lifecycle state (`status`, activity ID, start
time, pause accounting, last point, and watcher) exists only in component
state/refs. The component cleanup only clears the geolocation watch. Although
`beginActivity` stores a `LocalActivity`, no startup path reads it to restore
the recording UI or ensure a safe terminal state. `pagehide` sends a
best-effort snapshot, but it neither persists recorder lifecycle state nor
marks the activity paused/stopped.

**Suggested fix:** Persist an explicit recording-session state locally before
starting the watch and hydrate it on mount. On recovery, visibly offer Resume
or Stop/reconcile before allowing a new recording. Persist pause start and
accumulated active duration, and make pagehide/background behavior explicit so
the UI never implies recording continues when its watcher has gone away.

**Confidence:** High. A real browser reload produced the stated UI/API split
with no browser errors.

## Held up under attack

- Route-pack writes use one IndexedDB transaction across payload and aliases;
  the existing injected alias-write failure test confirms a partial pack is
  not committed. Same-process concurrent local plan and point writes also
  passed their serialization tests.

      npx vitest run src/lib/offline/route-pack.test.ts src/lib/store/local.test.ts

      Test Files  2 passed (2)
           Tests  14 passed (14)

- I inspected the service worker update configuration
  (`src/sw.ts:122-126`, `skipWaiting: true`, `clientsClaim: true`) but did not
  complete a controlled old-worker/new-worker activation test against the
  shared running server. I therefore do not make an unverified service-worker
  finding.
