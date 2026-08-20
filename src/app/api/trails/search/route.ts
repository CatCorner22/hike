import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { parseBbox } from "@/lib/geo/bbox";
import { searchTrailsWithCache } from "@/lib/trails/service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const bboxParam = searchParams.get("bbox");
  const bbox = parseBbox(bboxParam);
  if (bboxParam && !bbox) {
    return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });
  }
  if (q.length < 2) return NextResponse.json({ trails: [] });
  if (q.length > 64) return NextResponse.json({ error: "Query is too long" }, { status: 400 });

  try {
    return NextResponse.json({ trails: await searchTrailsWithCache(q, bbox ?? undefined) });
  } catch (error) {
    return errorResponse(error, "Search failed");
  }
}
