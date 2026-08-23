# App Store submission pack

Everything App Store Connect will ask for, answered once, honestly. The
staged path is: sideload (free) → TestFlight (needs the $99/year Apple
Developer Program) → App Store review. TestFlight alone is enough to carry
the app on your own phone with painless updates.

## What only you can do (~30 minutes of dashboard work)

1. **Enroll** at developer.apple.com ($99/year, needs your Apple ID + 2FA).
2. **App Store Connect → Users and Access → Integrations → App Store Connect
   API**: create a Team key with App Manager role. Note the Key ID and
   Issuer ID; download the `.p8` once.
3. **GitHub repo → Settings → Secrets and variables → Actions**: add
   `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_P8` (paste the .p8 file
   contents), `APPLE_TEAM_ID` (from your developer account membership page).
4. **App Store Connect → Apps → New App**: platform iOS, name **Klandagi**
   (if taken, "Klandagi — Trail Safety"), bundle ID
   `com.blakereagan.klandagi`, SKU `klandagi-ios`.
5. Run the **iOS workflow** in GitHub Actions with lane `testflight`.
   The build appears in TestFlight; install it on your phone via the
   TestFlight app. That is the "iTunes app on my phone" milestone.
6. Deploy the backend (docs/deploy.md — Vercel + Neon, ~15 min) and set
   `NEXT_PUBLIC_API_BASE=https://<your-app>.vercel.app` as a repo Actions
   variable so shell builds talk to the live API.

## Listing copy (mirrors /guide's honest-limits language)

**Subtitle** (30 chars): `Offline trail navigation`

**Promotional text**: Plan a route while you have signal. Navigate it when
you have none. Klandagi keeps the map, your position, and every safety
tool on the phone itself.

**Description**:

Klandagi is an offline-first hiking navigator built around one idea: the
moment you need help is the moment you have no bars.

- Prepare a route while connected — map, elevation, weather snapshot, and
  hazard brief all saved to the phone, then verified readable before you
  leave coverage.
- Navigate with a live USNG grid reference you can read to a rescuer,
  off-route alerts, daylight margin, and turnaround warnings.
- Record your track with the screen locked. The breadcrumb you follow home lives
  on the phone and works with no signal; finished tracks upload to Klandagi's own
  server when you are back in range, so losing the phone does not lose the hike.
- A return-time alarm fires on the phone itself, even with the app closed, and
  it is marked time-sensitive so a Focus mode does not hold it until morning —
  if you allow notifications. Decline, and the app says so, offers a way back to
  Settings, and falls back to the in-app overdue warning.
- The SOS screen is honest: a strobe and tone to be seen and heard, plus a
  pre-filled message for your emergency contact. It does not contact 911,
  search and rescue, or transmit anything by itself.
- Field references: first aid checklists, land navigation, signaling —
  readable with no connection.

**What it is not.** Klandagi draws your route and the trails, roads, water and
landmarks near it. It does not download terrain tiles: no contours, no shaded
relief, no imagery. Carry a paper topo. And it follows one phone, not a party —
the party size you enter tells a searcher how many people to look for, but if
the group splits up nothing here can tell anyone.

Klandagi states uncertainty plainly. A stale GPS fix is labeled stale.
Cached weather is labeled cached. A dead reckoning position carries its
error radius. No ads, no advertising identifiers, no analytics SDKs, and nothing
sold or shared. There is no account to sign into — your plans and finished tracks
are stored against an anonymous per-install identity, which is described in full
on the app's privacy page.

IMPORTANT: Klandagi is a planning and navigation aid. It is not a
substitute for a personal locator beacon or satellite messenger, for
navigation training, or for sound judgment. Cell coverage is absent in
much of the backcountry; devices fail; batteries die. Carry a paper map
and tell someone where you are going.

**Keywords** (100 chars):
`hiking,offline,trail,navigation,GPS,USNG,backcountry,safety,SAR,topo,camping,SOS`

**Age rating**: answer the questionnaire against what the app actually contains,
which is not "None" to everything.

A previous version of this file told you to file "None" to every
objectionable-content question and rate the app 4+. That is wrong, and wrong in
the direction that gets an app pulled: an inaccurate rating is a guideline 2.3.6
metadata violation, and it is trivially checkable by anyone who opens the
Medical tab. What is in here:

- **Medical and treatment information.** Tourniquet application and conversion
  timing, chest seals, START triage, hypothermia rewarming, altitude illness.
  It is factual and preventive, and it is unambiguously medical/treatment
  information — answer that question honestly.
- **Realistic violence, mild and infrequent.** `survival-harvest.ts` carries
  hunting ethics ("one clean shot beats wounding and tracking"), snare and
  figure-4 deadfall construction, and game field dressing. Instructional, not
  depicted, but it is there.
- **Unrestricted web access**: No.

Rate it where those answers land you — expect 12+ rather than 4+ — and say so in
the review notes rather than hoping the reviewer misses the tab. A survival app
rated for the content it has is not a worse listing; a survival app caught
under-rating its trauma section is.

**Background location and battery** (guideline 2.5.4): the app declares
`UIBackgroundModes: [location]` for track recording. The recorder states, before
the hiker taps Start, that recording keeps GPS running with the screen off and
uses the battery noticeably faster
(`src/components/activities/activity-recorder.tsx`). Point the reviewer at that
string; it is the notice 2.5.4 asks for.

**Category**: Navigation (secondary: Health & Fitness).

## Privacy Policy URL (required submission field)

`https://<your-deployed-domain>/privacy` — the page lives at `src/app/privacy/page.tsx`
and must be reachable on the public web before you submit; App Store Connect will
not accept the build without it. `/terms` carries the honest-limits and
assumption-of-risk language and is worth linking from the listing's support URL.

## Privacy nutrition labels (App Store Connect answers)

- **Location → Precise Location**: collected, **App Functionality**,
  **linked to the user's identity**, **no tracking**. Precise location is
  uploaded (finished track points) against a stable per-install identifier, and
  Apple treats a stable identifier as identity whether or not a name is attached
  — answering "not linked" here is the kind of thing that gets a build rejected
  on a second look. There is still no tracking: nothing is shared with a data
  broker and nothing is used for advertising.
- **User Content → Other User Content**: collected (plans, recorded
  tracks), App Functionality, **linked**, no tracking — same reasoning.
- Everything else: not collected. **No tracking** anywhere; there is no
  ads/analytics SDK. `PrivacyInfo.xcprivacy` in the repo matches these
  answers and declares the required-reason APIs (UserDefaults CA92.1,
  file timestamps C617.1).

## Review notes (paste into App Review Information)

> Klandagi is an offline navigation and trip-safety tool for hikers, not a
> wrapped website: it bundles its entire UI, works in airplane mode after
> preparing a route, records GPS tracks in the background, schedules local
> return-time notifications, and uses haptics and the camera-readable QR
> handoff for no-signal emergencies.
>
> To exercise offline navigation at a desk: open Explore, choose any
> trail, "Add to plan", then "Prepare offline" on the plan screen. Enable
> airplane mode, reopen the app, and open the route from the Go tab. The
> map, grid reference, and safety tools all function without connectivity.
>
> The SOS screen is a local strobe/tone beacon and explicitly states that
> it does not contact emergency services. The app's guide page states its
> limits (not a PLB substitute). Location permission is requested only
> when the user opens navigation or starts recording.

## Pre-empted rejection risks

- **4.2 minimum functionality ("wrapped site")**: native offline bundle,
  background location recording, scheduled local notifications, haptics,
  share-sheet exports — demonstrated in the review notes walkthrough.
- **1.4 physical harm**: the app never claims rescue capability; the SOS
  screen and guide state limits explicitly; medical content is standard
  first-aid reference with sources.
- **2.3 accurate metadata**: screenshots come from
  `scripts/screenshot-walkthrough.mjs` against the real app.
- **Export compliance**: HTTPS only → `ITSAppUsesNonExemptEncryption=false`
  is already in Info.plist; answer "standard encryption, exempt" once.

## Release checklist (every submission)

1. `npm run build:cap` green in CI (shell-export job).
2. iOS workflow simulator lane green (boots, survives, screenshot).
3. On-device checklist in docs/ios-runbook.md passed on a real iPhone.
4. TestFlight build tested on your own phone for at least one real walk.
5. Screenshots regenerated if UI changed; description still truthful.
