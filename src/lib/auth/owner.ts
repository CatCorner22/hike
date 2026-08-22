import { NextResponse } from "next/server";

/**
 * Per-browser owner identity.
 *
 * This is deliberately NOT a login. It gives the server a value it can trust when
 * deciding which rows a request may see, which is the thing an `owner_id` column needs
 * in order to mean anything — a client-supplied owner id would let anyone read anyone's
 * plans and GPS tracks.
 *
 * The cookie carries `<ownerId>.<HMAC-SHA256(ownerId, SESSION_SECRET)>`, so a client
 * cannot mint or edit one. It is HttpOnly, so page scripts cannot read it either.
 *
 * Limitation, stated plainly: identity is scoped to one browser on one device. Clearing
 * cookies or switching browsers produces a new owner and the old rows become
 * unreachable through the API. Downloaded route packs live in IndexedDB and keep working
 * regardless, so this cannot strand anyone mid-trip — but it is not multi-device sync.
 * Swapping in a real identity provider means changing `resolveOwnerId` and nothing else.
 */

export const OWNER_COOKIE = "hike_owner";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const DEV_SECRET = "hike-dev-only-owner-secret-not-for-production";

export class MissingSessionSecretError extends Error {
  constructor() {
    super(
      "SESSION_SECRET is not set. Ownership cannot be verified, so the API refuses to " +
        "read or write user data. Set SESSION_SECRET (or its legacy alias " +
        "OWNER_TOKEN_SECRET) to a long random string.",
    );
    this.name = "MissingSessionSecretError";
  }
}

/**
 * Fails closed in production. A missing secret must not silently degrade to "everyone
 * shares one identity" — that is the bug this module exists to remove.
 *
 * SESSION_SECRET is canonical. OWNER_TOKEN_SECRET is accepted as an alias because two
 * parallel hardening efforts named the same secret differently, and a deployment
 * configured with the other name must not suddenly lock every user out of their data.
 */
function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.OWNER_TOKEN_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === "production") throw new MissingSessionSecretError();
  return DEV_SECRET;
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64UrlEncode(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

/** Constant-time comparison; `===` on a signature leaks it a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signOwnerToken(ownerId: string, secret = getSecret()): Promise<string> {
  return `${ownerId}.${await hmac(ownerId, secret)}`;
}

/** Returns the owner id only if the signature checks out. */
export async function verifyOwnerToken(
  token: string | undefined | null,
  secret = getSecret(),
): Promise<string | null> {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const ownerId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!ownerId || !signature) return null;
  return timingSafeEqual(signature, await hmac(ownerId, secret)) ? ownerId : null;
}

export function newOwnerId(): string {
  return crypto.randomUUID();
}

export function ownerCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

/** Reads one cookie out of a raw Cookie header without pulling in a parser. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed percent escape (`%E0%A4%A`) made decodeURIComponent throw,
      // which surfaced as a 500. An unreadable cookie is simply not a valid
      // session: fail closed with no owner so the caller answers 401, rather
      // than turning a mangled cookie into a server error.
      return null;
    }
  }
  return null;
}

/**
 * The verified owner for this request, or null when neither credential is valid.
 *
 * Reads the request directly rather than `next/headers` so it does not depend on async
 * request context — which keeps every route handler callable, and testable, on its own.
 *
 * Two transports, one token format:
 * - `Authorization: Bearer <token>` — used by the native iOS shell. Its WKWebView runs
 *   on `capacitor://localhost`, a different origin from the API, so the SameSite cookie
 *   is never sent and, worse, the proxy only mints cookies on document navigations,
 *   which a native client never performs. Without this header path a wrapped app can
 *   never authenticate at all.
 * - The `hike_owner` cookie — the browser path, unchanged.
 *
 * A present-but-invalid Bearer token deliberately falls through to the cookie rather
 * than failing the request: the shell and the browser share one verification and one
 * failure mode (no owner → 401), not two.
 */
export async function resolveOwnerId(request: Request): Promise<string | null> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization ? /^Bearer\s+(.+)$/i.exec(authorization) : null;
  if (bearer) {
    const fromBearer = await verifyOwnerToken(bearer[1].trim());
    if (fromBearer) return fromBearer;
  }
  return verifyOwnerToken(readCookie(request, OWNER_COOKIE));
}

export type OwnerResult =
  | { ok: true; ownerId: string }
  | { ok: false; response: NextResponse };

/**
 * Use at the top of every route that touches user data. Middleware mints the cookie on
 * any normal browser navigation, so a 401 here means a client that does not carry
 * cookies at all — which cannot be scoped to an owner and so must not read or write.
 */
export async function requireOwner(request: Request): Promise<OwnerResult> {
  let ownerId: string | null;
  try {
    ownerId = await resolveOwnerId(request);
  } catch (error) {
    if (error instanceof MissingSessionSecretError) {
      console.error("[auth]", error.message);
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Server is not configured for user data" },
          { status: 503 },
        ),
      };
    }
    throw error;
  }

  if (!ownerId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No session. Enable cookies and reload." },
        { status: 401 },
      ),
    };
  }
  return { ok: true, ownerId };
}
