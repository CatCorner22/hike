import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rate-limit";
import { errorResponse } from "@/lib/api/errors";
import { searchUsPlaces } from "@/lib/geo/place-search";

export async function GET(request: Request) {
  const limited = rateLimit(request, "places-search", 10);
  if (limited) return limited;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ places: [] });
  if (q.length > 96) return NextResponse.json({ error: "Place query is too long" }, { status: 400 });
  try {
    return NextResponse.json({ places: await searchUsPlaces(q) });
  } catch (error) {
    return errorResponse(error, "Place search failed");
  }
}
