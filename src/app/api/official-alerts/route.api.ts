import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/api/rate-limit";
import { parseJsonBody } from "@/lib/api/validation";
import { fetchOfficialRouteAlerts, validOfficialAlertSnapshot } from "@/lib/offline/official-alerts";

const requestSchema = z.object({
  routeId: z.string().trim().min(1).max(256),
  parkCode: z.string().trim().max(12).nullable().optional(),
  points: z.array(z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    distanceMeters: z.number().finite().min(0).max(10_000_000),
  })).min(1).max(5),
});

export async function POST(request: Request) {
  const limited = rateLimit(request, "official-alerts", 6);
  if (limited) return limited;
  const parsed = await parseJsonBody(request, requestSchema, { maxBytes: 4_096 });
  if (!parsed.ok) return parsed.response;

  const snapshot = await fetchOfficialRouteAlerts(parsed.data);
  if (!validOfficialAlertSnapshot(snapshot, parsed.data.routeId)) {
    return NextResponse.json({ error: "Official alert snapshot failed validation." }, { status: 502 });
  }
  return NextResponse.json(
    { snapshot },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
