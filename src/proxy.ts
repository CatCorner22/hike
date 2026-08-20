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
/**
 * A document navigation is the only request that should mint a session.
 *
 * Minting on every request meant a cookie-less API call silently got a brand-new owner
 * instead of the documented 401: any script or crawler could POST plans and create
 * owners without limit, and the 401 branch was effectively unreachable in production.
 * A browser gets its cookie from the document response, so every subsequent fetch from
 * the page already carries one.
 */
function isDocumentRequest(request: NextRequest): boolean {
  const dest = request.headers.get("sec-fetch-dest");
  if (dest) return dest === "document";
  // Clients without Fetch Metadata: fall back to content negotiation.
  return (request.headers.get("accept") ?? "").includes("text/html");
}

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

  if (existing) return protectOwnerScopedResponse(request, NextResponse.next());
  if (!isDocumentRequest(request)) return protectOwnerScopedResponse(request, NextResponse.next());

  const token = await signOwnerToken(newOwnerId());
  // Set it on the request as well, so a handler in this same request sees the new
  // session instead of 401-ing on the very first call.
  request.cookies.set(OWNER_COOKIE, token);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(OWNER_COOKIE, token, ownerCookieOptions());
  // This response carries a freshly minted owner credential in Set-Cookie, and
  // Next otherwise labelled it `s-maxage=31536000`. A shared cache (CDN,
  // corporate proxy) storing it would replay one hiker's identity to every
  // later visitor, handing them that hiker's plans and recorded tracks. A
  // response that establishes a session must never be shared.
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return protectOwnerScopedResponse(request, response);
}

/**
 * Routes whose rendered HTML contains one hiker's own data: their plans,
 * recorded activities, and the navigate screen for a specific plan.
 */
const OWNER_SCOPED_PREFIXES = ["/plan", "/activities", "/navigate"];

function isOwnerScopedPath(pathname: string): boolean {
  return OWNER_SCOPED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Keeps owner-scoped pages out of shared caches.
 *
 * Next labelled these documents `s-maxage=31536000`, so a CDN or corporate proxy
 * could cache one hiker's rendered plan list -- their routes and return times --
 * and serve it to the next visitor. `Vary: Cookie` alone is not enough here:
 * Next rewrites the Vary header after the proxy runs, so the only reliable
 * control is to mark these responses private.
 *
 * Public pages (the landing page, trail pages, the guide) are left cacheable.
 */
function protectOwnerScopedResponse(request: NextRequest, response: NextResponse): NextResponse {
  if (!isOwnerScopedPath(request.nextUrl.pathname)) return response;
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  const existingVary = response.headers.get("Vary");
  if (!existingVary) {
    response.headers.set("Vary", "Cookie");
  } else if (!/(^|,\s*)cookie(\s*,|$)/i.test(existingVary)) {
    response.headers.set("Vary", `${existingVary}, Cookie`);
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the service worker, which need no identity.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons/).*)",
  ],
};
