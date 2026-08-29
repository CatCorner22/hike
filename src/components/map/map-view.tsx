"use client";

import { useEffect, useRef, useState } from "react";
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE } from "@/lib/constants";

export interface MapViewProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  trailGeometry?: GeoJSON.LineString | GeoJSON.MultiLineString;
  trackGeometry?: GeoJSON.LineString;
  userPosition?: { lat: number; lng: number; heading?: number };
  markers?: Array<{
    id: string;
    lat: number;
    lng: number;
    color?: string;
    label?: string;
  }>;
  onClick?: (coords: { lat: number; lng: number }) => void;
  onMarkerClick?: (id: string) => void;
  className?: string;
  interactive?: boolean;
  showNavigation?: boolean;
  fitBounds?: [number, number, number, number];
}

/**
 * Source ids this component adds itself, drawn from data the app already holds.
 *
 * MapLibre tiles GeoJSON sources internally, so these raise tile events of their
 * own. They say nothing about whether the basemap is reaching its host, and
 * counting them would mark it healthy on precisely the pages that draw a route.
 */
const OVERLAY_SOURCE_IDS = new Set(["trail", "track"]);

/**
 * Did the basemap actually put anything on the screen?
 *
 * `load` does not answer this. MapLibre's `TileManager.loaded()` returns true
 * when the source errored (`tile/tile_manager.ts`: `if (this._sourceErrored)
 * return true`) and counts a tile in state `errored` as settled alongside
 * `loaded`, so a map whose every tile failed still calls itself loaded.
 *
 * Nor do the events. Measured against a real build: a tile that arrives is
 * announced by `_tileLoaded` as a bare `data` event carrying its tile, and that
 * event does not reach `onSourceData` or `onData` — both see only the source's
 * `metadata`, `content` and `visibility` events, never a tile. And a tile that
 * 404s reports nothing at all, because the `ErrorEvent` is raised only
 * `if (err.status !== 404)`. So neither "a tile loaded" nor "a tile failed" is
 * observable from the outside.
 *
 * What is left is the tile state itself. This reads it, and it is the only
 * place in this file that reaches past the public API — so it is written to
 * fail safe: anything unrecognised returns true, meaning "assume there is a map
 * here". The notice covers the map completely, and hiding a working map behind
 * a warning is the worse of the two mistakes.
 */
function basemapTileReport(map: unknown): { drew: boolean; settling: boolean } {
  try {
    const managers = (map as { style?: { tileManagers?: Record<string, unknown> } })
      .style?.tileManagers;
    if (!managers) return { drew: true, settling: false };
    const basemaps = Object.keys(managers).filter((id) => !OVERLAY_SOURCE_IDS.has(id));
    // A style with no sources of its own has no tiles to wait for.
    if (basemaps.length === 0) return { drew: true, settling: false };
    let readable = false;
    let drew = false;
    let settling = false;
    for (const id of basemaps) {
      const tiles = (managers[id] as {
        _inViewTiles?: { getAllTiles?: () => Array<{ state?: string }> };
      })._inViewTiles?.getAllTiles?.();
      if (!Array.isArray(tiles)) continue;
      readable = true;
      for (const tile of tiles) {
        if (tile?.state === "loaded") drew = true;
        else if (tile?.state === "loading") settling = true;
      }
    }
    // Tile state we could not read is not evidence of an empty map.
    if (!readable) return { drew: true, settling: false };
    return { drew, settling };
  } catch {
    return { drew: true, settling: false };
  }
}

export function MapView({
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  trailGeometry,
  trackGeometry,
  userPosition,
  markers = [],
  onClick,
  onMarkerClick,
  className = "h-full w-full",
  interactive = true,
  showNavigation = true,
  fitBounds,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const didCenterRef = useRef(false);
  const initialCenterRef = useRef(center);
  /**
   * The basemap comes from a third-party tile host, and it is the one part of
   * this screen that needs the network. When that fetch fails the map used to
   * render as an empty box: no message, no retry, and — because `onLoad` never
   * fires — no `fitBounds` either, so it was not even pointing at the trail.
   * Silence is the wrong answer anywhere in this app, and worse here, because
   * the failure looks exactly like "there is nothing here".
   */
  const [styleFailed, setStyleFailed] = useState(false);
  // `onError` fires from a listener registered once, so a state value read
  // inside it would be the one captured at registration. The ref is current.
  const loadedRef = useRef(false);
  // Bumping this remounts the map, which is what actually re-fetches the style.
  const [attempt, setAttempt] = useState(0);
  /**
   * A retry is not instant, and on a weak connection it is the slowest thing on
   * the screen. Clearing the message the moment the button is pressed put the
   * user back in front of a blank box with nothing to read — the same dead end
   * the message exists to prevent, just briefly. The notice stands until the
   * attempt resolves one way or the other; it is still true while it is up.
   */
  const [retrying, setRetrying] = useState(false);
  // Bumped by `load` to start the settle check below; see that effect.
  const [settleTick, setSettleTick] = useState<number | null>(null);
  /**
   * `load` is not proof that the map drew anything.
   *
   * MapLibre's own `TileManager.loaded()` returns true when the source errored
   * (`tile/tile_manager.ts`: `if (this._sourceErrored) return true`) and counts
   * a tile in state `errored` as settled alongside `loaded`. Either makes
   * `map.loaded()` true and fires `load`. So a style that fetches fine while
   * every one of its tiles fails — a tile host down, a captive portal, a
   * connection that dies between the two requests — raised the notice on the
   * first tile error and then erased it a moment later on `load`, leaving a
   * blank map saying nothing. Verified against a real build: six tile requests,
   * all refused, and no warning on screen.
   *
   * So `load` clears the notice only if the map has something on it. An error
   * with at least one tile through is a gap in a usable map, and is ignored the
   * way isolated tile errors after load already were.
   */

  useEffect(() => {
    if (!loaded || !mapRef.current || fitBounds) return;
    const moved =
      center.lat !== initialCenterRef.current.lat ||
      center.lng !== initialCenterRef.current.lng;
    if (!didCenterRef.current) {
      didCenterRef.current = true;
      if (!moved) return;
    }
    mapRef.current.flyTo({
      center: [center.lng, center.lat],
      zoom,
      duration: 600,
    });
  }, [center.lat, center.lng, zoom, loaded, fitBounds]);

  /**
   * Decide whether the basemap drew anything, once its tiles have stopped
   * moving.
   *
   * `load` cannot answer this on its own: a source whose tiles errored reports
   * itself settled, so `load` can arrive while a good tile is still in flight —
   * measured, with tile states reading
   * `["errored","errored","loading","errored","errored","errored"]` at that
   * moment. Deciding there would blank a map that was about to draw.
   *
   * So the verdict waits for the last tile to land, and stops waiting after a
   * few seconds, because a request that never returns must not hold the notice
   * off for ever.
   *
   * Stopping is not a final answer, though. A tile that lands afterwards has to
   * take the notice back down — a mountain connection is exactly where a tile
   * takes longer than this, and leaving a warning over a map that has since
   * drawn is the same lie in the other direction.
   *
   * That second half is a listener rather than a longer timer, and deliberately.
   * Any deadline picked for it is arbitrary and wrong for the tile that arrives
   * just after it; the only timer that is never wrong is one that never stops,
   * which is a leak. MapLibre fires `idle` whenever it has finished rendering
   * with nothing left dirty, and a late tile makes it dirty again — so the
   * event says exactly "something changed, look again", costs nothing while
   * nothing is happening, and needs no bound at all.
   */
  useEffect(() => {
    if (settleTick === null || !mapRef.current) return;
    const map = mapRef.current.getMap();
    const startedAt = Date.now();
    const patience = 8_000;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const { drew, settling } = basemapTileReport(map);
      if (drew || !settling) {
        // Settled, one way or the other. This is the answer.
        setStyleFailed(!drew);
        return;
      }
      if (Date.now() - startedAt >= patience) {
        // Still nothing to show. True right now, and `idle` below revisits it.
        setStyleFailed(true);
        return;
      }
      timer = setTimeout(check, 300);
    };
    const onIdle = () => {
      if (basemapTileReport(map).drew) setStyleFailed(false);
    };
    check();
    map.on("idle", onIdle);
    return () => {
      clearTimeout(timer);
      map.off("idle", onIdle);
    };
  }, [settleTick, attempt]);

  useEffect(() => {
    if (!loaded || !fitBounds || !mapRef.current) return;
    mapRef.current.fitBounds(
      [
        [fitBounds[0], fitBounds[1]],
        [fitBounds[2], fitBounds[3]],
      ],
      { padding: 40, duration: 800 },
    );
  }, [fitBounds, loaded]);

  return (
    <div className={`relative ${className}`}>
      {(styleFailed || retrying) && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-muted/95 p-6 text-center"
        >
          <p className="text-sm font-medium">The background map could not be loaded.</p>
          {retrying ? (
            <p className="max-w-xs text-sm text-muted-foreground">Trying again…</p>
          ) : (
            <>
              <p className="max-w-xs text-sm text-muted-foreground">
                This needs a connection. The trail details on this page are still correct, and
                saving a route for offline use does not use this map.
              </p>
              <button
                type="button"
                onClick={() => {
                  loadedRef.current = false;
                  setSettleTick(null);
                  // The map below is remounted, but `loaded` lives up here and
                  // would stay true across it — leaving the effects that frame
                  // the trail with no change to fire on, so a retry that worked
                  // would show the route unframed.
                  setLoaded(false);
                  setRetrying(true);
                  setAttempt((n) => n + 1);
                }}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                Try again
              </button>
            </>
          )}
        </div>
      )}
      <Map
        ref={mapRef}
        mapStyle={MAP_STYLE}
        initialViewState={{
          longitude: center.lng,
          latitude: center.lat,
          zoom,
        }}
        key={attempt}
        onLoad={() => {
          loadedRef.current = true;
          setLoaded(true);
          setRetrying(false);
          // Deliberately no verdict here. `load` fires as soon as the tiles
          // have *settled*, and an errored source counts as settled — so with
          // some tiles failing it can arrive while a good one is still in
          // flight. Judging now would blank a map that is about to draw.
          setSettleTick(0);
        }}
        onError={() => {
          // Raised here so a dead style is reported immediately rather than at
          // `load`, which for an unreachable style never comes. What `load`
          // decides is settled by the tiles that arrived, not by this.
          // Once the style is up, errors are individual tiles failing on a map
          // that still works and still shows the route. Blanking it for those
          // would take away a usable map over a missing square.
          if (!loadedRef.current) setStyleFailed(true);
          setRetrying(false);
        }}
        onClick={
          onClick
            ? (e) => onClick({ lat: e.lngLat.lat, lng: e.lngLat.lng })
            : undefined
        }
        style={{ width: "100%", height: "100%" }}
        interactive={interactive}
      >
        {showNavigation && <NavigationControl position="top-right" />}

        {trailGeometry && (
          <Source id="trail" type="geojson" data={trailGeometry}>
            <Layer
              id="trail-line"
              type="line"
              paint={{
                "line-color": "#16a34a",
                "line-width": 4,
                "line-opacity": 0.9,
              }}
            />
          </Source>
        )}

        {trackGeometry && (
          <Source id="track" type="geojson" data={trackGeometry}>
            <Layer
              id="track-line"
              type="line"
              paint={{
                "line-color": "#2563eb",
                "line-width": 3,
                "line-opacity": 0.85,
              }}
            />
          </Source>
        )}

        {userPosition && (
          <Marker
            longitude={userPosition.lng}
            latitude={userPosition.lat}
            anchor="center"
          >
            <div className="relative">
              <div className="h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow-lg" />
              {userPosition.heading != null && (
                <div
                  className="absolute left-1/2 top-1/2 h-0 w-0 -translate-x-1/2 -translate-y-full border-x-4 border-b-8 border-x-transparent border-b-blue-600"
                  style={{ transform: `rotate(${userPosition.heading}deg)` }}
                />
              )}
            </div>
          </Marker>
        )}

        {markers.map((m) => (
          <Marker key={m.id} longitude={m.lng} latitude={m.lat} anchor="bottom">
            <div
              className={`flex flex-col items-center${onMarkerClick ? " cursor-pointer" : ""}`}
              title={m.label}
              role={onMarkerClick ? "button" : undefined}
              tabIndex={onMarkerClick ? 0 : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onMarkerClick?.(m.id);
              }}
              onKeyDown={(event) => {
                if (!onMarkerClick) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onMarkerClick(m.id);
                }
              }}
            >
              <div
                className="h-3 w-3 rounded-full border border-white shadow"
                style={{ backgroundColor: m.color || "#f97316" }}
              />
              {m.label && (
                <span className="mt-0.5 max-w-24 truncate rounded bg-black/70 px-1 text-[10px] text-white">
                  {m.label}
                </span>
              )}
            </div>
          </Marker>
        ))}
      </Map>
    </div>
  );
}
