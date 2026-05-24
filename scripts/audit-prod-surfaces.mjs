#!/usr/bin/env node
// scripts/audit-prod-surfaces.mjs
//
// Walks the full CareerOS user journey as the seeded demo user, hitting every
// surface and checking the responses for obvious problems (404, 5xx, missing
// Hebrew content, empty bodies, weird redirects). Prints a markdown-style
// report. Read-only — does not write anything to the DB.
//
// Run: node scripts/audit-prod-surfaces.mjs --cookie <co_anon>
//
// If --cookie is omitted, looks for COOKIE env var.

import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    cookie:  { type: "string" },
    "app-url": { type: "string", default: "https://career-os-wine.vercel.app" },
  },
});
const COOKIE_VALUE = args.cookie || process.env.COOKIE;
if (!COOKIE_VALUE) {
  console.error("missing --cookie <co_anon-value> (or COOKIE env var)");
  process.exit(2);
}
const APP_URL = args["app-url"];
const COOKIE_HEADER = `co_anon=${COOKIE_VALUE}`;

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const fail = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const warn = (s) => `\x1b[33m!\x1b[0m ${s}`;

let passes = 0, failures = 0, warnings = 0;

async function check(label, fn) {
  try {
    const result = await fn();
    if (result === false) {
      console.log(fail(label));
      failures++;
    } else if (result === "warn") {
      console.log(warn(label));
      warnings++;
    } else {
      console.log(ok(label) + (typeof result === "string" ? ` — ${result}` : ""));
      passes++;
    }
  } catch (e) {
    console.log(fail(`${label} — ${e.message}`));
    failures++;
  }
}

async function fetchPage(path, init = {}) {
  const res = await fetch(`${APP_URL}${path}`, {
    ...init,
    headers: { Cookie: COOKIE_HEADER, ...(init.headers || {}) },
  });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/pdf")
    ? await res.arrayBuffer()
    : await res.text();
  return { status: res.status, body, contentType: ct, headers: res.headers };
}

console.log(`\n=== CareerOS prod audit: ${APP_URL} ===\n`);

// ─── 1. Marketing landing ───────────────────────────────────────
console.log("\n## Public surfaces\n");
await check("GET / (landing)", async () => {
  const r = await fetchPage("/");
  if (r.status !== 200) return false;
  if (!r.body.includes("CareerOS") && !r.body.includes("קריירה")) return false;
  return `${r.status}, ${r.body.length} bytes`;
});

await check("GET /privacy (T&C)", async () => {
  const r = await fetchPage("/privacy");
  return r.status === 200 ? `${r.status}` : false;
});

// ─── 2. Chat surface (the recent refresh-bug fix lives here) ───
console.log("\n## Chat\n");
await check("GET /chat — server component preloads messages", async () => {
  const r = await fetchPage("/chat");
  if (r.status !== 200) return false;
  const hasNav = r.body.includes('href="/assessment"') && r.body.includes('href="/cv"') && r.body.includes('href="/recommendations"');
  if (!hasNav) return false;
  return `nav links present`;
});

// ─── 3. Assessment surfaces ────────────────────────────────────
console.log("\n## Assessments\n");
for (const slug of ["", "/riasec", "/big5", "/values", "/constraints"]) {
  await check(`GET /assessment${slug}`, async () => {
    const r = await fetchPage(`/assessment${slug}`);
    return r.status === 200 ? `${r.status}` : false;
  });
}

// ─── 4. CV surface ─────────────────────────────────────────────
console.log("\n## CV\n");
await check("GET /cv", async () => {
  const r = await fetchPage("/cv");
  return r.status === 200 ? `${r.status}` : false;
});

// ─── 5. Recommendations + API ──────────────────────────────────
console.log("\n## Recommendations\n");
await check("GET /recommendations", async () => {
  const r = await fetchPage("/recommendations");
  return r.status === 200 ? `${r.status}` : false;
});

await check("POST /api/recommendations (returns top 10)", async () => {
  const r = await fetchPage("/api/recommendations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  if (r.status !== 200) return false;
  const j = JSON.parse(r.body);
  if (!Array.isArray(j.rankings)) return false;
  if (j.rankings.length < 5) return `only ${j.rankings.length} rankings — expected 10`;
  return `${j.rankings.length} rankings, paths: ${JSON.stringify(j.paths)}`;
});

await check("GET /api/report/pdf returns valid PDF", async () => {
  const r = await fetchPage("/api/report/pdf");
  if (r.status !== 200) return false;
  if (!r.contentType.includes("application/pdf")) return false;
  const buf = new Uint8Array(r.body);
  if (buf.length < 1000) return false;
  // PDF magic: %PDF-
  const head = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (head !== "%PDF") return false;
  return `${buf.length} bytes, %PDF magic OK`;
});

// ─── 6. Plan surface (we just fixed this) ──────────────────────
console.log("\n## Plan (post-fix)\n");
await check("GET /plan", async () => {
  const r = await fetchPage("/plan");
  return r.status === 200 ? `${r.status}` : false;
});

await check("GET /api/plan returns existing plan", async () => {
  const r = await fetchPage("/api/plan");
  if (r.status !== 200) return false;
  const j = JSON.parse(r.body);
  if (!Array.isArray(j.tasks)) return false;
  if (j.tasks.length !== 15) return `wrong task count: ${j.tasks.length}`;
  const days = j.tasks.map(t => t.day).sort((a,b)=>a-b);
  const expected = [2,4,6,8,10,12,14,16,18,20,22,24,26,28,30];
  if (JSON.stringify(days) !== JSON.stringify(expected)) return `bad day distribution: ${days}`;
  return `15 tasks on days ${days.join(",")}`;
});

// ─── 7. Interview surface ──────────────────────────────────────
console.log("\n## Interview\n");
await check("GET /interview (picker page)", async () => {
  const r = await fetchPage("/interview");
  return r.status === 200 ? `${r.status}` : false;
});

// ─── 8. Health checks (no consent required) ────────────────────
console.log("\n## Health\n");
await check("GET /api/health if exists", async () => {
  const r = await fetchPage("/api/health");
  if (r.status === 404) return "warn";
  return r.status === 200 ? `${r.status}` : false;
});

// ─── 9. Sanity: chat history can be replayed ──────────────────
console.log("\n## Chat resume (recent fix)\n");
await check("Demo conversation history loads on /chat", async () => {
  const r = await fetchPage("/chat");
  // After server-component fix, page should embed any prior messages in the
  // useChat() initial state. We can't see SSR text directly via fetch (RSC
  // serializes to flight format), but we can check the response contains
  // the resume banner key OR an empty-state.
  const hasResumeBanner = r.body.includes("ממשיכים מאיפה שעצרת") || r.body.includes("מאיפה שעצרת");
  const hasEmptyState = r.body.includes("בוא נתחיל להכיר") || r.body.includes("ספר לי במשפט אחד");
  if (!hasResumeBanner && !hasEmptyState) return false;
  return hasResumeBanner ? "resume banner present (history found)" : "empty-state present (no prior history)";
});

console.log(`\n=== Summary: ${passes} passes, ${warnings} warnings, ${failures} failures ===\n`);
process.exit(failures > 0 ? 1 : 0);
