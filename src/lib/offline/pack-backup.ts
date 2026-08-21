import {
  MAX_ROUTE_PACK_BYTES,
  routePackStatus,
  validateRoutePack,
  type RoutePack,
} from "@/lib/offline/route-pack";

export const PACK_BACKUP_KIND = "klandagi-route-pack";
export const PACK_BACKUP_VERSION = 1;
export const PACK_BACKUP_DISCLAIMER =
  "Device backup only. Not cloud sync. Import this file on the device you will navigate with, then verify Offline readiness before leaving signal.";

const MAX_BACKUP_BYTES = MAX_ROUTE_PACK_BYTES + 4_096;

export interface RoutePackBackup {
  kind: typeof PACK_BACKUP_KIND;
  version: number;
  exportedAt: string;
  disclaimer: string;
  pack: RoutePack;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function serializeRoutePackBackup(pack: RoutePack): string {
  const validation = validateRoutePack(pack);
  if (validation) throw new Error(validation);
  if (routePackStatus(pack) !== "ready") {
    throw new Error("This pack is not current enough to export. Prepare it again while online.");
  }
  const backup: RoutePackBackup = {
    kind: PACK_BACKUP_KIND,
    version: PACK_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    disclaimer: PACK_BACKUP_DISCLAIMER,
    pack,
  };
  const text = JSON.stringify(backup);
  if (byteLength(text) > MAX_BACKUP_BYTES) {
    throw new Error("Backup is too large to export.");
  }
  return text;
}

export function parseRoutePackBackup(text: unknown): { pack: RoutePack } | { error: string } {
  if (typeof text !== "string" || text.length === 0) {
    return { error: "Backup file is empty." };
  }
  if (byteLength(text) > MAX_BACKUP_BYTES) {
    return { error: "Backup file is too large." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Backup file is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object") {
    return { error: "Backup file is invalid." };
  }
  const candidate = parsed as Partial<RoutePackBackup>;
  if (candidate.kind !== PACK_BACKUP_KIND) {
    return { error: "This file is not a Klandagi route-pack backup." };
  }
  if (candidate.version !== PACK_BACKUP_VERSION) {
    return { error: "This backup uses an unsupported format. Prepare the route again while online." };
  }
  if (candidate.disclaimer !== PACK_BACKUP_DISCLAIMER) {
    return { error: "Backup disclaimer is missing or altered." };
  }
  if (typeof candidate.exportedAt !== "string" || !Number.isFinite(Date.parse(candidate.exportedAt))) {
    return { error: "Backup export time is invalid." };
  }
  if (!candidate.pack) return { error: "Backup file is missing a route pack." };
  const validation = validateRoutePack(candidate.pack);
  if (validation) return { error: validation };
  if (routePackStatus(candidate.pack) !== "ready") {
    return { error: "This backup is an older pack format. Prepare the route again while online." };
  }
  return { pack: candidate.pack };
}

export function backupParseError(result: { pack: RoutePack } | { error: string }): string | null {
  return "error" in result ? result.error : null;
}
