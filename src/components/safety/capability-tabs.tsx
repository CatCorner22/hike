"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Deferred = () => <p className="py-3 text-xs text-muted-foreground">Loading safety tool…</p>;
const AltitudeSection = dynamic(() => import("@/components/safety/altitude-section").then((mod) => mod.AltitudeSection), { ssr: false, loading: Deferred });
const AvalancheSection = dynamic(() => import("@/components/safety/avalanche-section").then((mod) => mod.AvalancheSection), { ssr: false, loading: Deferred });
const CommsSection = dynamic(() => import("@/components/safety/comms-section").then((mod) => mod.CommsSection), { ssr: false, loading: Deferred });
const LoadSection = dynamic(() => import("@/components/safety/load-section").then((mod) => mod.LoadSection), { ssr: false, loading: Deferred });
const TcccSection = dynamic(() => import("@/components/safety/tccc-section").then((mod) => mod.TcccSection), { ssr: false, loading: Deferred });
const ThermalSection = dynamic(() => import("@/components/safety/thermal-section").then((mod) => mod.ThermalSection), { ssr: false, loading: Deferred });
const WaterSection = dynamic(() => import("@/components/safety/water-section").then((mod) => mod.WaterSection), { ssr: false, loading: Deferred });
const WildlifeSection = dynamic(() => import("@/components/safety/wildlife-section").then((mod) => mod.WildlifeSection), { ssr: false, loading: Deferred });

type Tab = "medical" | "hazard" | "plan" | "comms";
export function CapabilityTabs({ altitudeM, elevationProfile }: { altitudeM?: number; elevationProfile?: Array<{ distanceMeters: number; elevation: number }> }) {
  const [tab, setTab] = useState<Tab>("medical");
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Safety capabilities</p>
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList className="w-full">
          <TabsTrigger value="medical">Medical</TabsTrigger><TabsTrigger value="hazard">Hazard</TabsTrigger><TabsTrigger value="plan">Plan</TabsTrigger><TabsTrigger value="comms">Comms</TabsTrigger>
        </TabsList>
        <TabsContent value="medical">{tab === "medical" && <div className="space-y-2"><TcccSection /><AltitudeSection altitudeM={altitudeM} elevationProfile={elevationProfile} /></div>}</TabsContent>
        <TabsContent value="hazard">{tab === "hazard" && <div className="space-y-2"><AvalancheSection elevationProfile={elevationProfile} /><ThermalSection /><WildlifeSection /></div>}</TabsContent>
        <TabsContent value="plan">{tab === "plan" && <div className="space-y-2"><LoadSection /><WaterSection altitudeM={altitudeM} /></div>}</TabsContent>
        <TabsContent value="comms">{tab === "comms" && <CommsSection altitudeM={altitudeM} />}</TabsContent>
      </Tabs>
    </div>
  );
}
