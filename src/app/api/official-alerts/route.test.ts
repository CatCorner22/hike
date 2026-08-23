import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimitForTests } from "@/lib/api/rate-limit";

const fetchSnapshot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/offline/official-alerts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/offline/official-alerts")>("@/lib/offline/official-alerts");
  return { ...actual, fetchOfficialRouteAlerts: fetchSnapshot };
});

import { POST } from "./route.api";

beforeEach(() => {
  __resetRateLimitForTests();
  fetchSnapshot.mockReset();
});

describe("POST /api/official-alerts", () => {
  it("rejects oversized sample lists before contacting official sources", async () => {
    const response = await POST(new Request("http://localhost/api/official-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeId: "plan-1",
        points: Array.from({ length: 6 }, (_, index) => ({ lat: 38.9, lng: -77, distanceMeters: index })),
      }),
    }));
    expect(response.status).toBe(400);
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("returns a private no-store validated snapshot", async () => {
    const now = new Date(Date.now() - 1_000).toISOString();
    fetchSnapshot.mockResolvedValue({
      version: 1,
      routeId: "plan-1",
      retrievedAt: now,
      sources: [{
        source: "nws",
        status: "checked",
        checkedAt: now,
        detail: "NWS active alerts checked at 1 route sample.",
        pointsChecked: 1,
      }],
      alerts: [],
    });
    const response = await POST(new Request("http://localhost/api/official-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeId: "plan-1",
        points: [{ lat: 38.9, lng: -77, distanceMeters: 0 }],
      }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ snapshot: { routeId: "plan-1", alerts: [] } });
  });
});
