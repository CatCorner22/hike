"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { KlandagiMascot } from "@/components/brand/klandagi-mascot";
import { getRoutePack } from "@/lib/offline/route-pack";
import { getIceProfile, getOverdueAlarm } from "@/lib/safety/profile";
import type { TrailResearchBrief } from "@/lib/research/schema";
import { PIONEER_ONE_WAY_NOTICE } from "@/lib/pioneer/one-way";
import { PIONEER_DISCLAIMER } from "@/lib/pioneer/prefs";
import {
  pioneerLayerLabel,
  pioneerLiveStatus,
  type PioneerDeployStatus,
  type PioneerFeedbackSource,
} from "@/lib/pioneer/liveStatus";
import {
  gaugesToMood,
  instrumentObservations,
  measureGauges,
  type PioneerGauges,
  type PioneerMood,
} from "@/lib/pioneer/instrument";
import { assemblePioneerSnapshot } from "@/lib/pioneer/snapshot";
import type { PioneerSnapshot } from "@/lib/pioneer/schemas";

interface Observation {
  kind: string;
  say: string;
  why: string;
  question?: string;
  source: string;
  corroboration?: { seen: number; reads: number };
  tentative?: boolean;
}

export interface PioneerAdvisorProps {
  trailName: string;
  osmTags?: Record<string, string> | null;
  brief?: TrailResearchBrief | null;
  packId?: string | null;
  packReady: boolean;
  tripReady: boolean;
  planNotes?: string | null;
  waypointCount?: number;
  plannedDate?: string | null;
}

const OBSERVE_DEBOUNCE_MS = 1200;

function layerToneClass(tone: ReturnType<typeof pioneerLayerLabel>["tone"]): string {
  switch (tone) {
    case "pioneer":
      return "bg-amber-100 text-amber-950 ring-amber-300";
    case "instrument":
      return "bg-emerald-50 text-emerald-900 ring-emerald-300";
    case "reading":
      return "bg-slate-100 text-slate-700 ring-slate-300";
    case "dark":
      return "bg-slate-200 text-slate-700 ring-slate-400";
    default:
      return "bg-white text-slate-600 ring-slate-200 dark:bg-slate-900 dark:text-slate-300";
  }
}

function moodLabel(mood: PioneerMood): string {
  if (mood === "concerned") return "watching gaps";
  if (mood === "thinking") return "reading prep";
  if (mood === "happy") return "prep looks set";
  return "standing by";
}

function GaugeBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const pct = Math.round(Math.min(100, Math.max(0, value * 100)));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            tone === "warn" ? "bg-amber-500" : "bg-emerald-600"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PioneerAdvisor({
  trailName,
  osmTags,
  brief,
  packId,
  packReady,
  tripReady,
  planNotes,
  waypointCount,
  plannedDate,
}: PioneerAdvisorProps) {
  const [snapshot, setSnapshot] = useState<PioneerSnapshot | null>(null);
  const [deploy, setDeploy] = useState<PioneerDeployStatus>("unknown");
  const [pioneerCache, setPioneerCache] = useState<{
    key: string;
    observations: Observation[];
    profile: string | null;
  } | null>(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [observing, setObserving] = useState(false);
  const lastFetched = useRef("");

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    apiFetch("/api/pioneer", { signal: ac.signal })
      .then((response) => response.json())
      .then((data: { enabled?: boolean }) => {
        if (!cancelled) setDeploy(data.enabled ? "on" : "off");
      })
      .catch(() => {
        if (!cancelled && !ac.signal.aborted) setDeploy("unreachable");
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [pack, ice, alarm] = await Promise.all([
        packId ? getRoutePack(packId).catch(() => null) : Promise.resolve(null),
        getIceProfile().catch(() => null),
        getOverdueAlarm().catch(() => null),
      ]);
      if (cancelled || !trailName.trim()) return;
      setSnapshot(assemblePioneerSnapshot({
        trailName,
        osmTags,
        brief,
        pack,
        packReady,
        tripReady,
        profile: ice,
        returnAt: alarm?.returnAt ?? null,
        plan: planNotes !== undefined || waypointCount !== undefined || plannedDate !== undefined
          ? { notes: planNotes ?? null, waypoints: Array.from({ length: waypointCount ?? 0 }), plannedDate: plannedDate ?? null }
          : undefined,
      }));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [trailName, osmTags, brief, packId, packReady, tripReady, planNotes, waypointCount, plannedDate]);

  const gauges: PioneerGauges | null = useMemo(
    () => (snapshot ? measureGauges(snapshot) : null),
    [snapshot],
  );
  const instrument = useMemo(
    () => (snapshot ? instrumentObservations(snapshot) : []),
    [snapshot],
  );
  const snapshotKey = snapshot ? JSON.stringify(snapshot) : "";
  const pioneerActive = deploy === "on" && Boolean(snapshotKey) && pioneerCache?.key === snapshotKey;
  const pioneerObs = pioneerActive ? pioneerCache.observations : [];
  const profile = pioneerActive ? pioneerCache.profile : null;
  const observations: Observation[] = pioneerObs.length > 0 ? pioneerObs : instrument;
  const mood = gauges ? gaugesToMood(gauges, Boolean(snapshot)) : "idle";

  useEffect(() => {
    if (deploy !== "on" || !snapshot) return;
    const key = JSON.stringify(snapshot);
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      if (lastFetched.current === key) return;
      lastFetched.current = key;
      setObserving(true);
      void apiFetch("/api/pioneer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
        signal: ac.signal,
      })
        .then((response) => response.json())
        .then((data: {
          observations?: Observation[];
          unavailable?: boolean;
          profile?: string;
          source?: string;
        }) => {
          if (ac.signal.aborted) return;
          if (data.unavailable) {
            setPioneerCache({ key, observations: [], profile: null });
            return;
          }
          setPioneerCache({
            key,
            observations: Array.isArray(data.observations) ? data.observations : [],
            profile: typeof data.profile === "string" ? data.profile : null,
          });
          setTipIndex(0);
        })
        .catch(() => {
          if (!ac.signal.aborted) setPioneerCache({ key, observations: [], profile: null });
        })
        .finally(() => {
          if (!ac.signal.aborted) setObserving(false);
        });
    }, OBSERVE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [deploy, snapshot]);

  const tip = observations[Math.min(tipIndex, Math.max(0, observations.length - 1))];
  const feedbackSource: PioneerFeedbackSource = pioneerObs.length > 0
    ? "pioneer"
    : instrument.length > 0
      ? "instrument"
      : null;
  const liveStatus = pioneerLiveStatus({
    hasSnapshot: Boolean(snapshot),
    deploy,
    observing,
    feedbackSource,
    observationCount: observations.length,
  });
  const layer = pioneerLayerLabel(feedbackSource, observing, deploy);

  return (
    <section
      id="advisor-pioneer"
      aria-label="Pioneer observational advisor"
      className="select-none rounded-xl bg-gradient-to-br from-amber-50/90 via-card to-emerald-50/40 p-3 ring-1 ring-amber-300/60 dark:from-amber-950/30 dark:via-card dark:to-emerald-950/20"
      onCopy={(event) => event.preventDefault()}
      onCut={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <KlandagiMascot className="h-16 w-16" decorative />
          <div className="absolute -bottom-1 -right-1 rounded bg-amber-900/90 px-1 py-px text-[0.55rem] font-bold text-amber-100">
            observe
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-base font-bold">Pioneer</h3>
            <span
              className={`inline-flex items-center rounded-full px-2 py-px text-[0.6rem] font-bold ring-1 ${layerToneClass(layer.tone)}`}
              title="Which layer is speaking — pioneer model or local instrument gauges"
            >
              {layer.label}
            </span>
            <span className="rounded-full bg-muted px-2 py-px text-[0.6rem] uppercase tracking-wider text-muted-foreground">
              {moodLabel(mood)}
            </span>
          </div>
          <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
            observes · you do not reply
          </p>
          <p className="mt-0.5 text-xs font-medium text-amber-950/80 dark:text-amber-100/80" aria-live="polite">
            {liveStatus}
          </p>
          {profile && profile !== "standard" && (
            <span className="mt-1 inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[0.6rem] font-bold text-rose-900 ring-1 ring-rose-300">
              {profile} read
            </span>
          )}
          <p className="mt-2 text-xs font-medium leading-relaxed text-amber-950/80 dark:text-amber-100/80">
            {PIONEER_ONE_WAY_NOTICE}
          </p>

          {tip ? (
            <div
              className="relative mt-2 overflow-hidden rounded-lg bg-background/90 p-2.5 ring-1 ring-amber-200/80"
              aria-live="polite"
              aria-atomic
            >
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                {tip.kind}
                {feedbackSource === "instrument" && (
                  <span className="ml-1 normal-case text-muted-foreground">· instrument reading</span>
                )}
                {tip.tentative && (
                  <span className="ml-1.5 rounded bg-orange-100 px-1.5 py-px normal-case font-semibold text-orange-900 ring-1 ring-orange-300">
                    Tentative — verify with a land manager
                  </span>
                )}
              </p>
              <p className="text-sm font-medium leading-snug">{tip.say}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{tip.why}</p>
              {tip.question && (
                <p className="mt-1.5 text-sm font-semibold">{tip.question}</p>
              )}
              <p className="mt-1.5 border-t border-amber-100/80 pt-1 text-[0.65rem] text-muted-foreground">
                Source: {tip.source}
                {tip.corroboration && tip.corroboration.reads > 1 && (
                  <span className="ml-2 text-emerald-700 dark:text-emerald-400">
                    · corroborated in {tip.corroboration.seen} of {tip.corroboration.reads} independent reads
                  </span>
                )}
              </p>
              {observations.length > 1 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded text-xs font-medium text-amber-900 underline decoration-dotted underline-offset-2 dark:text-amber-200"
                    onClick={() =>
                      setTipIndex((index) => (index - 1 + observations.length) % observations.length)
                    }
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="rounded text-xs font-medium text-amber-900 underline decoration-dotted underline-offset-2 dark:text-amber-200"
                    onClick={() => setTipIndex((index) => (index + 1) % observations.length)}
                  >
                    Next reading ({(tipIndex % observations.length) + 1} of {observations.length})
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {observing
                ? "Pioneer is reading the prep snapshot…"
                : "Local gauges below are live. Pioneer observations appear when the snapshot settles."}
            </p>
          )}
        </div>
      </div>

      {gauges && (
        <details className="mt-3 border-t border-amber-200/50 pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Drift to a prepared hike
            </h4>
            <span className={`text-[0.65rem] tabular-nums ${
              gauges.onCourse >= 0.75 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-800 dark:text-amber-300"
            }`}
            >
              local gauges · {Math.round(gauges.onCourse * 100)}% on course · open
            </span>
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <GaugeBar label="Offline pack" value={gauges.pack} tone={gauges.pack < 0.5 ? "warn" : "ok"} />
            <GaugeBar label="Research" value={gauges.research} tone={gauges.research < 0.5 ? "warn" : "ok"} />
            <GaugeBar label="Get home" value={gauges.returnHome} tone={gauges.returnHome < 1 ? "warn" : "ok"} />
          </div>
          <p className="mt-2 text-[0.65rem] leading-relaxed text-muted-foreground">
            {PIONEER_DISCLAIMER}
          </p>
        </details>
      )}
    </section>
  );
}
