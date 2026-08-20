"use client";

import { useEffect, useState } from "react";
import { listRoutePacks, routePackStatus, type RoutePack } from "@/lib/offline/route-pack";

export function OfflineSavedPacks() {
  const [packs, setPacks] = useState<RoutePack[] | null>(null);

  useEffect(() => {
    void listRoutePacks().then(setPacks);
  }, []);

  if (packs === null) {
    return <p className="text-sm text-muted-foreground">Checking saved route packs…</p>;
  }
  if (packs.length === 0) {
    return <p className="text-sm text-muted-foreground">No route packs are saved on this device.</p>;
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <h2 className="text-sm font-medium">Saved route packs</h2>
      <ul className="space-y-2">
        {packs.map((pack) => {
          const status = routePackStatus(pack);
          return (
            <li key={pack.id} className="rounded-lg bg-muted px-3 py-2 text-sm">
              <p className="font-medium">{pack.name}</p>
              <p className="text-xs text-muted-foreground">
                {status === "ready"
                  ? "Saved and ready to navigate."
                  : "Saved, but needs an online refresh before relying on it."}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
