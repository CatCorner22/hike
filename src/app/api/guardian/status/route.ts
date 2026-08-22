import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/api/rate-limit";
import { parseJsonBody } from "@/lib/api/validation";
import { getPublicGuardianStatus, GuardianStorageUnavailableError } from "@/lib/guardian/server";
import { GUARDIAN_TOKEN_PATTERN } from "@/lib/guardian/status";

const requestSchema = z.object({
  token: z.string().regex(GUARDIAN_TOKEN_PATTERN),
}).strict();
const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};

export async function POST(request: Request) {
  const limited = rateLimit(request, "guardian-public", 120);
  if (limited) return limited;
  const parsed = await parseJsonBody(request, requestSchema, { maxBytes: 1024 });
  if (!parsed.ok) return parsed.response;

  try {
    const status = await getPublicGuardianStatus(parsed.data.token);
    // Expired, revoked and random tokens are intentionally indistinguishable.
    if (!status) return NextResponse.json({ error: "Link unavailable" }, { status: 404, headers: NO_STORE });
    return NextResponse.json(status, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof GuardianStorageUnavailableError) {
      return NextResponse.json({ error: "Guardian status is unavailable" }, { status: 503, headers: NO_STORE });
    }
    console.error("[guardian:public]", error);
    return NextResponse.json({ error: "Guardian status is unavailable" }, { status: 500, headers: NO_STORE });
  }
}
