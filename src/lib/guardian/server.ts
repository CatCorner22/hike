import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db";
import { guardianShares } from "@/lib/db/schema";
import {
  classifyGuardianStatus,
  guardianTokenHash,
  newGuardianToken,
  type GuardianPublicStatus,
  type GuardianStatusPayload,
} from "@/lib/guardian/status";

export class GuardianStorageUnavailableError extends Error {
  constructor() {
    super("Guardian links require durable shared database storage.");
    this.name = "GuardianStorageUnavailableError";
  }
}

function requireGuardianDb() {
  if (!hasDatabase()) throw new GuardianStorageUnavailableError();
  return getDb();
}

/**
 * How long a finished link's row lingers before it is deleted.
 *
 * The app tells a hiker their guardian link is revocable and short-lived, and it
 * kept every one forever. Expired and revoked links were correctly *hidden* —
 * every read filters on `expires_at` and `revoked_at`, so nobody could read a
 * stale one — but the row itself, with the route name and the last progress,
 * ETA, battery and deviation the hiker published, stayed in the table for good.
 * "Short-lived" has to mean the data as well as the access.
 *
 * A week of grace, so a hiker who revokes a link at the trailhead and reopens the
 * app the next evening still sees that it was revoked rather than that it never
 * existed.
 */
export const GUARDIAN_RETENTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Bounded so a purge cannot become a long-running statement on a large table. */
const GUARDIAN_PURGE_LIMIT = 500;

/**
 * Delete links that are finished and past their grace period.
 *
 * Opportunistic: called when a hiker creates a new link, which is a moment they
 * are already waiting on a write, and never on a read. Best-effort by design —
 * a failed purge must not stop somebody sharing their route.
 */
export async function purgeFinishedGuardianShares(now = new Date()): Promise<number> {
  if (!hasDatabase()) return 0;
  const cutoff = new Date(now.getTime() - GUARDIAN_RETENTION_GRACE_MS);
  const deleted = await getDb()
    .delete(guardianShares)
    .where(
      sql`${guardianShares.id} in (
        select id from ${guardianShares}
        where (expires_at < ${cutoff} or (revoked_at is not null and revoked_at < ${cutoff}))
        limit ${GUARDIAN_PURGE_LIMIT}
      )`,
    )
    .returning({ id: guardianShares.id });
  return deleted.length;
}

export async function createGuardianShare(input: {
  ownerId: string;
  routeName: string;
  overdueAt?: string | null;
  expiresInHours: number;
  status?: GuardianStatusPayload;
}) {
  const db = requireGuardianDb();
  const token = newGuardianToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.expiresInHours * 60 * 60 * 1000);
  const [saved] = await db.insert(guardianShares).values({
    ownerId: input.ownerId,
    tokenHash: await guardianTokenHash(token),
    routeName: input.routeName,
    overdueAt: input.overdueAt ? new Date(input.overdueAt) : null,
    expiresAt,
    latestStatus: input.status ?? null,
    lastUpdateAt: input.status ? now : null,
    updatedAt: now,
  }).returning();
  if (!saved) throw new Error("Guardian link was not persisted");
  // The hiker is already waiting on this write, so it is the cheapest honest
  // moment to retire finished links. Never allowed to fail the share.
  void purgeFinishedGuardianShares(now).catch(() => 0);
  return { share: saved, token };
}

export async function getGuardianShareForOwner(id: string, ownerId: string) {
  const db = requireGuardianDb();
  return await db.query.guardianShares.findFirst({
    where: and(eq(guardianShares.id, id), eq(guardianShares.ownerId, ownerId)),
  }) ?? null;
}

export async function updateGuardianShareStatus(
  id: string,
  ownerId: string,
  status: GuardianStatusPayload,
) {
  const db = requireGuardianDb();
  const now = new Date();
  const existing = await getGuardianShareForOwner(id, ownerId);
  const previous = existing?.latestStatus ?? {};
  const merged: GuardianStatusPayload = {
    progressPercent: status.progressPercent ?? previous.progressPercent ?? null,
    etaAt: status.etaAt ?? previous.etaAt ?? null,
    batteryPercent: status.batteryPercent ?? previous.batteryPercent ?? null,
    deviationMeters: status.deviationMeters ?? previous.deviationMeters ?? null,
  };
  const [saved] = await db.update(guardianShares).set({
    latestStatus: merged,
    lastUpdateAt: now,
    updatedAt: now,
  }).where(and(
    eq(guardianShares.id, id),
    eq(guardianShares.ownerId, ownerId),
    isNull(guardianShares.revokedAt),
    gt(guardianShares.expiresAt, now),
  )).returning();
  return saved ?? null;
}

export async function revokeGuardianShare(id: string, ownerId: string) {
  const db = requireGuardianDb();
  const now = new Date();
  const [saved] = await db.update(guardianShares).set({
    revokedAt: now,
    updatedAt: now,
  }).where(and(
    eq(guardianShares.id, id),
    eq(guardianShares.ownerId, ownerId),
    isNull(guardianShares.revokedAt),
  )).returning();
  if (saved) return saved;
  // Revocation is idempotent for the owner. A retry after a lost acknowledgement
  // must be able to learn that the link is already off without reviving it.
  const existing = await getGuardianShareForOwner(id, ownerId);
  return existing?.revokedAt ? existing : null;
}

export async function getPublicGuardianStatus(token: string): Promise<GuardianPublicStatus | null> {
  const db = requireGuardianDb();
  const now = new Date();
  const row = await db.query.guardianShares.findFirst({
    where: and(
      eq(guardianShares.tokenHash, await guardianTokenHash(token)),
      isNull(guardianShares.revokedAt),
      gt(guardianShares.expiresAt, now),
    ),
  });
  if (!row) return null;
  return {
    routeName: row.routeName,
    expiresAt: row.expiresAt.toISOString(),
    overdueAt: row.overdueAt?.toISOString() ?? null,
    lastUpdateAt: row.lastUpdateAt?.toISOString() ?? null,
    serverCheckedAt: now.toISOString(),
    status: row.latestStatus ?? null,
    ...classifyGuardianStatus({
      now,
      lastUpdateAt: row.lastUpdateAt,
      overdueAt: row.overdueAt,
    }),
  };
}
