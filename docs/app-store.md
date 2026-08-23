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
- Record your track with the screen locked; breadcrumbs stay on the phone.
- A return-time alarm fires on the phone itself, even with the app closed.
- The SOS screen is honest: a strobe and tone to be seen and heard, plus a
  pre-filled message for your emergency contact. It does not contact 911,
  search and rescue, or transmit anything by itself.
- Field references: first aid checklists, land navigation, signaling —
  readable with no connection.

Klandagi states uncertainty plainly. A stale GPS fix is labeled stale.
Cached weather is labeled cached. A dead reckoning position carries its
error radius. No ads, no accounts, no tracking.

IMPORTANT: Klandagi is a planning and navigation aid. It is not a
substitute for a personal locator beacon or satellite messenger, for
navigation training, or for sound judgment. Cell coverage is absent in
much of the backcountry; devices fail; batteries die. Carry a paper map
and tell someone where you are going.

**Keywords** (100 chars):
`hiking,offline,trail,navigation,GPS,USNG,backcountry,safety,SAR,topo,camping,SOS`

**Age rating**: 4+ (the safety/medical reference content is factual and
preventive; answer "None" to all objectionable-content questions,
"Unrestricted Web Access: No").

**Category**: Navigation (secondary: Health & Fitness).

## Privacy nutrition labels (App Store Connect answers)

- **Location → Precise Location**: collected, **App Functionality**,
  **not linked to identity**, **no tracking**. (Position renders on-device;
  it leaves the phone only in messages the user sends and in
  plans/activities synced to the user's own anonymous account.)
- **User Content → Other User Content**: collected (plans, recorded
  tracks), App Functionality, not linked, no tracking.
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
