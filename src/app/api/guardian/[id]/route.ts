import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/api/rate-limit";
import { isoDatetimeSchema, parseJsonBody } from "@/lib/api/validation";
import { requireOwner } from "@/lib/auth/owner";
import {
  getGuardianShareForOwner,
  GuardianStorageUnavailableError,
  revokeGuardianShare,
  updateGuardianShareStatus,
} from "@/lib/guardian/server";

const statusSchema = z.object({
  progressPercent: z.number().finite().min(0).max(100).nullable().optional(),
  etaAt: isoDatetimeSchema.nullable().optional(),
  batteryPercent: z.number().finite().min(0).max(100).nullable().optional(),
  deviationMeters: z.number().finite().min(0).max(1_000_000).nullable().optional(),
}).strict().refine(
  (status) => Object.values(status).some((value) => value != null),
  "At least one status value is required",
);

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), status: statusSchema }).strict(),
  z.object({ action: z.literal("revoke") }).strict(),
]);

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

function unavailable() {
  return NextResponse.json(
    { error: "Private Guardian links need configured server storage" },
    { status: 503, headers: NO_STORE },
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  const { id } = await params;
  try {
    const share = await getGuardianShareForOwner(id, owner.ownerId);
    if (!share) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({
      shareId: share.id,
      routeName: share.routeName,
      expiresAt: share.expiresAt.toISOString(),
      revokedAt: share.revokedAt?.toISOString() ?? null,
      lastUpdateAt: share.lastUpdateAt?.toISOString() ?? null,
    }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof GuardianStorageUnavailableError) return unavailable();
    console.error("[guardian:read]", error);
    return NextResponse.json({ error: "Guardian link could not be checked" }, { status: 500, headers: NO_STORE });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  const limited = rateLimit(request, `guardian-write:${owner.ownerId}`, 30);
  if (limited) return limited;
  const parsed = await parseJsonBody(request, patchSchema, { maxBytes: 4096 });
  if (!parsed.ok) return parsed.response;
  const { id } = await params;

  try {
    if (parsed.data.action === "revoke") {
      const share = await revokeGuardianShare(id, owner.ownerId);
      if (!share?.revokedAt) {
        return NextResponse.json(
          { error: "Revocation was not confirmed; the link may still work" },
          { status: 409, headers: NO_STORE },
        );
      }
      return NextResponse.json({
        acknowledged: true,
        revokedAt: share.revokedAt.toISOString(),
      }, { headers: NO_STORE });
    }

    const share = await updateGuardianShareStatus(id, owner.ownerId, parsed.data.status);
    if (!share) {
      return NextResponse.json(
        { error: "Link is expired, revoked, or unavailable" },
        { status: 409, headers: NO_STORE },
      );
    }
    return NextResponse.json({
      acknowledged: true,
      lastUpdateAt: share.lastUpdateAt?.toISOString() ?? null,
    }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof GuardianStorageUnavailableError) return unavailable();
    console.error("[guardian:write]", error);
    return NextResponse.json(
      { error: parsed.data.action === "revoke"
        ? "Revocation was not confirmed; the link may still work"
        : "Status was not saved" },
      { status: 500, headers: NO_STORE },
    );
  }
}
