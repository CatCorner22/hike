import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitForTests } from "@/lib/api/rate-limit";
import { OWNER_COOKIE, newOwnerId, signOwnerToken } from "@/lib/auth/owner";
import { GET, POST } from "./route.api";
import type { PioneerSnapshot } from "@/lib/pioneer/schemas";

const SNAPSHOT: PioneerSnapshot = {
  trailName: "Example Ridge Trail",
  research: {
    present: false,
    stale: true,
    provenance: "absent",
    hazardCount: 0,
    hazards: [],
    difficultyUnknown: true,
    parkingUnknown: true,
    permitsUnknown: true,
    conditionsUnknown: true,
    sourceCount: 0,
  },
  pack: {
    packReady: false,
    tripReady: false,
    corridorReady: false,
    weather: "absent",
    weatherSeverity: "none",
    hazardBrief: "absent",
    hazardBriefSeverity: "none",
    officialAlerts: "absent",
    officialAlertCount: 0,
    officialAlertMaxSeverity: "none",
    userBailoutCount: 0,
  },
  readiness: {
    iceComplete: false,
    returnAtSet: false,
    gaps: ["the offline route on this device", "a planned return time"],
  },
};

beforeEach(() => {
  __resetRateLimitForTests();
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.PIONEER_KILL;
  delete process.env.PIONEER_ENABLED;
});

async function session() {
  return `${OWNER_COOKIE}=${await signOwnerToken(newOwnerId())}`;
}

describe("GET /api/pioneer", () => {
  it("requires a session before saying whether Pioneer is open", async () => {
    const response = await GET(new Request("http://localhost/api/pioneer"));
    expect(response.status).toBe(401);
  });

  it("reports observe-only mode without naming the killswitch", async () => {
    const cookie = await session();
    const response = await GET(new Request("http://localhost/api/pioneer", {
      headers: { cookie },
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { enabled: boolean; mode: string };
    expect(body.enabled).toBe(false);
    expect(body.mode).toBe("observe-only");
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/kill/);
  });
});

describe("POST /api/pioneer", () => {
  it("requires a session", async () => {
    const response = await POST(new Request("http://localhost/api/pioneer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: SNAPSHOT }),
    }));
    expect(response.status).toBe(401);
  });

  it("rejects forbidden chat/feedback actions", async () => {
    const cookie = await session();
    const response = await POST(new Request("http://localhost/api/pioneer", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ action: "chat", snapshot: SNAPSHOT }),
    }));
    expect(response.status).toBe(403);
  });

  it("rejects a malformed snapshot", async () => {
    const cookie = await session();
    const response = await POST(new Request("http://localhost/api/pioneer", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ snapshot: { trailName: "" } }),
    }));
    expect(response.status).toBe(400);
  });

  it("returns instrument observations when the pioneer is dark", async () => {
    const cookie = await session();
    const response = await POST(new Request("http://localhost/api/pioneer", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ snapshot: SNAPSHOT }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      source: string;
      observations: Array<{ say: string }>;
      unavailable?: boolean;
    };
    expect(body.unavailable).toBe(false);
    expect(body.source).toBe("instrument");
    expect(body.observations.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/-?\d{1,3}\.\d{3,}/);
  });

  it("returns a bland unavailable when the silent kill is set", async () => {
    process.env.PIONEER_KILL = "1";
    process.env.AI_GATEWAY_API_KEY = "k";
    const cookie = await session();
    const response = await POST(new Request("http://localhost/api/pioneer", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ snapshot: SNAPSHOT }),
    }));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body.toLowerCase()).not.toMatch(/kill/);
  });

  it("rate-limits Pioneer per session", async () => {
    const cookie = await session();
    let last = 200;
    for (let i = 0; i < 9; i += 1) {
      last = (await POST(new Request("http://localhost/api/pioneer", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ snapshot: SNAPSHOT }),
      }))).status;
    }
    expect(last).toBe(429);
  });
});
