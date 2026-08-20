# Attack duress usability — adversarial findings

## Summary

**2 CRITICAL, 2 HIGH, 3 MEDIUM.** The navigate screen uses valid offline data and its main visual off-trail banner is readable in day mode, but it is not safe enough for a cold, exhausted, frightened hiker at night. The two highest concerns are that a real 250 m off-route alert is completely silent to assistive technology, and the red/NVG modes render the USNG rescue grid below WCAG contrast while the supposed red mode retains a 414 × 202 px bright-white control deck.

Evidence artifacts:

- Reproducible Playwright probe: `adversarial/probe-duress.mjs`
- Raw measurements: `adversarial/scratch-duress-results.json`
- Day alert: `/home/user/workspace/duress-day-offtrail-414x896.png`
- Safety sheet: `/home/user/workspace/duress-safety-sheet-414x896.png`
- Red mode: `/home/user/workspace/duress-red-offtrail-414x896.png`
- NVG mode: `/home/user/workspace/duress-nvg-offtrail-414x896.png`
- 200% OS text scale, 320 px: `/home/user/workspace/duress-textscale200-320x640.png`
- 414 × 400 px short/keyboard-like viewport: `/home/user/workspace/duress-short-414x400.png`
- Forced colors + reduced motion: `/home/user/workspace/duress-forcedcolors-reducedmotion-414x896.png`

All measurements below exercised the actual route-pack path with `packFixture()` and cleared the real readiness gate with `clearReadinessGate()`. GPS was placed 250 m from the fixture route with 5 m accuracy, producing the app's real `OFF TRAIL` state.

## F-01 Critical off-trail warning is not announced — CRITICAL

**Hiker consequence:** A screen-reader user or hiker whose eyes are on footing gets no announced warning that they are 250 m off route, so the alerting safety function is silently absent.

**Where:** `src/app/navigate/[planId]/page.tsx:987-1008` (HUD banner container and its ordinary `<div>`), triggered by the off-trail branch at `:629-642`.

**Reproduction:**

    $ node adversarial/probe-duress.mjs
    {
      "day": {
        "critical": [{
          "text": "OFF TRAIL — 250 m from route. Walk 159° true / 146° magnetic (S) back.",
          "role": null,
          "live": null
        }],
        "live": []
      }
    }

The runtime DOM had **zero** visible `[role=alert]`, `[role=status]`, `[role=alertdialog]`, or `[aria-live]` nodes while that banner was visible. This is not a probe mismatch: the rendered critical banner is a plain `div`, and its parent is also a plain `div`.

**Why it happens:** The HUD map contains only visual styling (`bg-destructive/90 text-white`) and does not create a live region or alert role.

**Suggested fix:** Make each newly introduced critical HUD warning an atomic live announcement, for example a dedicated `role="alert" aria-atomic="true"` region for the highest-priority critical condition. Avoid putting rapidly ticking status text in that live region; only announce material safety-state changes so it does not become noisy.

**Confidence:** High. The alert was visibly reproduced, measured in the accessibility DOM, and the markup path has no announcement semantics.

## F-02 Rescue grid fails contrast in both night modes — CRITICAL

**Hiker consequence:** In the exact state where a hiker may need to read the USNG coordinate aloud for rescue, the 10 px grid reference is low-contrast in both night modes and can be misread or missed.

**Where:** `src/app/navigate/[planId]/page.tsx:948-980`; the grid itself is `:969-977`, while the two night branches at `:828-830` change only the root background.

**Reproduction:**

    $ node adversarial/probe-duress.mjs
    red contrast fails: 8
    nvg contrast fails: 8

    Red mode (font 10 px, normal-text threshold 4.5:1):
    3.82: "11S KB 7672 8423" (USNG) over rgb(231, 230, 230)
    3.82: "· 1940Z 20 AUG 2026" over rgb(231, 230, 230)
    3.82: "Grid → mag: subtract 15.0° ..." over rgb(231, 230, 230)

    NVG mode:
    3.85: "11S KB 7672 8423" (USNG) over rgb(229, 232, 231)
    3.85: "· 1940Z 20 AUG 2026" over rgb(229, 232, 231)
    3.85: "Grid → mag: subtract 15.0° ..." over rgb(229, 232, 231)

The screenshots above show the coordinate card in each mode. These are `getComputedStyle` foregrounds composited against the effective ancestor background, compared using WCAG relative luminance. The USNG string was not truncated in this fixture; it fails on contrast.

**Why it happens:** The grid inherits `text-muted-foreground` at 10 px. Night mode changes the outer background but retains the same pale card and muted gray copy.

**Suggested fix:** Treat the USNG/MGRS coordinate and fix-age/source as safety-critical night-mode content: give them a dedicated tested red/NVG token pair with at least 4.5:1 at their actual background, and increase their type size enough to read under duress. Preserve an explicit source/stale qualifier with the coordinate.

**Confidence:** High. Both modes, the actual coordinate string, foreground/background colors, font size, and ratios were measured.

## F-03 “Red” mode emits a bright white/black control deck — HIGH

**Hiker consequence:** Selecting Red to protect night vision still puts a 414 × 202 px bright-white panel with near-black type directly in the hiker's view, destroying dark adaptation and making later terrain reading harder.

**Where:** `src/app/navigate/[planId]/page.tsx:828-830` and `:1013-1063`.

**Reproduction:**

    $ node adversarial/scratch-duress-detail.mjs
    "red": {
      "root":   { "bg": "rgb(20, 3, 3)", "rect": { "w": 414, "h": 896 } },
      "bottom": {
        "bg": "oklch(1 0 0)",
        "color": "oklch(0.145 0 0)",
        "rect": { "x": 0, "y": 694, "w": 414, "h": 202 }
      }
    }

`duress-red-offtrail-414x896.png` confirms the white deck visually. NVG similarly leaves the standard white deck (`duress-nvg-offtrail-414x896.png`).

**Why it happens:** Red/NVG set only the root background (`[&]:bg[...]`); the fixed lower controls retain `bg-card`, which resolves to white in the light theme. The controls retain ordinary foreground colors as well.

**Suggested fix:** Define a complete red-light palette for every surface, border, icon, and text token used by navigate—not only the map/root. Do not use white, blue, green, or gray-emitting UI in Red. Validate the rendered page with a pixel/color audit, not class-name inspection. Keep a deliberately separate high-visibility emergency beacon mode if white flashing is a required rescue signal.

**Confidence:** High. The measured computed root and bottom-surface colors match the screenshot.

## F-04 Emergency path is tiny, top-stranded, and initially below the sheet fold — HIGH

**Hiker consequence:** A one-handed hiker has to hit a 28 × 28 px icon at y=12 to reach SOS, then scroll before the 32 px Beacon action is fully visible; a cold or shaking hand can miss or fail to reach it when seconds matter.

**Where:** `src/components/offline/safety-panel.tsx:575-582` and `:718-739`; generic size definitions `src/components/ui/button.tsx:23-33`.

**Reproduction:**

    $ node adversarial/probe-duress.mjs
    day controls 7, under44 7, centers under 8 px: 0

    Safety and SOS: x=132.9 y=12 w=28 h=28; center=(146.9,26)
    $ node adversarial/scratch-duress-detail.mjs
    Beacon: x=211 y=878.2 w=187 h=32 bottom=910.2 (414×896 viewport)
    Copy emergency info: x=16 y=838.2 w=187 h=32

For a 414 × 896 device, the bottom two-thirds thumb zone starts at y=298.7. The SOS entry target center is y=26 (272.7 px above that zone), and the Beacon action extends 14.2 px below the initial viewport. Both heights are below the 44 px target minimum. The day-screen target inventory also found `GPS` 45.5 × 28, `Day` 61.3 × 28, `North up` 85.9 × 28, and `Refresh route` 54.2 × 15; the expanded sheet contains 129 visible interactive targets below 44 px. No visible centers were within 8 px of another target in this fixture.

**Why it happens:** `icon-sm` is `size-7` (28 px), `sm` is `h-7` (28 px), and the default action is `h-8` (32 px). The SOS entry is deliberately placed in the top header; the Safety sheet uses a dense, scrollable long form before its emergency actions.

**Suggested fix:** Keep a persistent, labelled, minimum-44 × 44 emergency control in the reachable lower third during navigation. Opening it should expose Beacon/SMS/grid actions at the top of the panel without scrolling, with at least 44 px height. Do not solve the primary SOS target with invisible padding alone unless the actual hit area grows.

**Confidence:** High. All dimensions and coordinates are live `getBoundingClientRect()` measurements on the stated handset viewport.

## F-05 Critical HUD overlays four live navigation controls on short/keyboard viewport — MEDIUM

**Hiker consequence:** When the screen is only 400 px high (landscape or keyboard open), the OFF TRAIL warning covers the controls used to change GPS/dead-reckon state, night mode, and orientation while leaving only 198 px of map canvas.

**Where:** `src/app/navigate/[planId]/page.tsx:987-1010` (absolute HUD) and `:1013-1063` (fixed lower deck).

**Reproduction:**

    $ node adversarial/scratch-duress-detail.mjs
    414×400: canvas y=0 h=198
    HUD: x=12 y=188 w=390 h=50 (bottom=238)
    overlapping controls:
      Dead-reckon heading: y=211 h=32
      GPS:                 y=213 h=28
      Day:                 y=213 h=28
      North up:            y=213 h=28

See `/home/user/workspace/duress-short-414x400.png`: the red HUD is visibly painted over the controls. This is a real z-order collision, not merely document overflow; `scrollWidth` and `scrollHeight` remained exactly 414 × 400.

**Why it happens:** The HUD is absolutely positioned within the flexible map region with no reservation for the bottom deck; `z-20` paints it over the controls.

**Suggested fix:** Constrain HUD height/placement by the currently available map rectangle and reserve the bottom-deck bounds. At short heights, reduce/reflow the HUD or make it a non-overlapping strip; keep the map, orientation, and emergency path independently usable.

**Confidence:** High. Measured rectangular intersection and screenshot agree.

## F-06 Safety-panel off-route guidance and summary value are below contrast threshold — MEDIUM

**Hiker consequence:** The secondary safety panel repeats the 250 m off-route direction in muted gray at 3.95:1, and the persistent Off trail stat's critical 250 m value is 3.97:1; a tired hiker may not discern the supporting route-return instruction.

**Where:** `src/components/offline/safety-panel.tsx:651-665`; the persistent stat is `src/app/navigate/[planId]/page.tsx:1091-1096` and `:1171-1190`.

**Reproduction:**

    $ node adversarial/probe-duress.mjs
    day:
    3.95: "Off trail" — 10 px muted text over rgb(252,229,230)
    3.97: "250 m" — 14 px destructive text over rgb(252,229,230)

    expanded Safety sheet:
    3.95: "Walk 159° true / 146° magnetic (S) toward the dashed orange line." — 14 px
    3.97: "250 m off route" — 14 px

The principal red HUD banner itself did **not** fail contrast in the measured day, red, or NVG runs; this finding is specifically its repeated secondary guidance/stat value.

**Why it happens:** destructive/muted foreground tokens are rendered over `bg-destructive/10` / `bg-destructive/10`-like pale surfaces without an enforced contrast pair.

**Suggested fix:** Use a tested dark destructive foreground (or a deeper solid background) for all critical off-route values and directions; do not rely on the banner elsewhere as a substitute for readable in-context guidance.

**Confidence:** High. These are direct computed-color contrast calculations at the rendered font sizes.

## F-07 Two safety-panel comboboxes have no accessible name — MEDIUM

**Hiker consequence:** A screen-reader user reaches two unnamed selectors while planning an aim-off/obstacle box or a search pattern, so must guess what each selector changes.

**Where:** `src/components/offline/safety-panel.tsx:1324-1331` (offset side) and `:1429-1440` (search pattern).

**Reproduction:**

    $ node adversarial/scratch-duress-ax.mjs
    DAY: 7 actionable controls, all named
    SHEET total 114 missing [
      { "role": "combobox", "name": "", "ignored": false },
      { "role": "combobox", "name": "", "ignored": false }
    ]

This uses Chromium's `Accessibility.getFullAXTree`, not an `innerText` heuristic. The surrounding option text is not an accessible control name.

**Why it happens:** Both native `<select>` elements lack associated `<label>`, `aria-label`, or `aria-labelledby`.

**Suggested fix:** Give the selectors visible `<Label htmlFor>` text (e.g., “Aim-off side” and “Search pattern”) and matching IDs. Re-run the AX-tree assertion for zero unnamed actionable controls.

**Confidence:** High. Native accessibility tree reports exactly two non-ignored unnamed comboboxes; source matches both.

## Held up under attack

- Valid fixture route, readiness gate, and a real 250 m off-route GPS state all loaded; the visible day-mode HUD read `OFF TRAIL — 250 m from route. Walk 159° true / 146° magnetic (S) back.`
- The **main** off-trail HUD banner met contrast in all measured day/Red/NVG scenarios. The failing contrast entries are listed above; do not collapse this into a false claim that the main banner is low contrast.
- 200% OS text-scale emulation at 320 × 640 did not produce horizontal document overflow or a clipped critical readout in this fixture (`scrollWidth=320`, `scrollHeight=640`, zero measured clipped visible controls/text/canvas elements). Screenshot: `/home/user/workspace/duress-textscale200-320x640.png`.
- Forced colors and reduced-motion media emulation both matched (`forced-colors: active=true`, `prefers-reduced-motion: reduce=true`). The measured DOM text had zero contrast failures and zero clipped required elements in that state; no invisible DOM control was found. Screenshot: `/home/user/workspace/duress-forcedcolors-reducedmotion-414x896.png`.
- No pair of visible interactive target centers was closer than 8 px in the measured day or expanded-sheet states.
- The initial navigate controls are named in Chromium's accessibility tree: Exit navigation, Safety and SOS, Refresh route, Dead-reckon heading degrees true, GPS, Day, and North up.

## Scope / limitations

- Contrast measurements cover visible **DOM text nodes**. The custom map is canvas-rendered; canvas labels are not exposed as DOM text, so they cannot be individually enumerated with `getComputedStyle`. The measured USNG coordinate is the DOM rescue readout.
- The 200% check used Chromium CDP `Emulation.setEmulatedOSTextScale({scale:2})`; it did not expose a separate browser setting UI in this environment.
- I did not activate the SOS beacon during reduced-motion testing because its strobe/tone is an intentional distress-signal behavior and activation would change the safety state under test. Its ordinary `role="alertdialog"` was confirmed from source, but no conclusion about a reduced-motion exemption is reported here.
