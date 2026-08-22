import { describe, expect, it } from "vitest";
import { detectInstallPlatform, manualInstallSteps } from "./install-guidance";

describe("offline install guidance", () => {
  it("recognizes iPhone, touch iPad, Android, and desktop browsers", () => {
    expect(detectInstallPlatform("Mozilla/5.0 (iPhone)")).toBe("ios");
    expect(detectInstallPlatform("Mozilla/5.0 (Macintosh)", 5)).toBe("ios");
    expect(detectInstallPlatform("Mozilla/5.0 (Linux; Android 15)")).toBe("android");
    expect(detectInstallPlatform("Mozilla/5.0 (Windows NT 10.0)")).toBe("desktop");
  });

  it("uses platform-appropriate manual instructions", () => {
    expect(manualInstallSteps("ios")).toMatch(/Safari.*Share.*Add to Home Screen/);
    expect(manualInstallSteps("android")).toMatch(/Install app|Add to Home screen/);
    expect(manualInstallSteps("desktop")).toMatch(/install icon/i);
  });
});
