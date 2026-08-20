"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SeverityBadge } from "@/components/safety/severity-badge";
import { clearTourniquetRecord, getTourniquetRecord, setTourniquetRecord, type TourniquetRecord } from "@/lib/safety/tq-store";
import { DISCLAIMER, casualtyCard, chestSealGuidance, formatTourniquetMark, hemorrhageAction, hypothermiaWrapSteps, marchPawsSteps, shockAssessment, tensionPneumothoraxSigns, tourniquetStatus, triageCategory } from "@/lib/safety/tccc";

function copyText(text: string) { void navigator.clipboard?.writeText(text); }

export function TcccSection() {
  const [record, setRecord] = useState<TourniquetRecord | null>(null);
  const [now, setNow] = useState(0);
  const [bleeding, setBleeding] = useState<"spurting" | "steady" | "oozing">("steady");
  const [site, setSite] = useState<"limb" | "junctional" | "torso" | "neck">("limb");
  const [pulse, setPulse] = useState(true); const [altered, setAltered] = useState(false);
  const [walking, setWalking] = useState(false); const [breathing, setBreathing] = useState(true); const [obeys, setObeys] = useState(true);
  const [name, setName] = useState(""); const [mechanism, setMechanism] = useState(""); const [injuries, setInjuries] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const saved = await getTourniquetRecord();
      if (!cancelled) {
        setRecord(saved);
        setNow(Date.now());
      }
    }
    void load(); const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);
  const tq = record ? tourniquetStatus(Date.parse(record.appliedAt), now) : null;
  const bleed = hemorrhageAction({ bleeding, site }); const shock = shockAssessment({ radialPulsePresent: pulse, alteredMental: altered });
  const triage = triageCategory({ walking, breathing, radialPulse: pulse, obeysCommands: obeys });
  const card = useMemo(() => casualtyCard({ name, time: record ? formatTourniquetMark(new Date(record.appliedAt), record.limb) ?? undefined : undefined, mechanism, injuries, treatments: [], tourniquets: record ? [{ limb: record.limb, time: record.appliedAt }] : [] }), [name, record, mechanism, injuries]);
  async function startTq() { const next = { appliedAt: new Date().toISOString(), limb: "limb not entered" }; await setTourniquetRecord(next); setRecord(next); setNow(Date.now()); }
  return <Card size="sm"><CardHeader><CardTitle className="flex items-center justify-between">TCCC / trauma <span className="text-xs font-normal text-muted-foreground">MARCH-PAWS</span></CardTitle></CardHeader><CardContent className="space-y-3 text-xs">
    <details><summary className="cursor-pointer font-medium text-foreground">MARCH-PAWS walkthrough</summary><div className="mt-2 space-y-2">{marchPawsSteps().map((step) => <div key={`${step.letter}-${step.name}`}><p className="font-medium">{step.letter} — {step.name}</p><ul className="list-disc pl-4 text-muted-foreground">{step.checks.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div></details>
    <Separator />
    <div className="space-y-2"><p className="font-medium">Hemorrhage decision</p><div className="grid grid-cols-2 gap-2"><div><Label htmlFor="tccc-bleeding">Bleeding</Label><Select value={bleeding} onValueChange={(value) => setBleeding(value as typeof bleeding)}><SelectTrigger id="tccc-bleeding"><SelectValue /></SelectTrigger><SelectContent>{["spurting","steady","oozing"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="tccc-site">Site</Label><Select value={site} onValueChange={(value) => setSite(value as typeof site)}><SelectTrigger id="tccc-site"><SelectValue /></SelectTrigger><SelectContent>{["limb","junctional","torso","neck"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div></div>{bleed && <div className="rounded border p-2"><SeverityBadge severity={bleed.severity} /><ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">{bleed.actions.map((line) => <li key={line}>{line}</li>)}</ul></div>}</div>
    <details><summary className="cursor-pointer font-medium text-foreground">Tourniquet clock</summary><div className="mt-2 space-y-2">{record ? <><p>Applied limb: <strong>{record.limb}</strong> · mark: {formatTourniquetMark(new Date(record.appliedAt), record.limb)}</p><Label htmlFor="tccc-limb">Limb</Label><Input id="tccc-limb" value={record.limb} onChange={(event) => { const next = { ...record, limb: event.target.value }; setRecord(next); void setTourniquetRecord(next); }} />{tq && <div className="rounded border p-2"><SeverityBadge severity={tq.severity} /><p className="mt-1">Elapsed: {tq.minutes} min</p><p className="text-muted-foreground">{tq.message}</p></div>}<Button size="sm" variant="outline" onClick={() => { void clearTourniquetRecord(); setRecord(null); }}>Clear clock</Button></> : <Button size="sm" onClick={() => void startTq()}>Start tourniquet clock</Button>}<p className="text-muted-foreground">Stored on this device; update the limb and mark the application time for handoff.</p></div></details>
    <details><summary className="cursor-pointer font-medium text-foreground">Shock and START triage</summary><div className="mt-2 space-y-2"><div className="grid grid-cols-2 gap-2">{[["tccc-pulse","Radial pulse present",pulse,setPulse],["tccc-altered","Altered mental status",altered,setAltered],["tccc-walking","Walking",walking,setWalking],["tccc-breathing","Breathing",breathing,setBreathing],["tccc-obeys","Obeys commands",obeys,setObeys]] .map(([id,label,checked,setter]) => <div key={String(id)} className="flex items-center gap-1"><input id={String(id)} type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} /><Label htmlFor={String(id)}>{String(label)}</Label></div>)}</div>{shock && <div className="rounded border p-2"><SeverityBadge severity={shock.severity} /><p className="mt-1 font-medium">{shock.label}</p><ul className="list-disc pl-4 text-muted-foreground">{shock.actions.map((line) => <li key={line}>{line}</li>)}</ul></div>}<div className="rounded border p-2"><p className="font-medium">Triage: {triage.label}</p><p className="text-muted-foreground">{triage.reasoning}</p></div></div></details>
    <details><summary className="cursor-pointer font-medium text-foreground">Chest and hypothermia guidance</summary><div className="mt-2 space-y-2 text-muted-foreground"><p className="font-medium text-foreground">Worsening chest-trauma signs</p><ul className="list-disc pl-4">{tensionPneumothoraxSigns().map((line) => <li key={line}>{line}</li>)}</ul><p className="font-medium text-foreground">Chest seal</p><ul className="list-disc pl-4">{chestSealGuidance().map((line) => <li key={line}>{line}</li>)}</ul><p className="font-medium text-foreground">Hypothermia wrap</p><ul className="list-disc pl-4">{hypothermiaWrapSteps().map((line) => <li key={line}>{line}</li>)}</ul></div></details>
    <details><summary className="cursor-pointer font-medium text-foreground">Casualty card</summary><div className="mt-2 space-y-2"><Label htmlFor="tccc-name">Name</Label><Input id="tccc-name" value={name} onChange={(event) => setName(event.target.value)} /><Label htmlFor="tccc-mechanism">Mechanism</Label><Input id="tccc-mechanism" value={mechanism} onChange={(event) => setMechanism(event.target.value)} /><Label htmlFor="tccc-injuries">Injuries</Label><Input id="tccc-injuries" value={injuries} onChange={(event) => setInjuries(event.target.value)} /><pre className="whitespace-pre-wrap rounded bg-muted p-2 text-[10px]">{card}</pre><Button size="sm" variant="outline" onClick={() => copyText(card)}><Copy className="size-3" /> Copy casualty card</Button></div></details>
    <p className="text-[10px] text-muted-foreground">{DISCLAIMER}</p>
  </CardContent></Card>;
}
