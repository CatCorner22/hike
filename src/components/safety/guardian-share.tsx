"use client";
import { apiFetch } from "@/lib/api/client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyEmergencyInfo } from "@/lib/safety/emergency";
import { safeFilename } from "@/lib/safety/field";
import { saveTextFile } from "@/lib/platform/save-file";
import { shareableOrigin } from "@/lib/api/client";
import type { StoredDeadlineLocal } from "@/lib/safety/deadline-text";
import type { IceProfile } from "@/lib/safety/profile";
import {
  formatLeaveBehindCard,
  type LeaveBehindLocation,
  type LeaveBehindRouteFact,
} from "@/lib/safety/leave-behind";
import { printOrDownloadPlain } from "@/components/safety/print-plain";
import {
  formatGuardianMessage,
  guardianSmsHref,
  type GuardianMessageKind,
} from "@/lib/safety/guardian-message";
import type { PositionSource } from "@/lib/safety/emergency";
import type { GuardianStatusPayload } from "@/lib/guardian/status";

type GuardianShareProps = {
  trailName: string;
  profile: IceProfile;
  returnAt?: string | null;
  /** The stored local form of the deadline. Without it every civilian-facing
      line falls back to UTC, which reads as tomorrow for an evening return. */
  returnLocal?: StoredDeadlineLocal | null;
  geometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  plannedDate?: string | null;
  departureTime?: string | null;
  vehicle?: string | null;
  planNotes?: string | null;
  waypoints?: LeaveBehindLocation[] | null;
  bailouts?: LeaveBehindLocation[] | null;
  routeFacts?: LeaveBehindRouteFact[] | null;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  offTrailM?: number;
  batteryPct?: number | null;
  positionSource?: PositionSource;
  lastUpdateAt?: number | string | null;
  compact?: boolean;
  /** Enables the opt-in server link. Omit on static/leave-behind-only screens. */
  shareKey?: string;
  progressPct?: number | null;
  etaAt?: string | null;
  /** Status writes require a trusted current route fix. */
  canPublishStatus?: boolean;
};

type GuardianLinkControl = {
  shareId: string;
  expiresAt: string;
  lastUpdateAt: string | null;
  autoUpdate: boolean;
  /** Kept only in this browser tab so the user can copy it again. */
  token?: string;
};

function controlStorageKey(shareKey: string) {
  return `klandagi-guardian-control:${shareKey}`;
}

function tokenStorageKey(shareKey: string) {
  return `klandagi-guardian-token:${shareKey}`;
}

function isGuardianControl(value: unknown): value is GuardianLinkControl {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.shareId === "string" &&
    typeof row.expiresAt === "string" &&
    (typeof row.lastUpdateAt === "string" || row.lastUpdateAt === null) &&
    typeof row.autoUpdate === "boolean";
}

export function GuardianShare({
  trailName,
  profile,
  returnAt,
  returnLocal,
  geometry,
  plannedDate,
  departureTime,
  vehicle,
  planNotes,
  waypoints,
  bailouts,
  routeFacts,
  lat,
  lng,
  accuracyM,
  offTrailM,
  batteryPct,
  positionSource,
  lastUpdateAt,
  compact = false,
  shareKey,
  progressPct,
  etaAt,
  canPublishStatus = false,
}: GuardianShareProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [link, setLink] = useState<GuardianLinkControl | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  /** Shown verbatim after a copy, so a link that cannot work is visible rather
      than hidden behind a "copied" toast. */
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkConsent, setLinkConsent] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [linkClock, setLinkClock] = useState(() => Date.now());
  const publishInFlight = useRef(false);
  const linkExpiresAt = linkClock + expiresInHours * 60 * 60 * 1000;
  const returnAtMs = returnAt ? Date.parse(returnAt) : null;
  const expiresBeforeReturn = returnAtMs != null && Number.isFinite(returnAtMs) && returnAtMs > linkExpiresAt;

  function flash(message: string) {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2500);
  }

  async function handOff(text: string, filename: string, preferSms: boolean) {
    if (preferSms) {
      const href = guardianSmsHref(profile.icePhone, text);
      if (href) {
        window.location.href = href;
        flash("Opening messages");
        return;
      }
    }
    const ok = await copyEmergencyInfo(text);
    if (ok) {
      flash("Copied");
      return;
    }
    flash((await saveTextFile(filename, text, "text/plain")) ? "Downloaded" : "Could not save");
  }

  function message(kind: GuardianMessageKind) {
    return formatGuardianMessage({
      kind,
      trailName,
      profile,
      returnAt,
      returnLocal,
      lat,
      lng,
      accuracyM,
      offTrailM,
      batteryPct,
      positionSource,
      lastUpdateAt,
    });
  }

  const publishPayload = useMemo<GuardianStatusPayload | null>(() => {
    if (!canPublishStatus) return null;
    const next: GuardianStatusPayload = {};
    if (progressPct != null && Number.isFinite(progressPct)) {
      next.progressPercent = Math.max(0, Math.min(100, progressPct));
    }
    if (etaAt && Number.isFinite(Date.parse(etaAt))) next.etaAt = etaAt;
    if (batteryPct != null && Number.isFinite(batteryPct)) {
      next.batteryPercent = Math.max(0, Math.min(100, batteryPct));
    }
    if (offTrailM != null && Number.isFinite(offTrailM)) {
      next.deviationMeters = Math.max(0, offTrailM);
    }
    return Object.keys(next).length ? next : null;
  }, [batteryPct, canPublishStatus, etaAt, offTrailM, progressPct]);

  function persistControl(next: GuardianLinkControl | null) {
    setLink(next);
    if (!shareKey) return;
    try {
      if (next) {
        const durableControl = {
          shareId: next.shareId,
          expiresAt: next.expiresAt,
          lastUpdateAt: next.lastUpdateAt,
          autoUpdate: next.autoUpdate,
        };
        localStorage.setItem(controlStorageKey(shareKey), JSON.stringify(durableControl));
        if (next.token) sessionStorage.setItem(tokenStorageKey(shareKey), next.token);
      } else {
        localStorage.removeItem(controlStorageKey(shareKey));
        sessionStorage.removeItem(tokenStorageKey(shareKey));
      }
    } catch {
      setLinkNotice("This browser could not remember the link controls. Keep this tab open if you need to revoke it.");
    }
  }

  useEffect(() => {
    if (!shareKey) return;
    let cancelled = false;
    try {
      const raw = localStorage.getItem(controlStorageKey(shareKey));
      const restored: unknown = raw ? JSON.parse(raw) : null;
      if (!isGuardianControl(restored)) return;
      const token = sessionStorage.getItem(tokenStorageKey(shareKey)) ?? undefined;
      void apiFetch(`/api/guardian/${encodeURIComponent(restored.shareId)}`, {
        cache: "no-store",
      }).then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          if (response.status === 404) persistControl(null);
          else setLinkNotice("Could not verify the saved link controls. No status was sent.");
          return;
        }
        const body = await response.json() as {
          shareId: string;
          expiresAt: string;
          revokedAt: string | null;
          lastUpdateAt: string | null;
        };
        if (body.revokedAt || Date.parse(body.expiresAt) <= Date.now()) {
          persistControl(null);
          return;
        }
        persistControl({
          shareId: body.shareId,
          expiresAt: body.expiresAt,
          lastUpdateAt: body.lastUpdateAt,
          autoUpdate: restored.autoUpdate,
          token,
        });
      }).catch(() => {
        if (!cancelled) setLinkNotice("Could not verify the saved link controls. No status was sent.");
      });
    } catch {
      queueMicrotask(() => persistControl(null));
    }
    return () => {
      cancelled = true;
    };
    // The route key is the identity boundary. Persisting happens only in explicit
    // actions or after this one owner-authenticated readback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareKey]);

  async function publishStatus(control = link, quiet = false) {
    if (!control || !publishPayload || publishInFlight.current) return;
    publishInFlight.current = true;
    if (!quiet) setLinkBusy(true);
    try {
      const response = await apiFetch(`/api/guardian/${encodeURIComponent(control.shareId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "update", status: publishPayload }),
      });
      const body = await response.json().catch(() => null) as {
        acknowledged?: boolean;
        lastUpdateAt?: string | null;
        error?: string;
      } | null;
      if (!response.ok || body?.acknowledged !== true || !body.lastUpdateAt) {
        throw new Error(body?.error || "Status was not saved");
      }
      persistControl({ ...control, lastUpdateAt: body.lastUpdateAt });
      setLinkNotice(`Saved to server at ${new Date(body.lastUpdateAt).toLocaleTimeString()}.`);
    } catch (error) {
      setLinkNotice(
        `${error instanceof Error ? error.message : "Status was not saved"}. The link still shows its last successful update.`,
      );
    } finally {
      publishInFlight.current = false;
      if (!quiet) setLinkBusy(false);
    }
  }

  useEffect(() => {
    if (!link?.autoUpdate || !publishPayload) return;
    const tick = () => {
      const lastAcknowledged = link.lastUpdateAt ? Date.parse(link.lastUpdateAt) : 0;
      if (!Number.isFinite(lastAcknowledged) || Date.now() - lastAcknowledged >= 4.5 * 60 * 1000) {
        void publishStatus(link, true);
      }
    };
    tick();
    const interval = window.setInterval(tick, 60_000);
    return () => window.clearInterval(interval);
    // Payload changes with GPS. The one-minute timer reads the render's latest payload
    // after each acknowledged update changes `link`, without posting on every GPS fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.shareId, link?.lastUpdateAt, link?.autoUpdate, publishPayload]);

  async function copyPrivateLink(control: GuardianLinkControl) {
    if (!control.token) {
      setLinkNotice("The secret link left this browser tab. Revoke this link and create a new one to share again.");
      return;
    }
    // NOT window.location.origin. In the iOS shell that is capacitor://localhost,
    // which produces a link nobody else can open — while the sender's own tap
    // works, because the shell bundles /guardian/index.html. A dead link that
    // self-verifies is worse than no link.
    const origin = shareableOrigin();
    if (!origin) {
      setLinkNotice(
        "This build has no public address to share from, so the link would not open on anyone else's phone. Set NEXT_PUBLIC_API_BASE to the deployed site and rebuild.",
      );
      return;
    }
    const privateUrl = `${origin}/guardian#${control.token}`;
    setLinkUrl(privateUrl);
    const copied = await copyEmergencyInfo(privateUrl);
    if (copied) {
      setLinkNotice("Private link copied.");
      return;
    }
    // The token lives only in this tab; if it reaches neither the clipboard nor
    // a file, saying it was saved would lose it silently.
    const saved = await saveTextFile(
      `${safeFilename(trailName)}-guardian-link.txt`,
      privateUrl,
      "text/plain",
    );
    setLinkNotice(
      saved
        ? "Private link downloaded."
        : "Could not copy or save the private link — revoke it and create a new one.",
    );
  }

  async function createPrivateLink() {
    if (!shareKey || !linkConsent) return;
    setLinkBusy(true);
    setLinkNotice(null);
    try {
      const response = await apiFetch("/api/guardian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          routeName: trailName,
          overdueAt: returnAt ?? null,
          expiresInHours,
          ...(publishPayload ? { status: publishPayload } : {}),
        }),
      });
      const body = await response.json().catch(() => null) as {
        acknowledged?: boolean;
        shareId?: string;
        token?: string;
        expiresAt?: string;
        lastUpdateAt?: string | null;
        error?: string;
      } | null;
      if (
        !response.ok ||
        body?.acknowledged !== true ||
        !body.shareId ||
        !body.token ||
        !body.expiresAt
      ) throw new Error(body?.error || "Guardian link was not saved");
      const control: GuardianLinkControl = {
        shareId: body.shareId,
        token: body.token,
        expiresAt: body.expiresAt,
        lastUpdateAt: body.lastUpdateAt ?? null,
        autoUpdate: true,
      };
      persistControl(control);
      await copyPrivateLink(control);
      setLinkNotice(
        `Server confirmed the private link${body.lastUpdateAt ? " and current status" : ""}; link copied.`,
      );
    } catch (error) {
      setLinkNotice(
        `${error instanceof Error ? error.message : "Guardian link was not saved"}. No share link is active on this screen.`,
      );
    } finally {
      setLinkBusy(false);
    }
  }

  async function revokePrivateLink() {
    if (!link) return;
    setLinkBusy(true);
    setLinkNotice(null);
    try {
      const response = await apiFetch(`/api/guardian/${encodeURIComponent(link.shareId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "revoke" }),
      });
      const body = await response.json().catch(() => null) as {
        acknowledged?: boolean;
        error?: string;
      } | null;
      if (!response.ok || body?.acknowledged !== true) {
        throw new Error(body?.error || "Revocation was not confirmed");
      }
      persistControl(null);
      setLinkNotice("Server confirmed revocation. The private link no longer works.");
    } catch (error) {
      setLinkNotice(
        `${error instanceof Error ? error.message : "Revocation was not confirmed"}. Treat the link as active and retry when online.`,
      );
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className={compact ? "min-h-11" : undefined}
          onClick={async () => {
            const text = formatLeaveBehindCard({
              trailName,
              profile,
              returnAt,
              returnLocal,
              geometry,
              plannedDate,
              departureTime,
              vehicle,
              notes: planNotes,
              waypoints,
              bailouts,
              routeFacts,
            });
            const outcome = await printOrDownloadPlain(
              {
                title: `${trailName} leave-behind`,
                body: text,
                filename: `${safeFilename(trailName)}-leave-behind.txt`,
              },
              { download: saveTextFile },
            );
            flash(
              outcome === "printed"
                ? "Print dialog opened"
                : outcome === "downloaded"
                  ? "Popup blocked; downloaded text"
                  : "Could not print or save the leave-behind",
            );
          }}
        >
          Print leave-behind
        </Button>
        <Button
          type="button"
          variant="outline"
          className={compact ? "min-h-11" : undefined}
          onClick={() => void handOff(message("departing"), `${safeFilename(trailName)}-guardian.txt`, true)}
        >
          Text: departing
        </Button>
        <Button
          type="button"
          variant="outline"
          className={compact ? "min-h-11" : undefined}
          onClick={() => void handOff(message("ok"), `${safeFilename(trailName)}-guardian.txt`, true)}
        >
          Text: I&apos;m OK
        </Button>
        <Button
          type="button"
          variant="secondary"
          className={compact ? "min-h-11" : undefined}
          onClick={() => void handOff(message("overdue"), `${safeFilename(trailName)}-guardian.txt`, true)}
        >
          Text: overdue notice
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {status ??
          "Leave-behind is for the fridge or glovebox. Guardian texts never claim that silence means distress."}
      </p>

      {shareKey && (
        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Private Guardian link</p>
            <p className="text-xs text-muted-foreground">
              Shares route, progress, pace-based ETA, battery and distance from the marked route.
              It never shares exact GPS, ICE or medical details.
            </p>
          </div>

          {!link ? (
            <>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={linkConsent}
                  onChange={(event) => setLinkConsent(event.target.checked)}
                />
                <span>
                  I want this phone to create a link and update it when online. Anyone
                  with the link can read it until I revoke it or it expires.
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                {[12, 24, 48, 72].map((hours) => (
                  <Button
                    key={hours}
                    type="button"
                    size="sm"
                    variant={expiresInHours === hours ? "default" : "outline"}
                    onClick={() => {
                      setExpiresInHours(hours);
                      setLinkClock(Date.now());
                    }}
                  >
                    {hours} hours
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                disabled={!linkConsent || linkBusy || expiresBeforeReturn}
                onClick={() => void createPrivateLink()}
              >
                {linkBusy ? "Saving link…" : "Create and copy private link"}
              </Button>
              {expiresBeforeReturn && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Choose a longer link. It must remain active through the agreed overdue time.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-xs">
                Link expires {new Date(link.expiresAt).toLocaleString()} · Last successful
                server update {link.lastUpdateAt ? new Date(link.lastUpdateAt).toLocaleString() : "none"}
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={link.autoUpdate}
                  onChange={(event) => persistControl({ ...link, autoUpdate: event.target.checked })}
                />
                Update this link about every five minutes when this screen has live route progress
              </label>
              {!canPublishStatus && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  No live trusted route fix. The link keeps its last acknowledged update.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {link.token && (
                  <Button type="button" variant="outline" disabled={linkBusy} onClick={() => void copyPrivateLink(link)}>
                    Copy link
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={linkBusy || !publishPayload}
                  onClick={() => void publishStatus()}
                >
                  {linkBusy ? "Saving…" : "Update link now"}
                </Button>
                <Button type="button" variant="destructive" disabled={linkBusy} onClick={() => void revokePrivateLink()}>
                  Revoke link
                </Button>
              </div>
            </>
          )}

          {linkUrl && (
            <p className="text-xs break-all text-muted-foreground">
              Link: <code>{linkUrl}</code>
            </p>
          )}
          {linkNotice && (
            <p className="text-xs" role="status" aria-live="polite">{linkNotice}</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            “Live” means the server acknowledged an update within five minutes, not continuous tracking.
            Silence or overdue never means distress by itself.
          </p>
        </div>
      )}
    </div>
  );
}
