import { NextResponse } from "next/server";
import {
  MissingSessionSecretError,
  newOwnerId,
  resolveOwnerId,
  signOwnerToken,
} from "@/lib/auth/owner";
import { rateLimit } from "@/lib/api/rate-limit";

/**
 * Mints an owner token for clients that cannot receive the cookie.
 *
 * The proxy mints the `hike_owner` cookie only on document navigations, which is
 * correct for browsers and impossible for the native shell: a WKWebView on
 * `capacitor://localhost` never issues a document request to this origin, so without
 * this endpoint the app would 401 forever. The response body carries the same
 * HMAC-signed token the cookie would; the shell stores it and sends it back as
 * `Authorization: Bearer`.
 *
 * Idempotent for an already-authenticated caller: presenting a valid Bearer token or
 * cookie returns a token for the SAME owner, so a re-mint after an app reinstall or
 * 401 never silently abandons the user's plans when their credential was still good.
 * With no valid credential it creates a fresh owner — the same semantics as a browser
 * clearing cookies.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, "session-mint", 10);
  if (limited) return limited;
  try {
    const existing = await resolveOwnerId(request);
    const ownerId = existing ?? newOwnerId();
    return NextResponse.json(
      { token: await signOwnerToken(ownerId) },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    if (error instanceof MissingSessionSecretError) {
      console.error("[session]", error.message);
      return NextResponse.json(
        { error: "Server is not configured for user data" },
        { status: 503 },
      );
    }
    throw error;
  }
}
