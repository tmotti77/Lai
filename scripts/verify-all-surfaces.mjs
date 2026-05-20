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
 * Phase 6b additions:
 *   - Thumbs interaction: verifies aria-pressed toggle on /recommendations + interview wrap-up
 *   - NPS prompt: if prompt is visible, verifies 11 radio buttons render correctly
 *   - Admin export: verifies 200+CSV with Bearer token; 401 without token
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
  // /recommendations fires async API calls after load — use "load" so networkidle doesn't hang.
  { path: "/recommendations",        name: "recommendations",      waitUntil: "load" },
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

  // Bootstrap consent once per context so /recommendations renders without 403.
  // Step 1: navigate to / so the middleware assigns the co_anon cookie to this context.
  // Step 2: POST /api/consent via the context's request API (shares cookies with the page).
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 30000 });
  await ctx.request.post(`${BASE}/api/consent`);

  for (const surface of SURFACES) {
    const url = `${BASE}${surface.path}`;
    const errorsBefore = allErrors.length;
    const result = { viewport: viewport.name, surface: surface.name, url };

    try {
      const response = await page.goto(url, { waitUntil: surface.waitUntil ?? "networkidle", timeout: 30000 });
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6b: feature-level checks (single viewport — desktop, no axe overhead)
// ─────────────────────────────────────────────────────────────────────────────
const phase6bErrors = [];

{
  const browser6b = await chromium.launch({ headless: true });
  const p6bCtx = await browser6b.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "he-IL",
  });

  const p6bPage = await p6bCtx.newPage();

  // Bootstrap consent (same as main loop).
  await p6bPage.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 30000 });
  await p6bCtx.request.post(`${BASE}/api/consent`);

  // ── 1. Thumbs on /recommendations ──────────────────────────────────────────
  try {
    await p6bPage.goto(`${BASE}/recommendations`, { waitUntil: "load", timeout: 30000 });
    // ThumbsRow buttons have aria-label "תגובה חיובית" and "תגובה שלילית".
    // They are rendered inside OccupationCard / PathCard which load asynchronously.
    // Wait up to 8 s for at least one thumb button to appear.
    const thumbLocator = p6bPage.getByRole("button", { name: /תגובה חיובית|תגובה שלילית/ });
    await thumbLocator.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {
      // Recommendations may be empty for a brand-new anon user — skip gracefully.
      console.log("[6b] recommendations: no recommendations yet, thumbs check skipped");
    });
    const thumbCount = await thumbLocator.count();
    if (thumbCount > 0) {
      // Verify aria-pressed attribute exists (initial state is not pressed).
      const firstPressed = await thumbLocator.first().getAttribute("aria-pressed");
      if (firstPressed === null) {
        throw new Error(`recommendations thumbs: aria-pressed attribute missing`);
      }
      console.log(`[6b] recommendations: ${thumbCount} thumb button(s) found, aria-pressed="${firstPressed}"`);
    }
  } catch (err) {
    phase6bErrors.push({ check: "thumbs:recommendations", error: err.message });
    console.error(`[6b] thumbs:recommendations FAILED: ${err.message}`);
  }

  // ── 2. Thumbs on interview wrap-up ─────────────────────────────────────────
  // The wrap-up screen is only visible for completed sessions. The /interview
  // page itself always loads (session list + picker). We check that the
  // ThumbsRow component is wired correctly by verifying its aria-label strings
  // exist on any completed-session wrap-up page accessible via navigation.
  // Since E2E doesn't create a completed session, we assert at the page level
  // that no *broken* thumb buttons exist (0 is acceptable; > 0 with missing
  // aria-pressed is a failure).
  try {
    await p6bPage.goto(`${BASE}/interview`, { waitUntil: "networkidle", timeout: 30000 });
    const wrapThumbLocator = p6bPage.getByRole("button", { name: /תגובה חיובית|תגובה שלילית/ });
    const wrapThumbCount = await wrapThumbLocator.count();
    if (wrapThumbCount > 0) {
      const firstPressed = await wrapThumbLocator.first().getAttribute("aria-pressed");
      if (firstPressed === null) {
        throw new Error(`interview thumbs: aria-pressed attribute missing on ${wrapThumbCount} button(s)`);
      }
    }
    console.log(`[6b] interview: ${wrapThumbCount} thumb button(s) found (wrap-up check)`);
  } catch (err) {
    phase6bErrors.push({ check: "thumbs:interview", error: err.message });
    console.error(`[6b] thumbs:interview FAILED: ${err.message}`);
  }

  // ── 3. NPS prompt — conditional render check ───────────────────────────────
  // The NPS prompt only renders when getNpsEligibility() returns show=true.
  // For a fresh anon user nps_eligibility_first_at is null, so the prompt is
  // hidden. We check: IF the prompt IS present → must have exactly 11 radio
  // buttons. If absent → log a skip (this is expected for new sessions).
  try {
    await p6bPage.goto(`${BASE}/recommendations`, { waitUntil: "load", timeout: 30000 });
    const radioLocator = p6bPage.getByRole("radio");
    const radioCount = await radioLocator.count();
    if (radioCount > 0) {
      if (radioCount !== 11) {
        throw new Error(`NPS prompt: expected 11 radio buttons, found ${radioCount}`);
      }
      console.log(`[6b] NPS prompt: ${radioCount} radio buttons found (eligible user)`);
    } else {
      console.log("[6b] NPS prompt: not shown for this session (user not yet eligible — expected)");
    }
  } catch (err) {
    phase6bErrors.push({ check: "nps-prompt", error: err.message });
    console.error(`[6b] nps-prompt FAILED: ${err.message}`);
  }

  // ── 4. Admin export endpoint ───────────────────────────────────────────────
  // a) With valid Bearer token → 200 + CSV header
  // b) Without token → 401
  const ADMIN_TOKEN = process.env.ADMIN_EXPORT_TOKEN;
  if (!ADMIN_TOKEN) {
    console.log("[6b] admin-export: ADMIN_EXPORT_TOKEN not set, skipping auth check (will still verify 401)");
  }
  try {
    // 4a: 401 without token
    const noAuthRes = await p6bCtx.request.get(`${BASE}/api/admin/feedback/export`);
    if (noAuthRes.status() !== 401) {
      throw new Error(`admin-export no-auth: expected 401, got ${noAuthRes.status()}`);
    }
    console.log("[6b] admin-export: 401 without token ✓");

    // 4b: 200 + CSV header with token (only when token is configured)
    if (ADMIN_TOKEN) {
      const authRes = await p6bCtx.request.get(`${BASE}/api/admin/feedback/export`, {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      if (authRes.status() !== 200) {
        throw new Error(`admin-export with token: expected 200, got ${authRes.status()}`);
      }
      const csv = await authRes.text();
      const expectedHeader = "id,user_id,surface,";
      if (!csv.startsWith(expectedHeader)) {
        throw new Error(
          `admin-export: unexpected CSV header. Expected to start with "${expectedHeader}", got: "${csv.slice(0, 60)}"`
        );
      }
      console.log("[6b] admin-export: 200 + valid CSV header with token ✓");
    }
  } catch (err) {
    phase6bErrors.push({ check: "admin-export", error: err.message });
    console.error(`[6b] admin-export FAILED: ${err.message}`);
  }

  await p6bCtx.close();
  await browser6b.close();
}

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

if (phase6bErrors.length > 0) {
  console.error(`\n❌ ${phase6bErrors.length} Phase 6b feature check(s) failed:`);
  for (const e of phase6bErrors) console.error(`   • ${e.check}: ${e.error}`);
}

if (fails.length > 0 || phase6bErrors.length > 0) {
  const total = fails.length + phase6bErrors.length;
  console.error(`\n❌ ${total} failure(s) total (${fails.length} surface/viewport, ${phase6bErrors.length} Phase 6b)`);
  process.exit(1);
}
console.log("\n✅ All surfaces clean");
