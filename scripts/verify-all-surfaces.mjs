#!/usr/bin/env node
/**
 * Multi-surface, multi-viewport Playwright smoke test with axe-core a11y scanning.
 *
 * Visits 14 app surfaces at 3 viewports (mobile/tablet/desktop), captures:
 *   - HTTP status
 *   - Full-page screenshot
 *   - Console errors & page errors
 *   - axe-core WCAG 2.0A / 2.0AA / 2.2AA violations
 *
 * Writes a JSON summary to ./screenshots/report.json and exits non-zero
 * if any critical/serious a11y violations OR console errors are found.
 *
 * Usage:
 *   node scripts/verify-all-surfaces.mjs
 *   E2E_BASE_URL=https://staging.example.com node scripts/verify-all-surfaces.mjs
 *
 * Pre-requisites (one-time):
 *   npx playwright install chromium
 */
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

const VIEWPORTS = [
  { name: "mobile",  width: 375,  height: 667  },
  { name: "tablet",  width: 768,  height: 1024 },
  { name: "desktop", width: 1280, height: 800  },
];

const SURFACES = [
  { path: "/",                       name: "marketing"             },
  { path: "/chat",                   name: "chat"                  },
  { path: "/cv",                     name: "cv"                    },
  { path: "/assessment",             name: "assessment-hub"        },
  { path: "/assessment/riasec",      name: "assessment-riasec"     },
  { path: "/assessment/big5",        name: "assessment-big5"       },
  { path: "/assessment/values",      name: "assessment-values"     },
  { path: "/assessment/constraints", name: "assessment-constraints"},
  { path: "/recommendations",        name: "recommendations"       },
  { path: "/plan",                   name: "plan"                  },
  { path: "/interview",              name: "interview"             },
  { path: "/sign-in",                name: "sign-in"               },
  { path: "/privacy",                name: "privacy"               },
  { path: "/terms",                  name: "terms"                 },
];

// Ensure screenshots dir exists before any writes
mkdirSync("./screenshots", { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

for (const viewport of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: "he-IL",
  });
  const page = await ctx.newPage();

  // Per-context error accumulator (reset between surfaces via slice)
  const allErrors = [];
  page.on("pageerror", (e) => allErrors.push({ kind: "pageerror",      msg: e.message }));
  page.on("console",   (m) => {
    if (m.type() === "error") allErrors.push({ kind: "console.error", msg: m.text() });
  });

  for (const surface of SURFACES) {
    const url = `${BASE}${surface.path}`;
    const errorsBefore = allErrors.length;
    const result = { viewport: viewport.name, surface: surface.name, url };

    try {
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      result.status = response?.status() ?? null;

      await page.screenshot({
        path: `./screenshots/${viewport.name}-${surface.name}.png`,
        fullPage: false,
      });

      // axe-core a11y scan
      const axeResults = await new AxeBuilder({ page })
        .options({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } })
        .analyze();

      result.violations = axeResults.violations.map((v) => ({
        id:     v.id,
        impact: v.impact,
        help:   v.help,
        nodes:  v.nodes.length,
      }));
      result.errors = allErrors.slice(errorsBefore);
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }

    results.push(result);
    console.log(
      `[${viewport.name}] ${surface.name}: HTTP ${result.status ?? "ERR"} · ` +
      `${result.violations?.length ?? 0} a11y violations · ` +
      `${result.errors?.length ?? 0} console errors`,
    );
  }

  await ctx.close();
}

await browser.close();

// Write JSON report
writeFileSync("./screenshots/report.json", JSON.stringify(results, null, 2));
console.log("\nFull report: ./screenshots/report.json");

// Exit non-zero if any critical/serious a11y violations OR any console errors
const fails = results.filter(
  (r) =>
    r.error ||
    (r.violations ?? []).some((v) => v.impact === "critical" || v.impact === "serious") ||
    (r.errors ?? []).length > 0,
);

if (fails.length > 0) {
  console.error(`\n❌ ${fails.length} surface-viewport combinations have failures`);
  process.exit(1);
}
console.log("\n✅ All surfaces clean");
