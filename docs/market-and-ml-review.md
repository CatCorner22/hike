# Commercial hiking, open-source, and Hugging Face review

Reviewed 2026-08-22. This is a product/engineering comparison, not an endorsement. Feature sets change; links point to vendor or project-owned sources wherever possible.

## Commercial reference set

| Product | Publicly documented strength | Contrast with Klandagi | Decision taken |
|---|---|---|---|
| [AllTrails](https://support.alltrails.com/hc/en-us/articles/37213407013908-Wrong-turn-alerts) | Large discovery surface, downloaded maps, navigation, and lock-screen/watch wrong-turn alerts after a documented 50 m deviation | Klandagi has a much smaller catalog and no native background notification guarantee, but exposes its 35 m/80 m thresholds, GPS uncertainty, and route-only fallback rather than treating the basemap as required | Keep the transparent threshold/fix model; simplify launch to **Go**; add physical-device background tests before promising native-style alerts |
| [onX Backcountry](https://www.onxmaps.com/backcountry/app/features/offline-maps-hiking-skiing) | Offline topo maps across all 50 states, route building, waypoints, tracking, land/terrain context, and 3D | Klandagi cannot yet match the terrain/land-layer catalog; it is differentiated by explicit unknown/access/permit evidence and contingency decision support | Prioritize a licensed offline corridor and land-management evidence before 3D |
| [Gaia GPS](https://help.gaiagps.com/hc/en-us/articles/115003524987-Download-Maps-for-a-Track-Route-or-Area-in-Android) | Route/area map downloads, multiple sources/resolutions, and offline routing data | Klandagi verifies its application shell and manifest assets but currently stores OSM corridor vectors rather than a selectable map-layer corridor | Preserve cold-launch verification; evaluate PMTiles only after tile licensing, byte estimates, eviction, and deletion are explicit |
| [CalTopo](https://training.caltopo.com/all_users/mobile/offline) | Planning-centric map layers, offline mobile maps, recorded tracks, collaborative/team workflows, and a deliberate offline mode | Klandagi is easier for an occasional hiker but lacks CalTopo's mature layer, print, and team operations | Keep expert tools behind disclosure; improve printable leave-behind and interoperable exports before adding more calculators |
| [FarOut](https://faroutguides.com/farouts-pre-hike-checklist/) | Curated long-distance guides with downloadable maps and waypoint photos | Klandagi uses broad OSM/government discovery and therefore cannot assume curation or current community comments | Never fabricate crowd/condition knowledge; show provenance/freshness and allow private field notes/photos |
| [Avenza Maps](https://www.avenzamaps.com/) | Publisher maps, offline GPS, tracks, placemarks, photos, and custom-map deployment | Klandagi has no geospatial PDF/GeoTIFF catalog, but its prepared route and emergency surface are more opinionated | Keep GPX/GeoJSON portability; treat geospatial PDF import as a later, license-aware interoperability project |
| [NPS App](https://www.nps.gov/subjects/digital/nps-apps.htm) and [Recreation.gov](https://www.recreation.gov/mobile-app) | Authoritative park content/offline downloads and federal reservations | Klandagi spans agencies but must not imply that aggregation equals authority or availability | Link to the exact official record, retain source state, and keep reservation/access/permit facts separate |

## Useful codebases

| Codebase | Useful for | Recommendation |
|---|---|---|
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | GPU-accelerated browser vector maps; already used online | Keep. The dependency is not the guaranteed offline Safety Map. |
| [PMTiles](https://github.com/protomaps/PMTiles) and [Protomaps basemaps](https://github.com/protomaps/basemaps) | Single-file tile archives and an OSM basemap pipeline | Prototype for route-corridor packages, not planet downloads. Pin source/license, estimate bytes before download, verify ranges/files, and isolate eviction from route packs. |
| [GraphHopper](https://github.com/graphhopper/graphhopper) | OSM-based routing, instructions, map matching, and isochrones | Evaluate server-side for optional snap-to-trail planning. Never silently replace the user-imported or official route, and validate hiking access/tag behavior against a U.S. field corpus. |
| [Valhalla](https://github.com/valhalla/valhalla) | OSM routing, elevation sampling, map matching, matrices, and isochrones | Alternative to GraphHopper, not a second simultaneous routing stack. Run a bounded comparison on difficult trail/access fixtures before choosing. |
| [Hugging Face Transformers.js](https://github.com/huggingface/transformers.js) | Browser inference with ONNX models | Suitable only for opt-in conveniences that do not gate navigation or safety. The present candidate is reviewed in `ml-adoption-gate.md`. |

## Hugging Face findings

The most defensible near-term model candidate is [onnx-community/whisper-tiny.en](https://huggingface.co/onnx-community/whisper-tiny.en) for a short, on-device field-note draft through [Transformers.js](https://huggingface.co/docs/transformers.js). It is **not shipped**: the model/runtime/cache footprint and mobile power cost are material, and the [base model card](https://huggingface.co/openai/whisper-tiny) documents hallucination and uneven performance. A transcript would therefore be an editable draft only, never an emergency command, coordinate, access fact, or automatic saved note.

Hub search did not identify a maintained, authoritative, U.S.-wide dataset for current trail closures, permits, campsite availability, or emergency alerts. Synthetic travel/persona datasets and generic hiking-image models are not substitutes for NPS, NWS, RIDB, state, and land-manager records. No such dataset was added.

## Implemented recommendations

- Replaced the crowded mobile default with **Find / Trips / Go / Saved / Help** and a dedicated Go launch.
- Added submit-only U.S. place search, Near Me, and bounded direct trail queries.
- Made offline readiness prove both the route pack and first cold-launch assets, with visible failed/unknown states.
- Preserved breadcrumbs append-only and resumable instead of truncating at an arbitrary point count.
- Added source-labeled **Mark this place**, bounded metadata-stripped photos, undo, and portable export.
- Added NWS route sampling and exactly verified NPS alert evidence with retrieval/freshness/partial-source truth.
- Added opt-in, revocable, minimal Guardian links; server acknowledgement, expiry, and silence remain distinct facts.
- Deferred model code from the safety bundle and recorded measurable adoption gates.

## Deliberate deletions and deferrals

- Removed invented fallback seasons, crowd levels, conditions, and implied permit/access answers.
- Removed worldwide text-only Overpass scans from the normal fallback path.
- Kept dense SAR/land-navigation references, but removed them from the default quick-action flow.
- Did not add ratings/social feeds, opaque AI risk scores, auto-generated rescue advice, plant identification, or a hidden model download.
- Did not claim offline terrain tiles, smoke/AQI coverage, delivery notifications, or physical-device background behavior before those systems are implemented and field-tested.
