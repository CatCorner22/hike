# iOS build & sideload runbook (Mac path)

The Capacitor iOS shell wraps the same TypeScript core the web app runs — one codebase,
two build outputs. This runbook is the local Mac path: build the static shell, open it
in Xcode, and run it on your own iPhone with a free Apple ID. The CI lane
(`.github/workflows/ios.yml`, once landed) covers simulator smoke tests; TestFlight and
App Store distribution are staged separately and need a paid Apple Developer enrollment.

**Status: forward-looking.** The Capacitor scaffold (W4–W5 in the plan) has not landed
yet; this runbook is written ahead of it so the Mac-side prerequisites can be prepared
in parallel. Steps marked ⏳ depend on scaffold commits.

## One-time Mac setup

1. **Xcode 16+** from the App Store. Launch it once and accept the license
   (`sudo xcodebuild -license accept`).
2. **Command-line tools**: `xcode-select --install`.
3. **CocoaPods**: `sudo gem install cocoapods` (or `brew install cocoapods`).
4. **Node 20+** and a clone of this repository.
5. Plug in your iPhone once, unlock it, and tap **Trust This Computer**.
6. On the phone: Settings → Privacy & Security → **Developer Mode** → on (iOS 16+;
   requires a restart). Without it, Xcode can list the device but not launch on it.

## Environment

Create `.env.local` in the repository root:

```bash
# The deployed API this shell talks to (see docs/deploy.md). The native app is a
# different origin from the API, so this must be an absolute URL.
NEXT_PUBLIC_API_BASE=https://<your-vercel-deployment>.vercel.app
```

The server side must have `ALLOWED_APP_ORIGINS` configured if you add origins beyond
the built-in `capacitor://localhost` / `https://localhost` pair, and CORS + bearer auth
are already live (merged in #53).

## Build and run ⏳

```bash
npm ci
npm run build:cap        # BUILD_TARGET=capacitor static export into out/
npx cap sync ios         # copies out/ into the iOS project, installs Pods
npx cap open ios         # opens ios/App/App.xcworkspace in Xcode
```

In Xcode:

1. Select the **App** target → **Signing & Capabilities**.
2. Team: add your Apple ID (Xcode → Settings → Accounts) and pick the personal team.
3. Xcode generates a free provisioning profile. Free-account limits, stated honestly:
   the app expires after **7 days** (re-run from Xcode to renew), at most **3 apps**
   sideloaded at a time, and no push notifications — none of which this app needs for
   field use. Local notifications (the overdue alarm) work fine.
4. Select your iPhone in the run-destination dropdown and press **Run**.
5. First run only, on the phone: Settings → General → VPN & Device Management →
   trust your developer certificate.

## On-device checklist (gates every release stage)

Run this with the phone in hand — not the simulator — before trusting the build on a
real hike. Nothing advances to TestFlight or App Store staging without every box.

- [ ] **Deep page reload**: open a plan, force-quit, relaunch — lands on the right
      screen, not a 404 shell.
- [ ] **Single GPS prompt**: exactly one native location permission dialog, with the
      usage description text, on first use of navigation.
- [ ] **Screen-locked recording**: start recording a track, lock the phone, walk 5
      minutes — points kept appending (background location indicator visible).
- [ ] **Overdue alarm fires locked**: set a check-in interval, background the app,
      let it lapse — the local notification fires with the phone locked.
- [ ] **SOS audible on mute**: flip the mute switch ON, start the sound & flash
      locator — the tone still plays (AVAudioSession playback category).
- [ ] **`sms:` handoff**: the ICE text button opens Messages with body prefilled.
- [ ] **GPX share sheet**: exporting a track offers the iOS share sheet.
- [ ] **Safe areas**: the tab bar clears the home indicator; the SOS button clears the
      notch in landscape.
- [ ] **Airplane-mode cold navigate**: prepare a route with signal, enable airplane
      mode, force-quit, relaunch, open navigation — map, position, and safety panel
      all work.
- [ ] **50 m walk**: Remaining distance ticks down while walking the route direction.

## Updating the app on your phone

Free sideload: re-run from Xcode (weekly, because of the 7-day expiry). After
enrollment, TestFlight replaces this — builds last 90 days and update over the air.

## Troubleshooting

- **"Untrusted Developer"** on launch → trust the certificate (step 5 above).
- **Pods install fails** → `cd ios/App && pod repo update && pod install`.
- **Blank screen on launch** → the static export is stale: re-run
  `npm run build:cap && npx cap sync ios`.
- **API calls fail** → check `NEXT_PUBLIC_API_BASE` in `.env.local` at build time
  (it is baked into the export), and that the deployment's smoke workflow is green.
- **Location never prompts** → Info.plist must contain both
  `NSLocationWhenInUseUsageDescription` and
  `NSLocationAlwaysAndWhenInUseUsageDescription` (scaffold W5 adds them).
