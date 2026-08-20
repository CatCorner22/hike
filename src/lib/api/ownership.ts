import { NextResponse } from "next/server";

/**
 * This is device-scoped ownership, not user authentication. It prevents
 * cross-device IDOR without an account UI; anyone sharing a browser/device
 * shares its data. It is deliberately a stepping stone to real accounts.
 *
 * middleware.ts verifies the signed cookie and injects this request header.
 * It is overwritten by middleware on every external request, so callers
 * cannot choose an owner by supplying their own value.
 */
export function ownerIdFromRequest(request: Request): string | null {
  const ownerId = request.headers.get("x-hike-owner-id");
  return ownerId && /^[A-Za-z0-9_-]{32,128}$/.test(ownerId) ? ownerId : null;
}

export function ownerUnavailableResponse() {
  return NextResponse.json(
    { error: "Device ownership token is unavailable. Reload and try again." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export function notFoundResponse() {
  return NextResponse.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export function withoutOwner<T extends { ownerId?: unknown }>(record: T): Omit<T, "ownerId"> {
  const publicRecord = { ...record };
  delete publicRecord.ownerId;
  return publicRecord;
}
