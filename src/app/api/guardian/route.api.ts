import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/api/rate-limit";
import { isoDatetimeSchema, parseJsonBody } from "@/lib/api/validation";
import { requireOwner } from "@/lib/auth/owner";
import { createGuardianShare, GuardianStorageUnavailableError } from "@/lib/guardian/server";
import { GUARDIAN_MAX_SHARE_HOURS } from "@/lib/guardian/status";

const statusSchema = z.object({
  progressPercent: z.number().finite().min(0).max(100).nullable().optional(),
  etaAt: isoDatetimeSchema.nullable().optional(),
  batteryPercent: z.number().finite().min(0).max(100).nullable().optional(),
  deviationMeters: z.number().finite().min(0).max(1_000_000).nullable().optional(),
}).strict().refine(
  (status) => Object.values(status).some((value) => value != null),
  "At least one status value is required",
);

const createSchema = z.object({
  routeName: z.string().trim().min(1).max(160),
  overdueAt: isoDatetimeSchema.nullable().optional(),
  expiresInHours: z.number().int().min(1).max(GUARDIAN_MAX_SHARE_HOURS),
  status: statusSchema.optional(),
}).strict();

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  const limited = rateLimit(request, `guardian-create:${owner.ownerId}`, 10, 60 * 60 * 1000);
  if (limited) return limited;
  const parsed = await parseJsonBody(request, createSchema, { maxBytes: 4096 });
  if (!parsed.ok) return parsed.response;
  const overdueAtMs = parsed.data.overdueAt ? Date.parse(parsed.data.overdueAt) : null;
  const expiresAtMs = Date.now() + parsed.data.expiresInHours * 60 * 60 * 1000;
  if (overdueAtMs != null && overdueAtMs > expiresAtMs) {
    return NextResponse.json(
      { error: "The link would expire before the agreed overdue time" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const { share, token } = await createGuardianShare({
      ownerId: owner.ownerId,
      ...parsed.data,
    });
    return NextResponse.json({
      acknowledged: true,
      shareId: share.id,
      token,
      expiresAt: share.expiresAt.toISOString(),
      lastUpdateAt: share.lastUpdateAt?.toISOString() ?? null,
    }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof GuardianStorageUnavailableError) {
      return NextResponse.json(
        { error: "Private Guardian links need configured server storage" },
        { status: 503, headers: NO_STORE },
      );
    }
    console.error("[guardian:create]", error);
    return NextResponse.json(
      { error: "Guardian link was not saved" },
      { status: 500, headers: NO_STORE },
    );
  }
}
