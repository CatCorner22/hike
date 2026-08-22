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
 * This is the only Next 16 proxy file. A leftover root `middleware.ts` / `proxy.ts`
 * pair used a different cookie name and minted sessions on every API call; it must
 * not be reintroduced. Route handlers re-verify the signature themselves, so this
 * is a convenience, not the security boundary — a request that somehow skips it
 * gets no session rather than an unscoped one.
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

/**
 * Origins the native shell loads from. A WKWebView app is a different origin from the
 * API, so without these headers the browser engine blocks every cross-origin `fetch`
 * before auth is even consulted — the shell could hold a perfectly valid Bearer token
 * and still be unable to use it.
 *
 * Deliberately NO `Access-Control-Allow-Credentials`: the shell authenticates with a
 * Bearer header, never the cookie, so the cookie stays unreachable cross-origin and
 * the CORS grant is as narrow as it can be.
 */
const DEFAULT_APP_ORIGINS = ["capacitor://localhost", "https://localhost"];

function allowedAppOrigins(): Set<string> {
  const extra = (process.env.ALLOWED_APP_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_APP_ORIGINS, ...extra]);
}

function corsOriginFor(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return allowedAppOrigins().has(origin) ? origin : null;
}

function applyCorsHeaders(response: NextResponse, origin: string): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", origin);
  const vary = response.headers.get("Vary");
  if (!vary) response.headers.set("Vary", "Origin");
  else if (!/(^|,\s*)origin(\s*,|$)/i.test(vary)) response.headers.set("Vary", `${vary}, Origin`);
  return response;
}

function corsPreflightResponse(origin: string): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "content-type,authorization");
  response.headers.set("Access-Control-Max-Age", "86400");
  response.headers.set("Vary", "Origin");
  return response;
}

export async function proxy(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const corsOrigin = isApi ? corsOriginFor(request) : null;
  if (isApi && request.method === "OPTIONS" && corsOrigin) {
    return corsPreflightResponse(corsOrigin);
  }

  let existing: string | null = null;
  try {
    existing = await verifyOwnerToken(request.cookies.get(OWNER_COOKIE)?.value);
  } catch (error) {
    // Without a secret we cannot mint a trustworthy cookie. Pass through and let the
    // route handlers refuse; failing the whole app closed here would take the offline
    // navigate shell down with it.
    if (error instanceof MissingSessionSecretError) {
      const response = NextResponse.next();
      return corsOrigin ? applyCorsHeaders(response, corsOrigin) : response;
    }
    throw error;
  }

  const finish = (response: NextResponse) => {
    const protectedResponse = protectOwnerScopedResponse(request, response);
    return corsOrigin ? applyCorsHeaders(protectedResponse, corsOrigin) : protectedResponse;
  };

  if (existing) return finish(NextResponse.next());
  if (!isDocumentRequest(request)) return finish(NextResponse.next());

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
  return finish(response);
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
