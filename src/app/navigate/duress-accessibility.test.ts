import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const page = readFileSync(resolve(root, "src/app/navigate/page.tsx"), "utf8");
const panel = readFileSync(resolve(root, "src/components/offline/safety-panel.tsx"), "utf8");
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");

function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((part) => parseInt(part, 16) / 255) ?? [];
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

function themeVariable(themeClass: string, variable: string) {
  const block = css.match(new RegExp(`\\.${themeClass}[\\s\\S]*?\\n}`))?.[0] ?? "";
  return block.match(new RegExp(`${variable}: (#[a-fA-F\\d]{6})`))?.[1] ?? "";
}

describe("duress navigation accessibility regressions", () => {
  it("announces safety state transitions without making the visual HUD live", () => {
    expect(page).toContain("announcedSafetyStatesRef");
    expect(page).toContain("newlyActive");
    expect(page).toContain('role={liveAnnouncement.tone === "critical" ? "alert" : "status"}');
    expect(page).toContain('aria-live={liveAnnouncement.tone === "critical" ? "assertive" : "polite"}');
    expect(page).toContain('aria-live="off"');
  });

  it("makes the rescue grid large, high-contrast, and tabular", () => {
    expect(page).toContain("navigate-grid-readout font-mono text-sm font-semibold tabular-nums text-foreground");
    expect(css).toContain("--color-safety-critical: var(--safety-critical)");
    expect(css).toContain("--safety-critical: #8b0000;");
  });

  it("keeps red and NVG chrome readable instead of leaving white panels", () => {
    for (const theme of ["navigate-night-red", "navigate-night-nvg"]) {
      const foreground = themeVariable(theme, "--foreground");
      const background = themeVariable(theme, "--background");
      const critical = themeVariable(theme, "--safety-critical");
      const card = themeVariable(theme, "--card");
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(critical, card)).toBeGreaterThanOrEqual(4.5);
    }
    expect(page).toContain("navigate-night-red-document");
    expect(page).toContain("navigate-night-nvg-document");
  });

  it("keeps SOS and the first emergency actions at a 44 px minimum", () => {
    expect(css).toMatch(/\.navigate-emergency-trigger[\s\S]*min-width: 2\.75rem/);
    expect(css).toMatch(/\.navigate-emergency-trigger[\s\S]*bottom: max\(0\.75rem/);
    expect(panel).toContain('aria-label="Emergency actions"');
    expect((panel.match(/className="min-h-11"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("reflows the HUD in a short viewport and names both safety selects", () => {
    expect(css).toContain("@media (max-height: 480px)");
    expect(css).toContain(".navigate-hud");
    expect(css).toContain("top: auto !important");
    expect(panel).toContain('htmlFor="aim-off-side"');
    expect(panel).toContain('id="aim-off-side"');
    expect(panel).toContain('htmlFor="search-pattern"');
    expect(panel).toContain('id="search-pattern"');
  });
});
