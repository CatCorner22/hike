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

  useEffect(() => {
    if (!loaded || !mapRef.current || fitBounds) return;
    if (!didCenterRef.current) {
      didCenterRef.current = true;
      return;
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
    <div className={className}>
      <Map
        ref={mapRef}
        mapStyle={MAP_STYLE}
        initialViewState={{
          longitude: center.lng,
          latitude: center.lat,
          zoom,
        }}
        onLoad={() => setLoaded(true)}
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
