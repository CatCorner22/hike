import { describe, expect, it } from "vitest";
import { savedPackLaunchCopy, savedPackLaunchState } from "./saved-pack-readiness";

const navigation = {
  shellCached: true,
  expectedAssets: 12,
  cachedAssets: 12,
  missingAssets: [],
  serviceWorkerControlled: true,
  filesReady: true,
  ready: true,
};

describe("saved route launch state", () => {
  it("requires both a current route and verified offline launch files", () => {
    expect(savedPackLaunchState("ready", navigation)).toBe("ready");
    expect(savedPackLaunchState("ready", { ...navigation, serviceWorkerControlled: false, ready: false })).toBe(
      "finish-setup",
    );
    expect(savedPackLaunchState("stale", navigation)).toBe("update-required");
    expect(savedPackLaunchState("invalid", navigation)).toBe("update-required");
  });

  it("does not call a route ready while verification is pending", () => {
    expect(savedPackLaunchState("ready", null)).toBe("checking");
    expect(savedPackLaunchCopy("finish-setup").detail).not.toMatch(/route pack|manifest|service worker/i);
  });
});
