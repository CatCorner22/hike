"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrScanner } from "@/components/safety/qr-scanner";
import { formatRangeAzimuth, parseTypedHeading } from "@/lib/safety/landnav";
import { formatUsng } from "@/lib/safety/usng";
import {
  partyPicture,
  triangulateFromBearings,
  type BearingObservation,
  type PartyMember,
} from "@/lib/safety/multi-fix";

/**
 * Positions read off other phones, and what they let you work out together.
 *
 * Two capabilities that only exist once more than one position is on the
 * screen:
 *  - the party picture: range and bearing to each person, how old their fix
 *    is, and whether the group has drifted apart;
 *  - triangulation: several observers each shoot a bearing at the same unknown
 *    (smoke, a signal fire, a shout) and the cut locates it — with the
 *    disagreement between observers surfaced, because that disagreement is the
 *    only evidence that one of the bearings is wrong.
 *
 * The scanned list lives in sessionStorage, not IndexedDB: it is working
 * state for the current outing, and the UI says plainly that it is not a
 * durable record.
 */

const STORAGE_KEY = "klandagi-scanned-positions";

interface ScannedMember extends PartyMember {
  id: string;
  /** True bearing this observer reports to the shared unknown, when given. */
  bearingText: string;
}

function loadMembers(): ScannedMember[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ScannedMember =>
        !!m &&
        typeof m === "object" &&
        Number.isFinite((m as ScannedMember).lat) &&
        Number.isFinite((m as ScannedMember).lng),
    );
  } catch {
    return [];
  }
}

function saveMembers(members: ScannedMember[]): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(members));
  } catch {
    // Storage refused (private mode, quota). The list still works for this
    // screen; it simply will not survive a reload, which the caption says.
  }
}

export function PartyTriangulation({
  lat,
  lng,
  headingTrue,
}: {
  lat?: number | null;
  lng?: number | null;
  /** The reader's own fused heading, offered as their bearing to the unknown. */
  headingTrue?: number | null;
}) {
  const [members, setMembers] = useState<ScannedMember[]>([]);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [myBearing, setMyBearing] = useState("");

  // One ticking clock instead of Date.now() during render: reading the clock
  // in render is impure AND freezes whatever it feeds as soon as the other
  // dependencies stop changing — the bug the navigate HUD already fixed.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const restore = () => setMembers(loadMembers());
    restore();
  }, []);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const update = (next: ScannedMember[]) => {
    setMembers(next);
    saveMembers(next);
  };

  const me = useMemo(
    () =>
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : null,
    [lat, lng],
  );

  const picture = useMemo(
    () => partyPicture(me, members, nowMs || 0),
    [me, members, nowMs],
  );

  const observations = useMemo(() => {
    const list: BearingObservation[] = [];
    const mine = parseTypedHeading(myBearing);
    if (me && mine != null) list.push({ label: "You", lat: me.lat, lng: me.lng, bearingTrue: mine });
    for (const m of members) {
      const bearing = parseTypedHeading(m.bearingText);
      if (bearing != null) list.push({ label: m.label, lat: m.lat, lng: m.lng, bearingTrue: bearing });
    }
    return list;
  }, [me, members, myBearing]);

  const fix = useMemo(() => triangulateFromBearings(observations), [observations]);

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">Other positions &amp; triangulation</p>
        <p className="text-xs text-muted-foreground">
          Scan the position QR on another phone — no signal, app, or pairing needed on
          either side. Scanned positions are snapshots for this trip only; they are not
          saved permanently and they do not track anyone.
        </p>
      </div>

      {scanning ? (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={({ position, raw }) => {
            setScanning(false);
            if (!position) {
              setStatus("That code carried no usable position.");
              return;
            }
            const label =
              position.label ||
              (position.kind === "sar-handoff" ? "Scanned party" : "Scanned position");
            const member: ScannedMember = {
              id: `${Date.now()}-${Math.round(position.lat * 1e5)}-${Math.round(position.lng * 1e5)}`,
              label,
              lat: position.lat,
              lng: position.lng,
              // The fix time the payload itself states — NOT the scan time.
              // A relayed position can be an hour old, and calling the scan
              // moment its age would make every stale fix look fresh.
              atMs: position.fixAtMs,
              provenance: position.provenance,
              bearingText: "",
            };
            update([...members, member]);
            setStatus(
              `Added ${label}${position.provenance ? ` — ${position.provenance}` : ""}. Raw text kept below.`,
            );
            void raw;
          }}
        />
      ) : (
        <Button size="sm" onClick={() => { setStatus(null); setScanning(true); }}>
          Scan a position QR
        </Button>
      )}

      {status && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {status}
        </p>
      )}

      {members.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Scanned positions ({members.length})
          </p>
          {members.map((member) => {
            // Matched by id, never by index: partyPicture drops positions it
            // cannot use, so the two lists can differ in length — indexing
            // would attach one person's bearing input to another person's row.
            const entry = picture.entries.find((candidate) => candidate.id === member.id);
            if (!entry) {
              return (
                <div key={member.id} className="flex items-start justify-between gap-2 rounded border border-destructive/50 p-2 text-xs">
                  <p className="text-destructive">
                    {member.label}: this position is unusable and is not being plotted.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => update(members.filter((m) => m.id !== member.id))}
                  >
                    Remove
                  </Button>
                </div>
              );
            }
            return (
              <div key={member.id} className="space-y-1 rounded border p-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{entry.label}</p>
                    <p className="font-mono">
                      {formatUsng(entry.lat, entry.lng) ??
                        `${entry.lat.toFixed(5)}, ${entry.lng.toFixed(5)}`}
                    </p>
                    <p className="text-muted-foreground">
                      {entry.vector
                        ? formatRangeAzimuth(entry.vector)
                        : "Range and bearing need your own fix."}
                    </p>
                    {entry.provenance && (
                      <p className="text-muted-foreground">{entry.provenance}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => update(members.filter((m) => m.id !== member.id))}
                  >
                    Remove
                  </Button>
                </div>
                <div>
                  <Label htmlFor={`bearing-${member.id}`}>
                    Their bearing to the unknown (° true)
                  </Label>
                  <Input
                    id={`bearing-${member.id}`}
                    inputMode="decimal"
                    placeholder="e.g. 310"
                    value={member.bearingText}
                    onChange={(event) =>
                      update(
                        members.map((m) =>
                          m.id === member.id ? { ...m, bearingText: event.target.value } : m,
                        ),
                      )
                    }
                  />
                </div>
              </div>
            );
          })}
          {picture.warnings.map((warning) => (
            <p
              key={warning}
              className="rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
            >
              {warning}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-1 border-t pt-2">
        <Label htmlFor="my-bearing">Your bearing to the same unknown (° true)</Label>
        <Input
          id="my-bearing"
          inputMode="decimal"
          placeholder={
            headingTrue != null && Number.isFinite(headingTrue)
              ? `e.g. ${Math.round(headingTrue)} (your current heading)`
              : "e.g. 47"
          }
          value={myBearing}
          onChange={(event) => setMyBearing(event.target.value)}
        />
        {headingTrue != null && Number.isFinite(headingTrue) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMyBearing(String(Math.round(headingTrue)))}
          >
            Use current heading ({Math.round(headingTrue)}°)
          </Button>
        )}
      </div>

      {observations.length >= 2 ? (
        fix ? (
          <div className="space-y-1 rounded border p-2 text-xs">
            <p className="font-medium">
              Triangulated point — {fix.observationsUsed} observers, {fix.cuts} cut
              {fix.cuts === 1 ? "" : "s"}
            </p>
            <p className="font-mono">
              {formatUsng(fix.point.lat, fix.point.lng) ??
                `${fix.point.lat.toFixed(5)}, ${fix.point.lng.toFixed(5)}`}
            </p>
            <p className="text-muted-foreground">
              {fix.radiusM != null
                ? `Search radius ${Math.round(fix.radiusM)} m`
                : "Radius could not be quoted"}
              {fix.spreadM != null ? ` · observers agree to ${Math.round(fix.spreadM)} m` : ""}
              {fix.worstCutDeg != null ? ` · worst cut ${Math.round(fix.worstCutDeg)}°` : ""}
            </p>
            {fix.warnings.map((warning) => (
              <p
                key={warning}
                className="rounded border border-amber-500/50 bg-amber-500/10 p-2"
              >
                {warning}
              </p>
            ))}
          </div>
        ) : (
          <p className="rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
            These bearings do not cross anywhere usable — they may be parallel, out of
            range, or pointing away from each other. Re-check the bearings and that they
            are TRUE, not magnetic.
          </p>
        )
      ) : (
        <p className="text-xs text-muted-foreground">
          Enter a bearing from at least two positions to triangulate. Two bearings always
          cross, so a third is what proves the fix.
        </p>
      )}
    </div>
  );
}
