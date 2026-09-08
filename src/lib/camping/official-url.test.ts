import { describe, expect, it } from "vitest";
import { campOfficialUrl } from "./official-url";

describe("campOfficialUrl", () => {
  it("prefers a reservation URL and upgrades http", () => {
    expect(campOfficialUrl({ reservationUrl: "https://www.recreation.gov/camping/1" })).toMatch(
      /^https:\/\/www\.recreation\.gov\//,
    );
    expect(campOfficialUrl({ reservationUrl: "http://www.nps.gov/yose/planyourvisit/camping.htm" })).toBe(
      "https://www.nps.gov/yose/planyourvisit/camping.htm",
    );
  });

  it("falls back to OSM evidence when there is no reservation link", () => {
    expect(
      campOfficialUrl({
        reservationUrl: null,
        metadata: { evidence: { access: { sourceUrl: "https://www.openstreetmap.org/node/1" } } },
      }),
    ).toBe("https://www.openstreetmap.org/node/1");
    expect(campOfficialUrl({ reservationUrl: null, metadata: {} })).toBeNull();
    expect(campOfficialUrl({ reservationUrl: "javascript:alert(1)" })).toBeNull();
  });
});
