"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/brand";
import {
  BAILOUT_ROUTE_DISCLAIMER,
  attachBailoutRoute,
  describeBailoutRoutes,
  parseBailoutGpx,
  type PreparedBailoutRoute,
} from "@/lib/offline/bailout-routes";
import { enrichRoutePack, persistRoutePack } from "@/lib/offline/load-route-pack";
import { buildRoutePack, getRoutePack } from "@/lib/offline/route-pack";
import { formatDistance } from "@/lib/geo";

export function BailoutRoutePanel({
  packId,
  name,
  geometry,
}: {
  packId: string;
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
}) {
  const [routes, setRoutes] = useState<PreparedBailoutRoute[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getRoutePack(packId).then((pack) => {
      if (!cancelled) setRoutes(pack?.bailoutRoutes ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [packId]);

  async function persistRoutes(next: PreparedBailoutRoute[]) {
    const existing = await getRoutePack(packId);
    const base = existing ?? buildRoutePack({ id: packId, name, geometry });
    await persistRoutePack(enrichRoutePack({ ...base, bailoutRoutes: next }, existing));
    setRoutes(next);
    window.dispatchEvent(new Event("hike:offline-readiness-changed"));
  }

  async function importGpx() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".gpx,application/gpx+xml";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      setMessage(null);
      try {
        const parsed = parseBailoutGpx({
          routeId: packId,
          name: file.name,
          gpx: await file.text(),
          main: geometry,
        });
        if ("error" in parsed) {
          setMessage(parsed.error);
          return;
        }
        const attached = attachBailoutRoute(routes, parsed.route);
        if ("error" in attached) {
          setMessage(attached.error);
          return;
        }
        await persistRoutes(attached.routes);
        setMessage(`${parsed.route.name} stored. ${BAILOUT_ROUTE_DISCLAIMER}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not store that bailout track.");
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await persistRoutes(routes.filter((route) => route.id !== id));
      setMessage("Bailout track removed from this saved offline route.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove that bailout track.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">User-supplied bailout tracks</h3>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void importGpx()}>
          Add bailout GPX
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Import a mapped trail or road that already meets this route. {APP_NAME} stores the track only
        if it comes within 80 m of the prepared line. It will not invent a connector.
      </p>
      {routes.length ? (
        <ul className="space-y-2 text-sm">
          {routes.map((route) => (
            <li key={route.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
              <span>
                {route.name} · joins {formatDistance(route.join.alongMeters)} into the route · {formatDistance(route.lengthMeters)} stored
              </span>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(route.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{describeBailoutRoutes([])}</p>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
