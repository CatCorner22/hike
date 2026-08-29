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
      {styleFailed && (
        <div
          role="status"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-muted/95 p-6 text-center"
        >
          <p className="text-sm font-medium">The background map could not be loaded.</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            This needs a connection. The trail details on this page are still correct, and
            saving a route for offline use does not use this map.
          </p>
          <button
            type="button"
            onClick={() => {
              loadedRef.current = false;
              setStyleFailed(false);
              setAttempt((n) => n + 1);
            }}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
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
          setStyleFailed(false);
        }}
        onError={() => {
          // Once the style is up, errors are individual tiles failing on a map
          // that still works and still shows the route. Blanking it for those
          // would take away a usable map over a missing square.
          if (!loadedRef.current) setStyleFailed(true);
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
