import { NextResponse } from "next/server";
import { searchTrailsWithCache } from "@/lib/trails/service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const bboxParam = searchParams.get("bbox");

  if (!q || q.length < 2) {
    return NextResponse.json({ trails: [] });
  }

  let bbox: [number, number, number, number] | undefined;
  if (bboxParam) {
    const parts = bboxParam.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      bbox = parts as [number, number, number, number];
    }
  }

  try {
    const trails = await searchTrailsWithCache(q, bbox);
    return NextResponse.json({ trails });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 },
    );
  }
}
