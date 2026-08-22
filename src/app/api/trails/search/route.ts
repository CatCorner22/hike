import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { parseBbox } from "@/lib/geo/bbox";
import { searchTrailsWithCache } from "@/lib/trails/service";
import { rateLimit } from "@/lib/api/rate-limit";

export async function GET(request: Request) {
  const limited = rateLimit(request, "trails-search", 20);
  if (limited) return limited;
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const bboxParam = searchParams.get("bbox");
  const bbox = parseBbox(bboxParam);
  if (bboxParam && !bbox) {
    return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });
  }
  if (q.length < 2 && !bbox) return NextResponse.json({ trails: [] });
  if (q.length > 64) return NextResponse.json({ error: "Query is too long" }, { status: 400 });

  try {
    return NextResponse.json({ trails: await searchTrailsWithCache(q, bbox ?? undefined) });
  } catch (error) {
    return errorResponse(error, "Search failed");
  }
}
