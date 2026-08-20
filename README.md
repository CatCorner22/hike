# Hike

A hiking app for exploring OSM trails, preparing an offline route pack, navigating without tiles, recording an activity, and sending an honest SOS grid.

## What actually works

- **Explore** — OpenStreetMap hiking routes, elevation, difficulty tags
- **Plan** — Dates, notes, GPX import, camping stops, and named waypoints
- **Prepare offline** — Saves a route pack to IndexedDB `hike-nav-packs` (not the unused `hike-offline` trail/plan stores)
- **Navigate** — Self-contained canvas map. Works with no network and no map tiles once a pack is on the device. Off-trail: warn at **35 m**, critical at **80 m** (adjusted for GPS accuracy)
- **SOS / ICE** — One `navFix` (live GPS, last-known, or pace/heading dead reckon) for SMS, dossier, and “walk this bearing”
- **Activities** — Start/stop/pause work offline. Pause stops GPS. Points queue in IndexedDB and replay when you are back online
- **Camping** — NPS / RIDB / state parks / OSM. Search does **not** auto-sync the world on an empty result; pass `?sync=true` to refresh
- **Research** — Optional AI brief. Reservation and source links are **https only**

## What it is not

This is land-nav / SAR / wilderness support — not weapons or targeting. It is not a substitute for a paper map, compass, or official park guidance.

## Tech stack

- Next.js 16 (App Router) + TypeScript
- MapLibre GL JS + react-map-gl (online maps); canvas HUD when navigating offline
- Drizzle ORM + Neon Postgres **optional** — plans and activities fall back to `data/store.json`
- Vercel AI SDK + Tavily (optional research)
- Serwist PWA — **off in `npm run dev`**. Use `npm run build && npm start` to exercise the service worker
- Turf.js, shadcn/ui, Tailwind CSS

## Getting started

```bash
npm install
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | Neon Postgres. Without it, plans/activities use the local JSON file store |
| `LOCAL_STORE_PATH` | No | Override path for the file store (default `data/store.json`) |
| `NPS_API_KEY` | For NPS camping/research | [developer.nps.gov](https://developer.nps.gov/) |
| `RIDB_API_KEY` | For federal camping | [ridb.recreation.gov/profile](https://ridb.recreation.gov/profile) |
| `OPENAI_API_KEY` | For AI research | Optional |
| `TAVILY_API_KEY` | For web research | Optional |
| `NEXT_PUBLIC_MAPTILER_KEY` | Optional | MapTiler outdoor tiles (defaults to OpenFreeMap) |

### Database (optional)

```bash
npm run db:push
# or
psql $DATABASE_URL -f drizzle/0000_init.sql
psql $DATABASE_URL -f drizzle/0001_campground_external_unique.sql
```

`campgrounds.external_id` is unique. Upserts use that key.

### Run

```bash
npm run dev          # no service worker
npm test
npm run build        # webpack + Serwist
npm start            # PWA / offline shell
```

## Offline navigation (life-safety)

Do this **before** you leave coverage:

1. Open the trail or plan on Wi‑Fi. The app writes a **route pack** to `hike-nav-packs`.
2. Tap **Prepare offline** to confirm or refresh.
3. Install the PWA from a production build (`build && start`), not from `npm run dev`.
4. Open **Navigate**. The trail line stays up with no tiles and no network.
5. Keep the phone charged. Wake lock is requested; self-check reports whether it is actually held.

If you open Navigate with no pack and no network, you get a clear error. A stale GPS fix is display-only. SOS and the map use the same point and source.

## Project structure

```
src/
├── app/              # Pages and API routes
├── components/       # UI, map, trails, activities, camping
└── lib/
    ├── db/           # Drizzle schema (optional Postgres)
    ├── store/        # File-store fallback when DATABASE_URL is unset
    ├── osm/          # Overpass trail queries
    ├── geo/          # Segment-safe distance, GPX, elevation
    ├── offline/      # Route packs (hike-nav-packs) + activity queue
    └── safety/       # Land-nav, SOS, ICE, GPS quality
```

## Data sources

- Trails: OpenStreetMap via Overpass (`route=hiking`)
- Elevation: Open-Elevation
- Camping: NPS, Recreation.gov RIDB, CA/CO/WA open data, OSM camp sites
- Research: NPS + Tavily + OpenAI when keys are set

## License

MIT
