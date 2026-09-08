"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SeverityBadge } from "@/components/safety/severity-badge";
import { DISCLAIMER, acclimatizationPlan, altitudeFromProfile, ascentRateAdvice, descentImperative, expectedSpo2, haceRedFlags, hapeRedFlags, lakeLouiseScore, spo2Warning, spo2WarningUnknownElevation } from "@/lib/safety/altitude";

type Score = 0 | 1 | 2 | 3;
export function AltitudeSection({ altitudeM, elevationProfile }: { altitudeM?: number; elevationProfile?: Array<{ distanceMeters: number; elevation: number }> }) {
  const [headache, setHeadache] = useState<Score>(0); const [gi, setGi] = useState<Score>(0); const [fatigue, setFatigue] = useState<Score>(0); const [dizzy, setDizzy] = useState<Score>(0);
  const [ataxia, setAtaxia] = useState(false); const [altered, setAltered] = useState(false); const [breathless, setBreathless] = useState(false);
  const [previousNight, setPreviousNight] = useState(""); const [spo2, setSpo2] = useState("");
  const score = lakeLouiseScore({ headache, giSymptoms: gi, fatigue, dizziness: dizzy }); const descent = descentImperative({ hasAtaxia: ataxia, alteredMental: altered, breathlessAtRest: breathless });
  const profile = useMemo(() => elevationProfile ? altitudeFromProfile(elevationProfile) : null, [elevationProfile]);
  // Planning functions (acclimatization, ascent rate) legitimately take a target
  // elevation, so the route maximum stands in when GPS altitude is missing. The
  // MEASUREMENT functions must not: judging a pulse-ox reading against the route's
  // high point loosened the threshold everywhere below it, silencing genuinely
  // hypoxic readings. With no measured elevation the check runs elevation-blind
  // against the sea-level floor and says so.
  const measuredElevation = altitudeM ?? null;
  const planningElevation = altitudeM ?? profile?.maxElevationM;
  const ascent = planningElevation != null ? ascentRateAdvice({ currentElevationM: planningElevation, previousNightElevationM: parseFloat(previousNight) }) : null;
  const expected = measuredElevation != null ? expectedSpo2(measuredElevation) : null;
  const spo2Note = measuredElevation != null ? spo2Warning(parseFloat(spo2), measuredElevation) : spo2WarningUnknownElevation(parseFloat(spo2));
  const plans = planningElevation != null ? acclimatizationPlan(planningElevation) : null;
  const scoreSelect = (id: string, label: string, value: Score, setValue: (next: Score) => void) => <div key={id}><Label htmlFor={id}>{label}</Label><Select value={String(value)} onValueChange={(next) => setValue(Number(next) as Score)}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent>{[0,1,2,3].map((item) => <SelectItem key={item} value={String(item)}>{item} — {item === 0 ? "none" : item === 1 ? "mild" : item === 2 ? "moderate" : "severe"}</SelectItem>)}</SelectContent></Select></div>;
  return <Card size="sm"><CardHeader><CardTitle>Altitude illness</CardTitle></CardHeader><CardContent className="space-y-3 text-xs">
    <div className="space-y-2"><p className="font-medium">Lake Louise AMS screen</p><div className="grid grid-cols-2 gap-2">{scoreSelect("alt-headache","Headache",headache,setHeadache)}{scoreSelect("alt-gi","GI symptoms",gi,setGi)}{scoreSelect("alt-fatigue","Fatigue / weakness",fatigue,setFatigue)}{scoreSelect("alt-dizzy","Dizziness",dizzy,setDizzy)}</div>{score && <div className="rounded border p-2"><SeverityBadge severity={score.severity} /><p className="mt-1">Score: <strong>{score.total}/12</strong> — {score.label}</p><ul className="list-disc pl-4 text-muted-foreground">{score.actions.map((line) => <li key={line}>{line}</li>)}</ul></div>}</div>
    <Separator />
    <details><summary className="cursor-pointer font-medium text-foreground">HACE / HAPE red flags and descent</summary><div className="mt-2 space-y-2"><div className="grid gap-1">{[["alt-ataxia","Ataxia / staggering gait",ataxia,setAtaxia],["alt-altered","Altered mental status",altered,setAltered],["alt-breathless","Breathless at rest",breathless,setBreathless]].map(([id,label,checked,setter]) => <div key={String(id)} className="flex items-center gap-1"><input id={String(id)} type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} /><Label htmlFor={String(id)}>{String(label)}</Label></div>)}</div><div className="rounded border p-2"><SeverityBadge severity={descent.severity} /><p className="mt-1">{descent.message}</p><ul className="list-disc pl-4 text-muted-foreground">{descent.actions.map((line) => <li key={line}>{line}</li>)}</ul></div><p className="font-medium">HACE</p><ul className="list-disc pl-4 text-muted-foreground">{haceRedFlags().map((line) => <li key={line}>{line}</li>)}</ul><p className="font-medium">HAPE</p><ul className="list-disc pl-4 text-muted-foreground">{hapeRedFlags().map((line) => <li key={line}>{line}</li>)}</ul></div></details>
    <details><summary className="cursor-pointer font-medium text-foreground">Acclimatization and oxygen check</summary><div className="mt-2 space-y-2"><p>{measuredElevation != null ? `GPS altitude: ${Math.round(measuredElevation)} m` : planningElevation != null ? `Planning against route maximum: ${Math.round(planningElevation)} m (GPS altitude unavailable)` : "Altitude not available"}</p>{profile && <p className="text-muted-foreground">Route profile: maximum {Math.round(profile.maxElevationM)} m; total gain {Math.round(profile.totalGainM)} m; distance above 2,500 m {Math.round(profile.metersAbove2500)} m.</p>}<Label htmlFor="alt-previous-night">Previous sleeping elevation (m)</Label><Input id="alt-previous-night" type="number" value={previousNight} onChange={(event) => setPreviousNight(event.target.value)} />{ascent && <div className="rounded border p-2"><SeverityBadge severity={ascent.severity} /><p className="mt-1">Sleeping elevation gain: {ascent.gainM} m</p><p className="text-muted-foreground">{ascent.message}</p></div>}<Label htmlFor="alt-spo2">Measured SpO2 (%)</Label><Input id="alt-spo2" type="number" value={spo2} onChange={(event) => setSpo2(event.target.value)} />{expected != null && <p>Expected resting SpO2 at your elevation: approximately {expected}%.</p>}{expected == null && <p className="text-muted-foreground">Oxygen check runs elevation-blind: GPS altitude is unavailable, so readings are judged against the sea-level expectation.</p>}{spo2Note && <p className="rounded border border-amber-500/50 p-2 text-muted-foreground">{spo2Note}</p>}{plans && plans.length > 0 && <><p className="font-medium">Acclimatization plan</p><ul className="list-disc pl-4 text-muted-foreground">{plans.map((line) => <li key={line}>{line}</li>)}</ul></>}</div></details>
    <p className="text-[10px] text-muted-foreground">{DISCLAIMER}</p>
  </CardContent></Card>;
}
