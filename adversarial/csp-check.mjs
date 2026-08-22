import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:3111";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const page = await browser.newPage();
const violations = [];
page.on("console", (message) => {
  if (message.type() === "error" && /content security policy|csp/i.test(message.text())) violations.push(message.text());
});
await page.goto(`${base}/explore`, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForTimeout(2_000);
console.log(JSON.stringify({ cspViolations: violations, pass: violations.length === 0 }, null, 2));
await browser.close();
process.exitCode = violations.length ? 1 : 0;
