"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import { saveTextFile } from "@/lib/platform/save-file";

/**
 * Take a copy of everything on the server.
 *
 * The saved-routes list above this is about what lives on the phone. This is
 * the other half: the plans and the finished hikes that live in the deployment's
 * database, which on a personal deployment is one container away from being
 * gone. There was no way to take a copy of it at all.
 *
 * Honest about what it is. Nothing reads this file back in, and saying so is
 * more useful than a "Restore" button that does not exist.
 */
export function AccountBackup() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function download() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const response = await apiFetch("/api/export");
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error
            ?? (response.status === 503
              ? "This deployment has no database, so there is nothing on the server to back up."
              : `The server refused the export (${response.status}).`),
        );
      }
      const text = await response.text();
      const stamp = new Date().toISOString().slice(0, 10);
      const saved = await saveTextFile(
        `klandagi-backup-${stamp}.json`,
        text,
        "application/json",
      );
      const parsed = JSON.parse(text) as {
        plans?: unknown[];
        activities?: unknown[];
        truncated?: { activityIds?: string[] };
      };
      const counts =
        `${parsed.plans?.length ?? 0} trip${parsed.plans?.length === 1 ? "" : "s"}, `
        + `${parsed.activities?.length ?? 0} recorded hike${parsed.activities?.length === 1 ? "" : "s"}`;
      setStatus(
        saved
          ? `Saved — ${counts}.${
              parsed.truncated?.activityIds?.length
                ? " The raw fix log was cut short for some hikes; their tracks are complete."
                : ""
            }`
          : "The file could not be saved to this device.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The export could not be produced.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Your trips and recorded hikes live in this deployment&apos;s database. Download a copy
        so losing the server does not lose them. It is a record you keep — nothing here reads
        it back in.
      </p>
      <Button variant="outline" onClick={() => void download()} disabled={busy}>
        <Download className="mr-2 h-4 w-4" />
        {busy ? "Preparing…" : "Download everything on the server"}
      </Button>
      {status && <p className="text-sm text-muted-foreground">{status}</p>}
    </div>
  );
}
