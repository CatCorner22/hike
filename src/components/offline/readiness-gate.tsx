"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getIceProfile,
  getOverdueAlarm,
  saveIceProfile,
  setOverdueAlarm,
  type IceProfile,
} from "@/lib/safety/profile";
import { CHECKIN_INTERVALS, getCheckinSettings, saveCheckinSettings } from "@/lib/safety/checkin";
import { hikeReadiness } from "@/lib/safety/readiness";

export function ReadinessGate({
  packReady,
  onReady,
}: {
  packReady: boolean;
  onReady: () => void;
}) {
  const [profile, setProfile] = useState<IceProfile>({
    name: "",
    iceName: "",
    icePhone: "",
    medical: "",
    partySize: 1,
  });
  const [returnAt, setReturnAt] = useState("");
  const [checkinOn, setCheckinOn] = useState(false);
  const [checkinMin, setCheckinMin] = useState(60);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const [p, alarm, checkin] = await Promise.all([
        getIceProfile(),
        getOverdueAlarm(),
        getCheckinSettings(),
      ]);
      setProfile(p);
      setCheckinOn(checkin.enabled);
      setCheckinMin(checkin.intervalMin);
      if (alarm?.returnAt) {
        const d = new Date(alarm.returnAt);
        setReturnAt(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
      }
      const result = hikeReadiness({
        packReady,
        profile: p,
        returnAt: alarm?.returnAt ?? null,
      });
      setMissing(result.missing);
      if (result.ok) onReady();
    })();
  }, [packReady, onReady]);

  async function saveAndGo() {
    await saveIceProfile(profile);
    await setOverdueAlarm(returnAt ? new Date(returnAt) : null);
    await saveCheckinSettings({ enabled: checkinOn, intervalMin: checkinMin });
    const result = hikeReadiness({
      packReady,
      profile,
      returnAt: returnAt ? new Date(returnAt).toISOString() : null,
    });
    setMissing(result.missing);
    if (result.ok) onReady();
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Pre-hike checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Navigate will not start until the route pack, ICE, and return time are set.
          </p>
          {missing.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-destructive">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <div>
            <Label htmlFor="hiker">Your name</Label>
            <Input
              id="hiker"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ice-name">ICE name</Label>
            <Input
              id="ice-name"
              value={profile.iceName}
              onChange={(e) => setProfile({ ...profile, iceName: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ice-phone">ICE phone</Label>
            <Input
              id="ice-phone"
              value={profile.icePhone}
              onChange={(e) => setProfile({ ...profile, icePhone: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="return">Return by</Label>
            <Input
              id="return"
              type="datetime-local"
              value={returnAt}
              onChange={(e) => setReturnAt(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checkinOn}
              onChange={(e) => setCheckinOn(e.target.checked)}
            />
            Optional check-in interval
          </label>
          {checkinOn && (
            <div>
              <Label htmlFor="checkin-min">Check-in every (minutes)</Label>
              <select
                id="checkin-min"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={checkinMin}
                onChange={(e) => setCheckinMin(Number(e.target.value))}
              >
                {CHECKIN_INTERVALS.map((min) => (
                  <option key={min} value={min}>
                    {min} min
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button onClick={() => void saveAndGo()} className="w-full" disabled={!packReady}>
            Start navigation
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
