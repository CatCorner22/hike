"use client";

import { APP_NAME } from "@/lib/brand";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  getIceProfile,
  getOverdueAlarm,
  overdueStatus,
  resolveLocalDateTime,
  type IceProfile,
} from "@/lib/safety/profile";
import { CHECKIN_INTERVALS, getCheckinSettings } from "@/lib/safety/checkin";
import { hikeReadiness, type ReadinessGap } from "@/lib/safety/readiness";
import { persistAndVerifyReadiness } from "@/lib/safety/readiness-persistence";

type ReturnOccurrence = "earlier" | "later" | null;

export function resolveGateReturnTime(
  returnAt: string,
  occurrence: ReturnOccurrence,
  timeZone?: string,
) {
  return returnAt ? resolveLocalDateTime(returnAt, timeZone, occurrence) : null;
}

export function ReadinessGate({
  packReady,
  onReady,
  onProceedAnyway,
}: {
  packReady: boolean;
  onReady: () => void;
  /**
   * Escape hatch. The checklist is pre-trip hygiene, but it was a hard gate on
   * seeing a route pack that is already downloaded and valid. Someone already
   * out, disoriented, on a dying battery with cold hands had to type a name, an
   * ICE contact, a phone number and a return time before any map appeared --
   * exactly the moment they cannot type. Withholding the map cannot make them
   * safer. The missing items stay on screen during navigation instead.
   */
  onProceedAnyway: () => void;
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
  const [missing, setMissing] = useState<ReadinessGap[]>([]);
  const [overdueNote, setOverdueNote] = useState<string | null>(null);
  const [returnOccurrence, setReturnOccurrence] = useState<ReturnOccurrence>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const returnResolution = resolveGateReturnTime(returnAt, returnOccurrence);

  useEffect(() => {
    void (async () => {
      try {
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
          const status = overdueStatus(alarm.returnAt);
          setOverdueNote(status.overdue ? status.label : null);
        } else {
          setOverdueNote(null);
        }
        const result = hikeReadiness({
          packReady,
          profile: p,
          returnAt: alarm?.returnAt ?? null,
        });
        setMissing(result.missing);
        if (result.ok) onReady();
      } catch {
        setSaveError("Saved readiness data could not be opened. Retry saving, or use the explicit skip button to open the map without claiming these details are saved.");
      }
    })();
  }, [packReady, onReady]);

  async function saveAndGo() {
    setSaveError(null);
    const resolved = returnResolution;
    if (returnAt && resolved?.kind !== "resolved") {
      setMissing([
        {
          label: "a planned return time",
          detail: resolved?.message ?? "Planned return time",
        },
      ]);
      // Do not erase a previously armed deadline just because a replacement
      // wall time is ambiguous; that would silently remove the only overdue alarm.
      return;
    }
    const result = hikeReadiness({
      packReady,
      profile,
      returnAt: resolved?.kind === "resolved" ? resolved.value.instant.toISOString() : null,
    });
    setMissing(result.missing);
    if (!result.ok) return;

    setSaving(true);
    const stored = await persistAndVerifyReadiness({
      // Reaching this button means the party-size field was on screen and its
      // value was accepted, which is the difference between a stated 1 and a
      // default nobody was ever shown.
      profile: { ...profile, partySizeConfirmed: true },
      returnTime: resolved?.kind === "resolved" ? resolved.value : null,
      checkin: { enabled: checkinOn, intervalMin: checkinMin },
    });
    setSaving(false);
    if (!stored.ok) {
      setSaveError(stored.message);
      return;
    }
    onReady();
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Pre-hike checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* This used to read "they are what lets someone find you", which is a
              capability claim the software does not have: nothing here ever
              contacts the ICE number. It is validated, printed on the dossier
              and the QR handoff, and dialled by a human — the hiker, or whoever
              finds the phone. The return time arms an alarm on THIS phone. The
              app's own guide has said the true thing all along. */}
          <p className="text-sm text-muted-foreground">
            {APP_NAME} cannot tell anyone you are overdue. The return time sets an
            alarm on this phone only, and the contact details are here for you or
            for whoever reaches you. Before you leave, tell a person your route and
            your return time — that is what actually starts a search. You can still
            open the map without any of this.
          </p>
          {overdueNote && (
            <p className="text-sm font-medium text-destructive">{overdueNote}</p>
          )}
          {missing.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-destructive">
              {missing.map((gap) => (
                <li key={gap.detail}>{gap.detail}</li>
              ))}
            </ul>
          )}
          {saveError && (
            <Alert variant="destructive">
              <AlertTitle>Not saved on this device</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
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
            <Label htmlFor="party-size">How many people, including you</Label>
            <Input
              id="party-size"
              type="number"
              inputMode="numeric"
              min={1}
              value={profile.partySize}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  partySize: Math.max(1, Number(e.target.value) || 1),
                  partySizeConfirmed: true,
                })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Printed on the leave-behind card and the SOS text. Klandagi tracks this phone, not
              each person — it cannot tell anyone if the party splits up.
            </p>
          </div>
          <div>
            <Label htmlFor="return">Return by</Label>
            <Input
              id="return"
              type="datetime-local"
              value={returnAt}
              onChange={(e) => {
                setReturnAt(e.target.value);
                setReturnOccurrence(null);
              }}
            />
          </div>
          {returnResolution?.kind === "ambiguous" && (
            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Repeated clock time — choose the real return instant</legend>
              <p className="text-sm text-muted-foreground">{returnResolution.message}</p>
              {returnResolution.choices.map((choice, index) => {
                const occurrence = index === 0 ? "earlier" : "later";
                return (
                  <label key={choice.instant.toISOString()} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="return-occurrence"
                      checked={returnOccurrence === occurrence}
                      onChange={() => setReturnOccurrence(occurrence)}
                    />
                    {index === 0 ? "First occurrence" : "Second occurrence"} ({choice.utcOffset})
                  </label>
                );
              })}
            </fieldset>
          )}
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
          <Button onClick={() => void saveAndGo()} className="w-full" disabled={!packReady || saving}>
            {saving ? "Saving and checking…" : saveError ? "Retry saving and start" : "Save and start navigation"}
          </Button>
          {/*
            Only offered once the pack is ready. Without a pack there is
            genuinely nothing to display offline, so proceeding would be a lie.
          */}
          {packReady && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={onProceedAnyway}
            >
              Skip saving and show the map
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Skip opens the map already loaded on this screen. Edits on this form will not be saved, and
            navigation will keep showing any stored ICE or deadline details that are missing.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
