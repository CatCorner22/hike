import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "hike_device_owner";
const OWNER_HEADER = "x-hike-owner-id";
const OWNER_LIFETIME_SECONDS = 60 * 60 * 24 * 365 * 2;
const encoder = new TextEncoder();
let warnedAboutDevSecret = false;

function secret(): string {
  const configured = process.env.OWNER_TOKEN_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("OWNER_TOKEN_SECRET is required in production to protect device-scoped data.");
  }
  if (!warnedAboutDevSecret) {
    warnedAboutDevSecret = true;
    console.warn("[SECURITY WARNING] OWNER_TOKEN_SECRET is unset. Using a stable development-only secret; never deploy this configuration.");
  }
  return "hike-development-only-owner-token-secret-not-for-production";
}

function toBase64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function mac(ownerId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(ownerId));
  return toBase64Url(new Uint8Array(signature));
}

async function verifiedOwnerId(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [ownerId, signature, extra] = token.split(".");
  if (extra || !ownerId || !signature || !/^[A-Za-z0-9_-]{32,128}$/.test(ownerId) || !fromBase64Url(signature)) return null;
  const expected = await mac(ownerId);
  const actual = fromBase64Url(signature);
  const expectedBytes = fromBase64Url(expected);
  if (!actual || !expectedBytes || actual.length !== expectedBytes.length) return null;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual[index] ^ expectedBytes[index];
  return mismatch === 0 ? ownerId : null;
}

async function newToken(): Promise<{ ownerId: string; token: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const ownerId = toBase64Url(bytes);
  return { ownerId, token: `${ownerId}.${await mac(ownerId)}` };
}

export async function middleware(request: NextRequest) {
  let ownerId = await verifiedOwnerId(request.cookies.get(COOKIE_NAME)?.value);
  let token: string | null = null;
  if (!ownerId) {
    const created = await newToken();
    ownerId = created.ownerId;
    token = created.token;
  }
  const headers = new Headers(request.headers);
  headers.set(OWNER_HEADER, ownerId);
  const response = NextResponse.next({ request: { headers } });
  if (token) {
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: OWNER_LIFETIME_SECONDS,
    });
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
