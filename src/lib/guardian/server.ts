import { and, eq, gt, isNull } from "drizzle-orm";
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
  const [saved] = await db.update(guardianShares).set({
    latestStatus: status,
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
