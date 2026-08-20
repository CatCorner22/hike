"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AltitudeSection } from "@/components/safety/altitude-section";
import { AvalancheSection } from "@/components/safety/avalanche-section";
import { CommsSection } from "@/components/safety/comms-section";
import { LoadSection } from "@/components/safety/load-section";
import { TcccSection } from "@/components/safety/tccc-section";
import { ThermalSection } from "@/components/safety/thermal-section";
import { WaterSection } from "@/components/safety/water-section";
import { WildlifeSection } from "@/components/safety/wildlife-section";

type Tab = "medical" | "hazard" | "plan" | "comms";
export function CapabilityTabs({ altitudeM, elevationProfile }: { altitudeM?: number; elevationProfile?: Array<{ distanceMeters: number; elevation: number }> }) {
  const [tab, setTab] = useState<Tab>("medical");
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Safety capabilities</p>
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList className="w-full">
          <TabsTrigger value="medical">Medical</TabsTrigger>
          <TabsTrigger value="hazard">Hazard</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="comms">Comms</TabsTrigger>
        </TabsList>
        <TabsContent value="medical">
          {tab === "medical" && <div className="space-y-2"><TcccSection /><AltitudeSection altitudeM={altitudeM} elevationProfile={elevationProfile} /></div>}
        </TabsContent>
        <TabsContent value="hazard">
          {tab === "hazard" && <div className="space-y-2"><AvalancheSection elevationProfile={elevationProfile} /><ThermalSection /><WildlifeSection /></div>}
        </TabsContent>
        <TabsContent value="plan">
          {tab === "plan" && <div className="space-y-2"><LoadSection /><WaterSection altitudeM={altitudeM} /></div>}
        </TabsContent>
        <TabsContent value="comms">
          {tab === "comms" && <CommsSection altitudeM={altitudeM} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
