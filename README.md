# Hike

A bespoke hiking app for planning hikes, tracking activities, real-time trail navigation, AI-consolidated trail research, and discovering tent and backcountry camping at state and national parks.

## Features

- **Explore trails** — Search OpenStreetMap hiking routes with map, elevation profiles, and difficulty tags
- **Plan hikes** — Create trip plans with dates, notes, GPX import/export, and camping stops
- **Track activities** — Record GPS tracks with distance, elevation gain, pace, and duration
- **Navigate live** — Full-screen map navigation with off-trail alerts and elevation progress
- **Trail research** — AI-synthesized briefs from NPS data and web sources (season, hazards, parking, crowds)
- **Camping** — Tent, RV, backcountry, and walk-in sites from NPS, Recreation.gov RIDB, and state park open data (CA, CO, WA)
- **Offline** — PWA with service worker; cache trails and plans in IndexedDB for backcountry use

## Tech stack

- Next.js 16 (App Router) + TypeScript
- MapLibre GL JS + react-map-gl
- Drizzle ORM + Neon Postgres
- Vercel AI SDK + Tavily (trail research)
- Serwist (PWA service worker)
- Turf.js (geospatial)
- shadcn/ui + Tailwind CSS

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes* | Neon Postgres connection string |
| `NPS_API_KEY` | For NPS camping/research | [developer.nps.gov](https://developer.nps.gov/) |
| `RIDB_API_KEY` | For federal camping | [ridb.recreation.gov/profile](https://ridb.recreation.gov/profile) |
| `OPENAI_API_KEY` | For AI research | OpenAI or compatible provider |
| `TAVILY_API_KEY` | For web research | [tavily.com](https://tavily.com/) |
| `NEXT_PUBLIC_MAPTILER_KEY` | Optional | MapTiler outdoor tiles (defaults to OpenFreeMap) |

\*Plans, activities, and cached data require Postgres. Trail search and maps work without a database.

### 3. Set up the database

```bash
# Push schema to Neon
npm run db:push

# Or run the SQL migration manually
psql $DATABASE_URL -f drizzle/0000_init.sql
```

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Build for production

```bash
npm run build
npm start
```

## Deploy to Vercel

1. Push to GitHub and import the repo in Vercel
2. Add environment variables from `.env.example`
3. Connect a [Neon Postgres](https://neon.tech) database and set `DATABASE_URL`
4. Deploy — the app builds with webpack for Serwist PWA support

## API keys

### NPS Data API
1. Register at [developer.nps.gov](https://developer.nps.gov/)
2. Create an API key
3. Set `NPS_API_KEY`

### Recreation.gov RIDB
1. Sign up at [ridb.recreation.gov/profile](https://ridb.recreation.gov/profile)
2. Generate an API key
3. Set `RIDB_API_KEY`

### AI trail research
- Set `OPENAI_API_KEY` for GPT-4o-mini synthesis
- Set `TAVILY_API_KEY` for web search consolidation
- Without these keys, research falls back to OSM tag data

## Offline navigation (life-safety)

Navigation is designed to keep working after cell service drops. Do this **before** you leave coverage:

1. Open the trail or plan while you still have service. The app auto-saves a **route pack** (geometry, elevation, GPX) to IndexedDB on this device.
2. Tap **Prepare offline** if you want to confirm or refresh the pack.
3. Install the PWA (Add to Home Screen) so the navigate shell is cached.
4. Open **Navigate**. The screen uses a self-contained trail map that does **not** need map tiles or the network.
5. Keep the phone charged. The navigate screen requests a wake lock so it stays visible.

If you open Navigate with no pack and no network, you will see a clear error: download the route first. GPS loss does not close the map — the last fix is held and marked stale. Off-trail warnings use a 50 m threshold and show the bearing back to the route.

This is a navigation aid, not a substitute for a paper map, compass, or official park guidance.

## Project structure

```
src/
├── app/              # Pages and API routes
├── components/       # UI, map, trails, activities, camping
└── lib/
    ├── db/           # Drizzle schema and connection
    ├── osm/          # Overpass API trail queries
    ├── nps/          # National Park Service API
    ├── ridb/         # Recreation.gov RIDB API
    ├── state-parks/  # CA, CO, WA GeoJSON ingest
    ├── geo/          # Turf helpers, GPX, elevation
    ├── research/     # AI trail research pipeline
    └── offline/      # IndexedDB helpers
```

## Data sources

- **Trails:** OpenStreetMap via Overpass API (`route=hiking`)
- **Elevation:** Open-Elevation API
- **National park camping:** NPS Data API
- **Federal recreation:** Recreation.gov RIDB (facilities, permit entrances)
- **State parks:** California CNRA, Colorado, Washington open GeoJSON/ArcGIS
- **Backcountry camps:** OSM `tourism=camp_site` nodes
- **Research:** NPS articles/alerts + Tavily web search + OpenAI synthesis

## License

MIT
