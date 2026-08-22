import { describe, expect, it } from "vitest";
import { httpsUrl } from "./urls";
import { parseLatLng } from "./api/validate";

describe("httpsUrl", () => {
  it("keeps https reservation links", () => {
    expect(httpsUrl("https://www.recreation.gov/camping/campgrounds/1")).toMatch(/^https:/);
  });

  it("upgrades http park/wiki links and still rejects other schemes", () => {
    expect(httpsUrl("http://www.nps.gov/yose/planyourvisit/camping.htm")).toBe(
      "https://www.nps.gov/yose/planyourvisit/camping.htm",
    );
    expect(httpsUrl("http://en.wikipedia.org/wiki/Half_Dome")).toBe(
      "https://en.wikipedia.org/wiki/Half_Dome",
    );
    expect(httpsUrl("javascript:alert(1)")).toBeNull();
    expect(httpsUrl("data:text/html,hi")).toBeNull();
    expect(httpsUrl("not a url")).toBeNull();
  });
});

describe("parseLatLng", () => {
  it("accepts a valid trailhead", () => {
    expect(parseLatLng(37.7, -119.6)).toEqual({ lat: 37.7, lng: -119.6 });
  });

  it("rejects out-of-range coordinates", () => {
    expect(parseLatLng(91, -119)).toBeNull();
    expect(parseLatLng("x", "y")).toBeNull();
  });
});
