import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/owner";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPioneerConfig, PIONEER_UNAVAILABLE } from "@/lib/pioneer/config";
import { isForbiddenUserAction } from "@/lib/pioneer/one-way";
import { toObservationalSuggestion } from "@/lib/pioneer/public";
import { PIONEER_PROMPT_VERSION } from "@/lib/pioneer/prompts";
import { pioneerSnapshotSchema } from "@/lib/pioneer/schemas";
import { runPioneer } from "@/lib/pioneer/service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  const config = getPioneerConfig();
  return NextResponse.json({
    enabled: config.enabled,
    promptVersion: PIONEER_PROMPT_VERSION,
    mode: "observe-only",
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;
  const limited = rateLimit(request, `pioneer:${owner.ownerId}`, 8);
  if (limited) return limited;

  const config = getPioneerConfig();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  if (isForbiddenUserAction(record.action)) {
    return NextResponse.json({ error: PIONEER_UNAVAILABLE }, { status: 403 });
  }
  if (config.silentlyKilled) {
    return NextResponse.json(
      { error: PIONEER_UNAVAILABLE, code: "unavailable", unavailable: true },
      { status: 503 },
    );
  }

  const parsed = pioneerSnapshotSchema.safeParse(record.snapshot);
  if (!parsed.success) {
    return NextResponse.json({ error: "Prep snapshot was rejected." }, { status: 400 });
  }

  const outcome = await runPioneer(parsed.data, { config });
  if (!outcome.ok) {
    return NextResponse.json({
      observations: [],
      gauges: outcome.gauges ?? null,
      unavailable: true,
      code: outcome.code,
    });
  }

  return NextResponse.json({
    observations: outcome.suggestions.map(toObservationalSuggestion),
    gauges: outcome.gauges,
    source: outcome.source,
    promptVersion: outcome.promptVersion,
    unavailable: false,
    modes: outcome.modes,
    profile: outcome.profile,
    reads: outcome.reads,
  });
}
