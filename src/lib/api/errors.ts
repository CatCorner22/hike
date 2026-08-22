import { NextResponse } from "next/server";
import { LocalStoreDisabledError } from "@/lib/store/local";

export function errorResponse(error: unknown, fallback: string, status = 500): NextResponse {
  const requestId = crypto.randomUUID();
  if (error instanceof LocalStoreDisabledError) {
    console.error(`[api:${requestId}]`, error.message);
    return NextResponse.json(
      { error: "Server is not configured for user data", requestId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  console.error(`[api:${requestId}]`, error);
  return NextResponse.json({ error: fallback, requestId }, { status });
}
