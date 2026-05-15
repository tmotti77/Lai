#!/usr/bin/env node
/**
 * Ad-hoc browser smoke test for /interview. Open the page, take a screenshot,
 * report what's rendered. Doesn't drive interactions — just verifies the
 * landing renders without errors after the middleware-cookie bugfix.
 *
 * Run:  npx playwright install chromium  (one-time)
 *       node scripts/verify-interview-ui.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ROUTE = "/interview";
const SCREENSHOT = "interview-landing.png";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: "he-IL",
});
const page = await ctx.newPage();

// Capture browser-side errors so we surface them even on HTTP 200.
const consoleErrors = [];
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
});

const url = `${BASE}${ROUTE}`;
console.log(`Navigating to ${url}…`);

const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
console.log(`HTTP ${response?.status() ?? "(no response)"}`);

await page.screenshot({ path: SCREENSHOT, fullPage: true });
console.log(`Saved screenshot → ${SCREENSHOT}`);

// Sample rendered text for a sanity check.
const headerText = await page.locator("header h1, h1").first().textContent().catch(() => "(no h1)");
const personaCount = await page.locator('button[aria-pressed]').count();
const composerVisible = await page.locator('input[placeholder]').count();

console.log(`---`);
console.log(`h1: ${headerText?.trim() ?? "(empty)"}`);
console.log(`persona buttons (aria-pressed): ${personaCount}`);
console.log(`input fields rendered: ${composerVisible}`);

if (consoleErrors.length > 0) {
  console.log(`---`);
  console.log(`BROWSER ERRORS:`);
  for (const err of consoleErrors) console.log(`  ${err}`);
}

await browser.close();
console.log(`done`);
