# Keeping Klandagi trustworthy

This app is carried out of cell range by someone who is relying on it. Everything
here exists so that it rots loudly rather than quietly.

## The gate

CI is the gate, and nothing merges past it: typecheck, lint, the full unit and
adversarial suite, both builds (web and static export), the Capacitor routing
probe, the offline-navigation end-to-end run, and the API, GPS, storage,
concurrency and CSP probes. The iOS lane builds the shell and boots it in a
simulator on every pull request.

The `database` job runs the schema push and the API probe against a real
Postgres 16 service, then checks the rows actually landed. It exists because
every other job runs on the JSON file fallback, so for a long time the entire
Drizzle layer was exercised only by a live deployment — and it was broken there:
the insert-select that saves a GPS point omitted the `id` column, so every
uploaded track point answered 500. A data layer that only production tests is a
data layer nobody tests.

A red suite is never "flaky until proven otherwise". The probes were written
because each of them caught something real.

## Dependencies

`.github/renovate.json` groups patch and minor updates into one pull request a
week. Two categories are deliberately not grouped and never automerged:

- **Capacitor, Next and Serwist majors** are quarterly, labelled
  `needs-device-checklist`. They change how the shell boots, how the export is
  laid out, or how the service worker caches — all three have produced
  field-visible defects in this repo's history. Re-run the on-device checklist in
  `docs/ios-runbook.md` before merging one.
- **`@capacitor-community/background-geolocation`** is pinned exactly. It is the
  only reason track recording and off-route alerting survive a locked screen, and
  it has no upstream test suite to lean on.

`npm audit --omit=dev --audit-level=high` runs on every build as an advisory
step. It does not gate: a transitive dev-only advisory must not stand between a
safety fix and the phone.

## Things that expire

- **The magnetic declination model expires in 2030.** `declination.ts` carries
  `DECLINATION_MODEL_VALID_UNTIL = 2030.0` and the app surfaces a staleness
  warning past it, so a bearing cannot silently rot. Swapping in WMM-2030
  coefficients is the fix; the warning is the seatbelt. (The current table is
  also hand-rounded and printed to more precision than it supports — see the
  backlog in `docs/adversarial-review.md`.)
- **iOS majors, every September.** Re-run the device checklist on the new OS
  before trusting the build on a hike. Background location, notification
  delivery and audio-session behaviour have all changed across releases.
- **TestFlight builds expire after 90 days.** A build you are actually carrying
  needs re-uploading before it does.
- **Public data keys** (NPS, RIDB) rotate. Everything degrades gracefully without
  them, which means a dead key is invisible — check the trail search still
  returns results after a rotation.

## Releases

Tag, let CI run, upload to TestFlight, then phased release. Nothing advances to
TestFlight or the App Store without the on-device checklist, because this machine
cannot test on a phone or on a trail and says so.

## Deliberately absent

No third-party crash-reporting or analytics SDK. A safety app that quietly ships
location-adjacent telemetry to a vendor is a different product from the one
described in `/privacy`, and the privacy manifest would have to say so. Revisit
only with a decision recorded here.
