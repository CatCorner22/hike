import { NextResponse } from "next/server";

export function errorResponse(error: unknown, fallback: string, status = 500): NextResponse {
  const requestId = crypto.randomUUID();
  console.error(`[api:${requestId}]`, error);
  return NextResponse.json({ error: fallback, requestId }, { status });
}
