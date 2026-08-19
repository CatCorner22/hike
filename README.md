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

## Offline usage

1. Open a trail and tap **Offline** to cache GPX and geometry in IndexedDB
2. Install the PWA from your browser (Add to Home Screen)
3. Before navigating, use **Download** in navigate mode to cache the route
4. GPS points queue locally when offline and sync when connectivity returns

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
