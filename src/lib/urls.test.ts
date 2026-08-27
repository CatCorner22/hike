import { describe, expect, it } from "vitest";
import { httpsUrl } from "./urls";

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
