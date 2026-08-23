"use client";
import { apiFetch } from "@/lib/api/client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  GUARDIAN_TOKEN_PATTERN,
  type GuardianPublicStatus,
} from "@/lib/guardian/status";

type ViewState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | {
      kind: "ready";
      data: GuardianPublicStatus;
      responseReceivedAt: string;
      connectionFailed: boolean;
    };

function formatTime(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}

function metric(value: number | null | undefined, suffix: string): string {
  return value == null || !Number.isFinite(value) ? "Unknown" : `${Math.round(value)}${suffix}`;
}

function statusCopy(data: GuardianPublicStatus, connectionFailed: boolean) {
  if (data.deadlineState === "overdue") {
    return {
      label: "OVERDUE",
      variant: "destructive" as const,
      title: "Past the agreed overdue time",
      detail: "This does not establish distress. Use the hiker's agreed action plan and other evidence.",
    };
  }
  if (connectionFailed || data.dataState === "cached") {
    return {
      label: "CACHED",
      variant: "secondary" as const,
      title: "Showing an older server update",
      detail: "The hiker's phone has not saved a newer update here. That does not explain why.",
    };
  }
  if (data.dataState === "live") {
    return {
      label: "LIVE",
      variant: "default" as const,
      title: "Recent server update",
      detail: "Saved by the server within the last five minutes. This is not continuous tracking.",
    };
  }
  return {
    label: "UNKNOWN",
    variant: "outline" as const,
    title: "No successful status update yet",
    detail: "The link exists, but no route-status update has been acknowledged by the server.",
  };
}

async function fetchStatus(token: string): Promise<GuardianPublicStatus> {
  const response = await apiFetch("/api/guardian/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "Guardian status is unavailable");
  }
  return await response.json() as GuardianPublicStatus;
}

export function GuardianStatusView() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  async function refresh(nextToken = token) {
    if (!nextToken) return;
    setRefreshing(true);
    try {
      const data = await fetchStatus(nextToken);
      setState({
        kind: "ready",
        data,
        responseReceivedAt: new Date().toISOString(),
        connectionFailed: false,
      });
    } catch (error) {
      setState((current) => current.kind === "ready"
        ? { ...current, connectionFailed: true }
        : {
            kind: "unavailable",
            message: error instanceof Error ? error.message : "Guardian status is unavailable",
          });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (!GUARDIAN_TOKEN_PATTERN.test(fragment)) {
      setState({
        kind: "unavailable",
        message: "This private link is incomplete, expired, or no longer available.",
      });
      return;
    }
    setToken(fragment);
    void refresh(fragment);
    const interval = window.setInterval(() => void refresh(fragment), 60_000);
    return () => window.clearInterval(interval);
    // The token is captured from the fragment once. Fragments never reach the server
    // in an HTTP URL or Referer; only the no-store POST body contains it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.kind === "loading") {
    return <p className="py-16 text-center text-muted-foreground">Checking the private link…</p>;
  }

  if (state.kind === "unavailable") {
    return (
      <Alert variant="destructive" className="mx-auto max-w-xl">
        <ShieldX />
        <AlertTitle>Guardian link unavailable</AlertTitle>
        <AlertDescription>
          {state.message} This does not mean the hiker is in distress. Use the agreed
          check-in plan or contact them directly.
        </AlertDescription>
      </Alert>
    );
  }

  const copy = statusCopy(state.data, state.connectionFailed);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{state.data.routeName}</CardTitle>
              <CardDescription>Private, time-limited Trip Guardian status</CardDescription>
            </div>
            <Badge variant={copy.variant}>{copy.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant={copy.label === "OVERDUE" ? "destructive" : "default"}>
            {copy.label === "LIVE" ? <CheckCircle2 /> : copy.label === "UNKNOWN" ? <AlertTriangle /> : <Clock3 />}
            <AlertTitle>{copy.title}</AlertTitle>
            <AlertDescription>{copy.detail}</AlertDescription>
          </Alert>

          {state.connectionFailed && (
            <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              Refresh failed. This page is showing the response received at {formatTime(state.responseReceivedAt)}.
            </p>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Route progress</dt>
              <dd className="font-medium">{metric(state.data.status?.progressPercent, "%")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Estimated finish</dt>
              <dd className="font-medium">{formatTime(state.data.status?.etaAt ?? null)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Phone battery</dt>
              <dd className="font-medium">{metric(state.data.status?.batteryPercent, "%")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Distance from marked route</dt>
              <dd className="font-medium">{metric(state.data.status?.deviationMeters, " m")}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">Last successful server update</dt>
              <dd className="font-medium">{formatTime(state.data.lastUpdateAt)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">Agreed overdue-action time</dt>
              <dd className="font-medium">{formatTime(state.data.overdueAt)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">Link expires</dt>
              <dd className="font-medium">{formatTime(state.data.expiresAt)}</dd>
            </div>
          </dl>

          <Button type="button" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
            <RefreshCw className={`mr-2 size-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Checking…" : "Check for update"}
          </Button>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Silence, an old update, or an overdue time is not proof of distress. This link
        intentionally omits exact location, ICE details and medical information.
      </p>
    </div>
  );
}
