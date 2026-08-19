"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ElevationChart } from "@/components/trails/elevation-chart";
import {
  distanceToTrailMeters,
  formatDistance,
  nearestPointOnTrail,
} from "@/lib/geo";
import { OFF_TRAIL_THRESHOLD_METERS } from "@/lib/constants";
import { cachePlanOffline, cacheTrailOffline, getOfflinePlan } from "@/lib/offline";
import { ArrowLeft, AlertTriangle, Download } from "lucide-react";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <div className="h-screen bg-muted" /> },
);

interface NavData {
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox: [number, number, number, number];
  elevationProfile: Array<{ distanceMeters: number; elevation: number }>;
}

export default function NavigatePage() {
  const params = useParams();
  const router = useRouter();
  const navId = params.planId as string;

  const [navData, setNavData] = useState<NavData | null>(null);
  const [userPosition, setUserPosition] = useState<{
    lat: number;
    lng: number;
    heading?: number;
  } | null>(null);
  const [offTrail, setOffTrail] = useState(false);
  const [distanceToTrail, setDistanceToTrail] = useState(0);
  const [currentDistance, setCurrentDistance] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    async function load() {
      try {
        if (navId.startsWith("trail-")) {
          const trailId = navId.replace("trail-", "");
          const response = await fetch(`/api/trails/${trailId}`);
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          setNavData({
            name: data.name,
            geometry: data.geometry,
            bbox: data.bbox,
            elevationProfile: data.elevationProfile || [],
          });
        } else if (navId.startsWith("plan-")) {
          const planId = navId.replace("plan-", "");
          const offline = await getOfflinePlan(planId);
          const response = await fetch(`/api/plans/${planId}`);
          const plan = await response.json();
          if (plan.trailId) {
            const tr = await fetch(`/api/trails/${plan.trailId}`).then((r) => r.json());
            setNavData({
              name: plan.name,
              geometry: tr.geometry || plan.customGeometry,
              bbox: tr.bbox,
              elevationProfile: tr.elevationProfile || [],
            });
          } else if (plan.customGeometry) {
            setNavData({
              name: plan.name,
              geometry: plan.customGeometry,
              bbox: [0, 0, 0, 0],
              elevationProfile: [],
            });
          }
          void offline;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load route");
      }
    }
    load();
  }, [navId]);

  useEffect(() => {
    if (!navData) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const pos = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          heading: position.coords.heading ?? undefined,
        };
        setUserPosition(pos);

        const dist = distanceToTrailMeters(pos, navData.geometry);
        setDistanceToTrail(dist);
        setOffTrail(dist > OFF_TRAIL_THRESHOLD_METERS);

        const nearest = nearestPointOnTrail(pos, navData.geometry);
        setCurrentDistance(nearest.index * 50);
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [navData]);

  const downloadOffline = useCallback(async () => {
    if (!navData) return;
    const { gpxFromLineString } = await import("@/lib/geo");
    const gpx = gpxFromLineString(navData.name, navData.geometry);
    await cacheTrailOffline({
      id: navId,
      name: navData.name,
      geometry: navData.geometry,
      gpx,
    });
    alert("Route cached for offline navigation");
  }, [navData, navId]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <Alert variant="destructive">
          <AlertTitle>Navigation error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!navData) {
    return <div className="h-screen animate-pulse bg-muted" />;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b bg-background/95 p-3 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Exit
        </Button>
        <h1 className="truncate text-sm font-semibold">{navData.name}</h1>
        <Button variant="ghost" size="sm" onClick={downloadOffline}>
          <Download className="h-4 w-4" />
        </Button>
      </div>

      {offTrail && (
        <Alert variant="destructive" className="mx-3 mt-2 rounded-lg">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Off trail</AlertTitle>
          <AlertDescription>
            You are {formatDistance(distanceToTrail)} from the route.
          </AlertDescription>
        </Alert>
      )}

      <div className="relative flex-1">
        <MapView
          trailGeometry={navData.geometry}
          userPosition={userPosition ?? undefined}
          fitBounds={navData.bbox[0] !== 0 ? navData.bbox : undefined}
          className="h-full w-full"
        />
      </div>

      {navData.elevationProfile.length > 0 && (
        <div className="border-t bg-background p-3">
          <ElevationChart
            profile={navData.elevationProfile}
            currentDistanceMeters={currentDistance}
            className="h-24 w-full"
          />
        </div>
      )}
    </div>
  );
}
