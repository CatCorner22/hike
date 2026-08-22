# Klandagi product roadmap

## Product thesis

**Know the route. Know the risks. Know how you're getting home.**

Klandagi should compete as a safety-first wilderness decision-support and contingency-navigation product, not as a generic trail-review social network.

## Product principles

1. Offline is a primary operating mode, not a degraded mode.
2. Safety calculations are deterministic, inspectable, and testable. AI may summarize facts; it must not calculate coordinates, bearings, emergency thresholds, or rescue instructions.
3. Distinguish observation from inference. "No update" is not "distress." "Cached weather" is not "current weather."
4. Preserve a lightweight route-only Safety Map even after richer offline terrain is added.
5. Interoperate: GPX import/export and portable trip data are features, not leakage.

## Delivery order

## Implementation status — 2026-08-22

| Workstream | Status | Current boundary |
|---|---|---|
| P0 safety/truthfulness tranche | Delivered | Deterministic calculations, fail-closed persistence, explicit unknowns, datum-safe headings, and cold-launch asset verification are covered by automated tests. |
| U.S. discovery and camping evidence | Delivered | Place search is submit-only and U.S./territory bounded; direct trail fallback queries are no longer worldwide; access and permit facts remain evidence-backed or unknown. |
| Offline corridor | Partial | The pack stores a corridor specification and nearby OSM vectors. Raster/vector terrain tiles are intentionally not claimed as downloaded. |
| Route-aware briefing | Delivered baseline | Along-route forecast plus NWS/NPS official-alert snapshots are stored with provenance and freshness. Smoke and AQI remain future authoritative integrations. |
| Bailouts and decision points | Delivered baseline | Ordered route decisions, OSM candidates, and user GPX bailouts are supported; the app never invents a connector to the prepared route. |
| Trip Guardian | Delivered baseline | Links are opt-in, revocable, short-lived, database-backed, and expose minimal status without interpreting silence as distress. Delivery notifications and accounts remain future work. |
| Terrain difficulty intelligence | Delivered baseline | Route distance, ascent/descent, maximum and sustained grade, altitude, and mapped terrain factors are shown as measured, reported, or unknown—never collapsed into an opaque score. |
| Printable leave-behind | Delivered baseline | A print-ready or downloadable trip card carries the route, return deadline, ICE information, route endpoints when geometry is available, and the explicit silence-is-not-distress disclaimer. |
| Field waypoints | Delivered text/photo baseline | Durable source-labeled marks, privacy-scrubbed bounded photos, edit/delete/undo, and GeoJSON export ship. Voice notes remain behind the ML adoption gate. |
| Activity recording and export | Delivered baseline | Fixes are queued before upload, local/server identity is stable, Stop drains pending saves, hard-reload recovery is explicitly paused, and finished activities/navigation tracks export as GPX. |
| Optional accounts/sync, complete terrain tiles, smoke/AQI, 3D/native/watch | Planned | These require separate product, licensing, operational, and physical-device validation; they are not represented as completed. |

### P0 — current tranche
- Product repositioning and safety-first language.
- Deterministic daylight/ETA margin engine.
- Decision-point and bailout data model.
- Trip Guardian overdue-state model with epistemically honest messaging.
- GPX route/activity export (existing geometry exporters are the canonical implementation).
- Route-pack extension points for decision points and richer hazard briefings.

### P1 — offline terrain corridor
Download a configurable corridor around the route containing terrain context, nearby trails, roads, water, shelters, trailheads, campsites, bridges, and landmarks. Show coverage explicitly (for example, route + 2-mile corridor). Keep the existing canvas Safety Map as a route-only fallback when its route and app files have been saved and verified; never describe any phone-based map as guaranteed.

### P1 — route-aware hazard briefing
Sample conditions along the route and time axis. Store forecast provenance and expiry. Include precipitation, gusts, heat/cold stress inputs, severe-weather alerts, smoke/AQI where authoritative sources permit, and sunrise/sunset. The briefing must continue to work from its cached facts offline and clearly mark staleness.

### P1 — bailout planner and Decision Points
Identify route intersections, road crossings, shelters, trailheads, water, and user-defined escape points. Allow explicit bailout routes to be prepared into the offline pack. During navigation, show the next meaningful decision point rather than only raw position.

### P1 — Trip Guardian
User configures expected finish and hard-overdue time plus a trusted contact. When connectivity exists, publish minimal trip status: last successful update time, progress/ETA, battery, and route-deviation state. Never imply that missing connectivity proves an emergency. Guardian must be opt-in and privacy-first.

### P1 — Rescue Card
Large, glanceable coordinates; coordinate-system alternatives already supported by safety modules; fix source/age/accuracy; route deviation; battery; ICE; recent breadcrumb; nearest route/road when deterministically known. Provide copy/share affordances without changing the underlying navigation fix.

### P2 — authoritative conditions
Aggregate closures and notices from authoritative land managers and emergency sources. Every notice carries source, observed/published time, retrieval time, and expiry/unknown-staleness state. Community reports can be added later as a separately labeled evidence class.

### P2 — optional accounts and sync
Keep anonymous device mode. Add optional accounts for backup, cross-device planning, shared trips, and device replacement. GPS history remains private by default. Never make an account a prerequisite for prepared offline navigation.

### P2 — terrain difficulty intelligence (delivered baseline)
Explain difficulty using distance, ascent/descent, maximum and sustained grade, technical/route-finding factors, crossings, exposure, shade, water, altitude, and daylight requirements rather than a single opaque rating. The baseline distinguishes measured route facts, community-reported metadata, and unknown evidence. More complete member-way and field evidence remains future work.

### P2 — field waypoints
Offline waypoint creation with typed categories (water, hazard, campsite, crossing, viewpoint, vehicle, obstruction, shelter, custom), text/voice/photo attachments where platform support permits, and GPX/KML-compatible export.

### P3
- Land-management/access/permit layers.
- 3D terrain after offline terrain and bailout workflows are mature.
- Native/watch companion only when PWA limitations justify the maintenance cost.

## Explicit non-priorities

Do not spend early product cycles on a social feed, follower graph, leaderboards, badges, a giant photo-review network, photorealistic 3D, or an AI chatbot on every screen. These increase scope without strengthening Klandagi's safety/decision-support differentiation.

## Definition of done for safety-affecting features

A safety-affecting feature is not complete until it has unit tests for boundaries, adversarial inputs, stale/missing data behavior, offline behavior where applicable, and user-facing wording that states uncertainty. Changes to navigation geometry or offline persistence also require the production-build offline E2E probe.
