import { NextResponse, type NextRequest } from "next/server";
import {
  MissingSessionSecretError,
  OWNER_COOKIE,
  newOwnerId,
  ownerCookieOptions,
  signOwnerToken,
  verifyOwnerToken,
} from "@/lib/auth/owner";

/**
 * Mints the signed owner cookie on first contact so a browser always has an identity
 * before it calls the API.
 *
 * Route handlers re-verify the signature themselves, so this is a convenience, not the
 * security boundary — the docs note Proxy may be deployed to a CDN separately from the
 * render code, and a request that somehow skips it gets no session rather than an
 * unscoped one.
 *
 * (Next 16 renamed the `middleware` file convention to `proxy`.)
 */
export async function proxy(request: NextRequest) {
  let existing: string | null = null;
  try {
    existing = await verifyOwnerToken(request.cookies.get(OWNER_COOKIE)?.value);
  } catch (error) {
    // Without a secret we cannot mint a trustworthy cookie. Pass through and let the
    // route handlers refuse; failing the whole app closed here would take the offline
    // navigate shell down with it.
    if (error instanceof MissingSessionSecretError) return NextResponse.next();
    throw error;
  }

  if (existing) return NextResponse.next();

  const token = await signOwnerToken(newOwnerId());
  // Set it on the request as well, so a handler in this same request sees the new
  // session instead of 401-ing on the very first call.
  request.cookies.set(OWNER_COOKIE, token);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(OWNER_COOKIE, token, ownerCookieOptions());
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the service worker, which need no identity.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons/).*)",
  ],
};
