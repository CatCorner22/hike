import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:3111";
const browser = await chromium.launch({
  headless: true,
  // A fake capture device, so the camera check below tests the app's policy
  // rather than whether this machine has a webcam.
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const context = await browser.newContext({ permissions: ["camera"] });
const page = await context.newPage();
const violations = [];
page.on("console", (message) => {
  if (message.type() === "error" && /content security policy|csp/i.test(message.text())) violations.push(message.text());
});
await page.goto(`${base}/explore`, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForTimeout(2_000);
// The position-scan feature reads a QR code off another hiker's screen to
// exchange coordinates with no signal. It needs getUserMedia, and the app's own
// Permissions-Policy header is the thing most likely to silently forbid it: an
// empty `camera=()` allowlist denies the app's origin too, so the scanner failed
// with NotAllowedError however the user answered the browser prompt.
const camera = await page.evaluate(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    for (const track of stream.getTracks()) track.stop();
    return { ok: true };
  } catch (error) {
    return { ok: false, name: error.name, message: String(error.message) };
  }
});

const pass = violations.length === 0 && camera.ok;
console.log(JSON.stringify({ cspViolations: violations, camera, pass }, null, 2));
await browser.close();
process.exitCode = pass ? 0 : 1;
