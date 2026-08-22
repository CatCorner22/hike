import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithTimeoutMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/outbound", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/outbound")>(
    "@/lib/api/outbound",
  );
  return { ...actual, fetchWithTimeout: fetchWithTimeoutMock };
});

import {
  getVerifiedParkAlertSnapshot,
  getResearchContext,
  normalizeNpsParkCode,
  npsParkCodeFromTags,
} from "./client";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("NPS_API_KEY", "test-key");
  fetchWithTimeoutMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("NPS park-code evidence", () => {
  it("accepts only explicit, syntactically valid NPS tags", () => {
    expect(normalizeNpsParkCode(" YOSE ")).toBe("yose");
    expect(normalizeNpsParkCode("Yosemite")).toBeNull();
    expect(npsParkCodeFromTags({ operator: "National Park Service" })).toBeNull();
    expect(npsParkCodeFromTags({ "nps:park_code": "YOSE" })).toBe("yose");
  });

  it("does not request or claim park alerts when NPS cannot verify the code", async () => {
    fetchWithTimeoutMock.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/parks")) return jsonResponse({ data: [] });
      if (url.pathname.endsWith("/articles")) return jsonResponse({ data: [] });
      throw new Error(`Unexpected request: ${url.pathname}`);
    });

    const context = await getResearchContext("Example Trail", "yose");
    const urls = fetchWithTimeoutMock.mock.calls.map(([url]) => new URL(String(url)));

    expect(context.park).toBeNull();
    expect(context.alerts).toEqual([]);
    expect(urls.some((url) => url.pathname.endsWith("/alerts"))).toBe(false);
    const articlesUrl = urls.find((url) => url.pathname.endsWith("/articles"));
    expect(articlesUrl?.searchParams.has("parkCode")).toBe(false);
  });

  it("uses park-specific alerts only after the NPS park lookup matches", async () => {
    fetchWithTimeoutMock.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/parks")) {
        return jsonResponse({
          data: [{
            fullName: "Yosemite National Park",
            parkCode: "yose",
            states: "CA",
            description: "",
            latitude: "",
            longitude: "",
          }],
        });
      }
      if (url.pathname.endsWith("/articles")) return jsonResponse({ data: [] });
      if (url.pathname.endsWith("/alerts")) {
        return jsonResponse({
          data: [{
            title: "Road closure",
            description: "A park road is closed.",
            category: "Park Closure",
            url: "https://www.nps.gov/yose/planyourvisit/conditions.htm",
          }],
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });

    const context = await getResearchContext("Example Trail", "yose");
    const alertRequest = fetchWithTimeoutMock.mock.calls
      .map(([url]) => new URL(String(url)))
      .find((url) => url.pathname.endsWith("/alerts"));

    expect(context.park).toEqual({
      parkCode: "yose",
      name: "Yosemite National Park",
    });
    expect(context.alerts).toHaveLength(1);
    expect(alertRequest?.searchParams.get("parkCode")).toBe("yose");
  });

  it("does not turn an NPS outage into a zero-alert result", async () => {
    fetchWithTimeoutMock.mockRejectedValue(new Error("offline"));
    await expect(getVerifiedParkAlertSnapshot("yose")).resolves.toMatchObject({
      status: "unavailable",
      alerts: [],
    });
  });

  it("reports a completed zero-alert check only after exact park verification", async () => {
    fetchWithTimeoutMock.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/parks")) {
        return jsonResponse({ data: [{ fullName: "Yosemite National Park", parkCode: "yose" }] });
      }
      if (url.pathname.endsWith("/alerts")) return jsonResponse({ data: [] });
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    await expect(getVerifiedParkAlertSnapshot("yose")).resolves.toMatchObject({
      status: "checked",
      parkCode: "yose",
      parkName: "Yosemite National Park",
      alerts: [],
    });
  });
});
