import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitForTests } from "@/lib/api/rate-limit";
import { POST } from "./route.api";

beforeEach(() => {
  __resetRateLimitForTests();
});

describe("POST /api/corridor/features", () => {
  it("rejects malformed requests before calling Overpass", async () => {
    const broken = await POST(new Request("http://localhost/api/corridor/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    }));
    expect(broken.status).toBe(400);

    const missing = await POST(new Request("http://localhost/api/corridor/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: "plan-1" }),
    }));
    expect(missing.status).toBe(400);
  });

  it("rejects an oversized body before parsing", async () => {
    const response = await POST(new Request("http://localhost/api/corridor/features", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "20000" },
      body: "x".repeat(20_000),
    }));
    expect(response.status).toBe(413);
  });

  it("returns a null snapshot when the corridor bounds are too large", async () => {
    const response = await POST(new Request("http://localhost/api/corridor/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: "plan-1", bboxes: [[-120, 30, -100, 50]] }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { features: unknown; reason?: string };
    expect(body.features).toBeNull();
    expect(body.reason).toMatch(/too large/);
  });
});
