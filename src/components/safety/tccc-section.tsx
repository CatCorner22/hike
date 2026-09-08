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
import { DISCLAIMER, casualtyCard, chestSealGuidance, formatTourniquetMark, formatZulu, hemorrhageAction, hypothermiaWrapSteps, marchPawsSteps, shiftTourniquetApplied, shockAssessment, tensionPneumothoraxSigns, tourniquetStatus, triageCategory } from "@/lib/safety/tccc";

function copyText(text: string) { void navigator.clipboard?.writeText(text); }

export function TcccSection() {
  const [record, setRecord] = useState<TourniquetRecord | null>(null);
  const [now, setNow] = useState(0);
  const [bleeding, setBleeding] = useState<"spurting" | "steady" | "oozing">("steady");
  const [site, setSite] = useState<"limb" | "junctional" | "torso" | "neck">("limb");
  const [pulse, setPulse] = useState(true); const [altered, setAltered] = useState(false);
  const [walking, setWalking] = useState(false); const [breathing, setBreathing] = useState(true); const [obeys, setObeys] = useState(true); const [respRate, setRespRate] = useState("");
  const [name, setName] = useState(""); const [mechanism, setMechanism] = useState(""); const [injuries, setInjuries] = useState("");
  // Every conversion precondition starts unconfirmed. Undoing a hemorrhage
  // control is a deliberate act, so the app asks the rescuer to assert each
  // condition rather than assuming any of them.
  const [evacDelayed, setEvacDelayed] = useState(false);
  const [notInShock, setNotInShock] = useState(false);
  const [notAmputation, setNotAmputation] = useState(false);
  const [woundWatcher, setWoundWatcher] = useState(false);
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
  const tq = record
    ? tourniquetStatus(Date.parse(record.appliedAt), now, {
        // An unchecked box means "not confirmed", never "confirmed false". A box
        // nobody has touched must not put the words "this tourniquet is
        // controlling an amputation" on the screen.
        evacuationDelayed: evacDelayed ? true : undefined,
        inShock: notInShock ? false : undefined,
        amputation: notAmputation ? false : undefined,
        alone: woundWatcher ? false : undefined,
      })
    : null;
  const bleed = hemorrhageAction({ bleeding, site }); const shock = shockAssessment({ radialPulsePresent: pulse, alteredMental: altered });
  const respRateValue = respRate.trim() === "" ? undefined : Number(respRate);
  const triage = triageCategory({ walking, breathing, radialPulse: pulse, obeysCommands: obeys, respiratoryRate: respRateValue });
  const card = useMemo(
    () =>
      casualtyCard({
        name,
        time: record ? (formatTourniquetMark(new Date(record.appliedAt), record.limb) ?? undefined) : undefined,
        mechanism,
        injuries,
        treatments: [],
        // The time is the part a receiving medic needs most, so a tourniquet with
        // no limb recorded still appears -- it just says so instead of inventing one.
        tourniquets: record
          ? [{ limb: record.limb.trim() === "" ? "LIMB NOT RECORDED" : record.limb, time: record.appliedAt }]
          : [],
      }),
    [name, record, mechanism, injuries],
  );
  async function startTq() {
    // Empty, not a placeholder string: "limb not entered" was being uppercased
    // into "TQ LIMB NOT ENTERED 1603Z" -- a mark meant to be written on the
    // casualty, asserting a limb nobody had recorded. formatTourniquetMark
    // returns null for an empty limb, so no mark exists until one is entered.
    const next = { appliedAt: new Date().toISOString(), limb: "" };
    await setTourniquetRecord(next);
    setRecord(next);
    setNow(Date.now());
  }
  async function shiftApplied(deltaMinutes: number) {
    if (!record) return;
    const next = shiftTourniquetApplied(Date.parse(record.appliedAt), deltaMinutes);
    if (next === null) return;
    const updated = { ...record, appliedAt: new Date(next).toISOString() };
    await setTourniquetRecord(updated);
    // No need to re-read the wall clock: elapsed time is now minus applied, and
    // it is the applied end that just moved. The 30 s tick keeps `now` current.
    setRecord(updated);
  }
  return <Card size="sm"><CardHeader><CardTitle className="flex items-center justify-between">TCCC / trauma <span className="text-xs font-normal text-muted-foreground">MARCH-PAWS</span></CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    <details open><summary className="cursor-pointer font-medium text-foreground">MARCH-PAWS walkthrough</summary><div className="mt-2 space-y-2">{marchPawsSteps().map((step) => <div key={`${step.letter}-${step.name}`}><p className="font-medium">{step.letter} — {step.name}</p><ul className="list-disc pl-4 text-muted-foreground">{step.checks.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div></details>
    <Separator />
    <div className="space-y-2"><p className="font-medium">Hemorrhage decision</p><p className="rounded border border-destructive/40 bg-destructive/5 p-2 font-medium text-foreground">Life-threatening limb bleeding: tourniquet high and tight, 5–8 cm above the wound and not over a joint, tighten until the bleeding stops, then start the clock below. Junctional or torso: pack the wound and hold hard pressure. Do this before answering anything on this screen.</p><div className="grid grid-cols-2 gap-2"><div><Label htmlFor="tccc-bleeding">Bleeding</Label><Select value={bleeding} onValueChange={(value) => setBleeding(value as typeof bleeding)}><SelectTrigger id="tccc-bleeding"><SelectValue /></SelectTrigger><SelectContent>{["spurting","steady","oozing"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="tccc-site">Site</Label><Select value={site} onValueChange={(value) => setSite(value as typeof site)}><SelectTrigger id="tccc-site"><SelectValue /></SelectTrigger><SelectContent>{["limb","junctional","torso","neck"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div></div>{bleed && <div className="rounded border p-2"><SeverityBadge severity={bleed.severity} /><ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">{bleed.actions.map((line) => <li key={line}>{line}</li>)}</ul></div>}</div>
    <details open><summary className="cursor-pointer font-medium text-foreground">Tourniquet clock</summary><div className="mt-2 space-y-2">
      {record ? <>
        <p>Applied limb: <strong>{record.limb.trim() === "" ? "not recorded" : record.limb}</strong> · mark: {formatTourniquetMark(new Date(record.appliedAt), record.limb) ?? <span className="text-muted-foreground">enter the limb to produce a mark</span>}</p>
        <Label htmlFor="tccc-limb">Limb</Label>
        <Input id="tccc-limb" placeholder="e.g. right thigh" value={record.limb} onChange={(event) => { const next = { ...record, limb: event.target.value }; setRecord(next); void setTourniquetRecord(next); }} />
        <div className="space-y-1">
          <p className="font-medium">Applied at {formatZulu(Date.parse(record.appliedAt))}</p>
          <p className="text-muted-foreground">If it went on before you reached the phone, correct the time — the 2 h and 6 h decisions are counted from it.</p>
          <div className="flex flex-wrap gap-1">
            {[-60, -15, -5, 5].map((delta) => (
              <Button key={delta} size="sm" variant="outline" onClick={() => void shiftApplied(delta)}>
                {delta > 0 ? `+${delta}` : delta} min
              </Button>
            ))}
          </div>
        </div>
        {tq ? <div className="rounded border p-2">
          <SeverityBadge severity={tq.severity} />
          <p className="mt-1">Elapsed: {tq.minutes} min · 2 h at {tq.twoHourMark} · 6 h at {tq.sixHourMark}</p>
          <p className="text-muted-foreground">{tq.message}</p>
          {tq.conversionBlockers.length > 0 && <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">{tq.conversionBlockers.map((line) => <li key={line}>{line}</li>)}</ul>}
        </div> : <p className="rounded border p-2 text-muted-foreground">The recorded application time is in the future or unreadable, so no elapsed time can be shown. Check the device clock, or clear and restart the clock.</p>}
        <details><summary className="cursor-pointer font-medium text-foreground">Considering conversion to a pressure dressing</summary><div className="mt-2 space-y-2">
          <p className="text-muted-foreground">Conversion is only ever considered when every one of these is true. Confirm what you have actually checked; leave the rest alone.</p>
          <div className="space-y-1">
            {([
              ["tq-evac", "Evacuation is more than 2 h away", evacDelayed, setEvacDelayed],
              ["tq-shock", "Casualty is not in shock", notInShock, setNotInShock],
              ["tq-amp", "This is not an amputation", notAmputation, setNotAmputation],
              ["tq-watch", "Someone can watch the wound continuously", woundWatcher, setWoundWatcher],
            ] as const).map(([id, label, checked, setter]) => (
              <div key={id} className="flex items-center gap-1">
                <input id={id} type="checkbox" checked={checked} onChange={(event) => setter(event.target.checked)} />
                <Label htmlFor={id}>{label}</Label>
              </div>
            ))}
          </div>
        </div></details>
        <Button size="sm" variant="outline" onClick={() => { void clearTourniquetRecord(); setRecord(null); }}>Clear clock</Button>
      </> : <Button size="sm" onClick={() => void startTq()}>Start tourniquet clock</Button>}
      <p className="text-muted-foreground">Stored on this device. Write the limb and time on the casualty as well — a phone is not a mark.</p>
    </div></details>
    <details><summary className="cursor-pointer font-medium text-foreground">Shock and START triage</summary><div className="mt-2 space-y-2"><div className="grid grid-cols-2 gap-2">{[["tccc-pulse","Radial pulse present",pulse,setPulse],["tccc-altered","Altered mental status",altered,setAltered],["tccc-walking","Walking",walking,setWalking],["tccc-breathing","Breathing",breathing,setBreathing],["tccc-obeys","Obeys commands",obeys,setObeys]] .map(([id,label,checked,setter]) => <div key={String(id)} className="flex items-center gap-1"><input id={String(id)} type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} /><Label htmlFor={String(id)}>{String(label)}</Label></div>)}</div><div><Label htmlFor="tccc-resp">Respiratory rate (breaths/min)</Label><Input id="tccc-resp" type="number" inputMode="numeric" placeholder="count for 15 s x 4" value={respRate} onChange={(event) => setRespRate(event.target.value)} /><p className="text-muted-foreground">Over 30 is an immediate (red) criterion in START.</p></div>{shock && <div className="rounded border p-2"><SeverityBadge severity={shock.severity} /><p className="mt-1 font-medium">{shock.label}</p><ul className="list-disc pl-4 text-muted-foreground">{shock.actions.map((line) => <li key={line}>{line}</li>)}</ul></div>}<div className="rounded border p-2"><p className="font-medium">Triage: {triage.label}</p><p className="text-muted-foreground">{triage.reasoning}</p></div></div></details>
    <details><summary className="cursor-pointer font-medium text-foreground">Chest and hypothermia guidance</summary><div className="mt-2 space-y-2 text-muted-foreground"><p className="font-medium text-foreground">Worsening chest-trauma signs</p><ul className="list-disc pl-4">{tensionPneumothoraxSigns().map((line) => <li key={line}>{line}</li>)}</ul><p className="font-medium text-foreground">Chest seal</p><ul className="list-disc pl-4">{chestSealGuidance().map((line) => <li key={line}>{line}</li>)}</ul><p className="font-medium text-foreground">Hypothermia wrap</p><ul className="list-disc pl-4">{hypothermiaWrapSteps().map((line) => <li key={line}>{line}</li>)}</ul></div></details>
    <details><summary className="cursor-pointer font-medium text-foreground">Casualty card</summary><div className="mt-2 space-y-2"><Label htmlFor="tccc-name">Name</Label><Input id="tccc-name" value={name} onChange={(event) => setName(event.target.value)} /><Label htmlFor="tccc-mechanism">Mechanism</Label><Input id="tccc-mechanism" value={mechanism} onChange={(event) => setMechanism(event.target.value)} /><Label htmlFor="tccc-injuries">Injuries</Label><Input id="tccc-injuries" value={injuries} onChange={(event) => setInjuries(event.target.value)} /><pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">{card}</pre><Button size="sm" variant="outline" onClick={() => copyText(card)}><Copy className="size-3" /> Copy casualty card</Button></div></details>
    <p className="text-xs text-muted-foreground">{DISCLAIMER}</p>
  </CardContent></Card>;
}
