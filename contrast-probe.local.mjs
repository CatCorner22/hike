import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3111";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/guide`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const out = await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  function toRgb(cssColor) {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = "#000";
    g.fillStyle = cssColor;
    g.fillRect(0, 0, 1, 1);
    const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
    return [r, gg, b];
  }
  function srgb(v) { return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
  function lum(cssColor) {
    const [r, gg, b] = toRgb(cssColor).map((n) => srgb(n / 255));
    return 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  }
  function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
  const probe = document.createElement("div");
  document.body.appendChild(probe);
  const bg = getComputedStyle(document.body).backgroundColor;
  const results = {};
  for (const cls of ["text-green-600","text-green-700","text-green-800","text-amber-600","text-amber-700","text-amber-800","text-emerald-700","text-emerald-800"]) {
    probe.className = cls;
    const color = getComputedStyle(probe).color;
    results[cls] = { rgb: toRgb(color).join(","), ratio: Number(ratio(color, bg).toFixed(2)) };
  }
  probe.remove();
  return { background: toRgb(bg).join(","), results };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
