export const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAPTILER_KEY
    ? `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`
    : "https://tiles.openfreemap.org/styles/liberty";

export const DEFAULT_CENTER = { lng: -119.5, lat: 37.7 };
export const DEFAULT_ZOOM = 5;

export const CAMPING_TYPE_LABELS: Record<string, string> = {
  developed_tent: "Tent camping",
  rv: "RV camping",
  backcountry: "Backcountry",
  walk_in: "Walk-in",
};

export const CAMPING_TYPE_COLORS: Record<string, string> = {
  developed_tent: "#22c55e",
  rv: "#3b82f6",
  backcountry: "#f97316",
  walk_in: "#a855f7",
};

/** Live HUD thresholds — warn then critical. */
export const OFF_TRAIL_WARN_METERS = 35;
export const OFF_TRAIL_CRITICAL_METERS = 80;
