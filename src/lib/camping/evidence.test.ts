import { describe, expect, it } from "vitest";
import {
  accessStatusFromOsmTags,
  campingTypeFromOsmTags,
  permitRequiredCompatibility,
  permitStatusFromLegacyBoolean,
  permitStatusFromOsmTags,
} from "./evidence";

describe("camping evidence classification", () => {
  it("keeps private access separate from camping type", () => {
    const tags = { tourism: "camp_site", access: "private" };
    expect(accessStatusFromOsmTags(tags)).toBe("private");
    expect(campingTypeFromOsmTags(tags)).toBe("walk_in");
  });

  it("uses only explicit permit evidence", () => {
    expect(permitStatusFromOsmTags({ backcountry: "yes" })).toBe("unknown");
    expect(permitStatusFromOsmTags({ permit: "yes" })).toBe("required");
    expect(permitStatusFromOsmTags({ permit: "seasonal" })).toBe("seasonal");
    expect(permitStatusFromOsmTags({ permit: "no" })).toBe("not_required");
  });

  it("does not upgrade a legacy false default into no-permit evidence", () => {
    expect(permitStatusFromLegacyBoolean(false)).toBe("unknown");
    expect(permitRequiredCompatibility("unknown")).toBeNull();
    expect(permitRequiredCompatibility("required")).toBe(true);
    expect(permitRequiredCompatibility("not_required")).toBe(false);
  });
});
