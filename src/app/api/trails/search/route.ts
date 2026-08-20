import { NextResponse } from "next/server";
import { searchTrailsWithCache } from "@/lib/trails/service";
import { parseBbox } from "@/lib/camping/bbox";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const bboxParam = searchParams.get("bbox");

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ trails: [] });
  }
  if (q.length > 200 || /[\u0000-\u001f\u007f]/.test(q)) {
    return NextResponse.json({ error: "Invalid search query" }, { status: 400 });
  }

  const bbox = parseBbox(bboxParam);
  if (bboxParam && !bbox) {
    return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });
  }

  try {
    const trails = await searchTrailsWithCache(q.trim(), bbox ?? undefined);
    return NextResponse.json({ trails });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 },
    );
  }
}
