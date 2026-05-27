#!/usr/bin/env node
// scripts/seed-demo-user.mjs
//
// Creates a fully-populated anonymous user in PRODUCTION for end-to-end UI
// testing. Outputs a co_anon cookie value the human pastes via DevTools to
// "become" that user and see every populated surface (recommendations, plan,
// PDF report) without filling 4 assessments + chatting by hand.
//
// Run:
//   node scripts/seed-demo-user.mjs \
//     --supabase-url $SUPABASE_URL \
//     --service-role-key $SR_KEY \
//     --app-url https://career-os-wine.vercel.app
//
// Or pull env vars directly:
//   $env:Path = "C:\Users\tmott\AppData\Local\nvm\v24.15.0;" + $env:Path
//   node scripts/seed-demo-user.mjs

import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const { values: args } = parseArgs({
  options: {
    "supabase-url":      { type: "string" },
    "service-role-key":  { type: "string" },
    "app-url":           { type: "string", default: "https://career-os-wine.vercel.app" },
  },
});

// Fall back to .env.local for convenience
let SUPABASE_URL = args["supabase-url"];
let SR_KEY = args["service-role-key"];
if (!SUPABASE_URL || !SR_KEY) {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split(/\r?\n/)) {
      const [k, v] = line.split(/=(.+)/, 2);
      if (k === "NEXT_PUBLIC_SUPABASE_URL" && !SUPABASE_URL) SUPABASE_URL = v;
      if (k === "SUPABASE_SERVICE_ROLE_KEY" && !SR_KEY) SR_KEY = v;
    }
  } catch { /* no .env.local */ }
}
const APP_URL = args["app-url"];

if (!SUPABASE_URL || !SR_KEY) {
  console.error("missing --supabase-url or --service-role-key (and no .env.local fallback)");
  process.exit(2);
}

const svc = createClient(SUPABASE_URL, SR_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─────────────────────────────────────────────────────────────────
// 1. Create anonymous user + session
// ─────────────────────────────────────────────────────────────────
console.log("1. Creating anonymous user…");
const { data: user, error: userErr } = await svc
  .from("users")
  .insert({ is_anonymous: true, display_name: "Demo Tester" })
  .select("id")
  .single();
if (userErr) throw userErr;
const userId = user.id;
console.log(`   user_id=${userId}`);

const coAnonToken = randomBytes(24).toString("base64url");
const { error: sessErr } = await svc
  .from("anonymous_sessions")
  .insert({ token: coAnonToken, user_id: userId });
if (sessErr) throw sessErr;
console.log(`   co_anon token created`);

// ─────────────────────────────────────────────────────────────────
// 2. Consent (processing + disclaimer)
// ─────────────────────────────────────────────────────────────────
console.log("2. Recording consent…");
await svc.from("consents").insert([
  { user_id: userId, purpose: "processing", version: "2026-05-10" },
  { user_id: userId, purpose: "disclaimer", version: "2026-05-10" },
]);

// ─────────────────────────────────────────────────────────────────
// 3. RIASEC — I-dominant profile (Investigative + Enterprising)
// ─────────────────────────────────────────────────────────────────
console.log("3. Inserting RIASEC assessment…");
const riasecResp = {};
const riasecPlan = { R: 3, I: 5, A: 3, S: 4, E: 4, C: 3 }; // target Likert per type
for (let i = 1; i <= 5; i++) {
  for (const t of ["R", "I", "A", "S", "E", "C"]) riasecResp[`${t}${i}`] = riasecPlan[t];
}
// Score = average * 25 (mapped 1..5 → 0..100). With all-fives = 5*25=125, but normalize to 100.
// Actual scoring uses (sum/count - 1) / 4 * 100 → (mean-1)/4*100
const norm = (mean) => Math.round(((mean - 1) / 4) * 100);
// hollandCode is computed top-3 by value as a 3-char STRING, e.g. "IES"
const riasecBare = {
  R: norm(riasecPlan.R), I: norm(riasecPlan.I), A: norm(riasecPlan.A),
  S: norm(riasecPlan.S), E: norm(riasecPlan.E), C: norm(riasecPlan.C),
};
const riasecCode = (["R","I","A","S","E","C"])
  .sort((a, b) => riasecBare[b] - riasecBare[a])
  .slice(0, 3)
  .join("");
const riasecScores = { ...riasecBare, hollandCode: riasecCode };
await svc.from("assessments").insert({
  user_id: userId, type: "riasec",
  responses: riasecResp, scores: riasecScores, items_version: 2,
});

// ─────────────────────────────────────────────────────────────────
// 4. Big5 — balanced with high O, C, E
// ─────────────────────────────────────────────────────────────────
console.log("4. Inserting Big5 assessment…");
const big5Resp = {};
// 4 items per trait, 2 keyed + 2 reverse-keyed
// For a "high O" profile: O1,O2 (keyed) = 5; O3,O4 (reverse) = 1
const traitTargets = { O: 5, C: 4, E: 4, A: 4, N: 2 };
for (const trait of ["O", "C", "E", "A", "N"]) {
  big5Resp[`${trait}1`] = traitTargets[trait];
  big5Resp[`${trait}2`] = traitTargets[trait];
  big5Resp[`${trait}3`] = 6 - traitTargets[trait]; // reverse-keyed
  big5Resp[`${trait}4`] = 6 - traitTargets[trait];
}
const big5Scores = {
  O: norm(traitTargets.O), C: norm(traitTargets.C), E: norm(traitTargets.E),
  A: norm(traitTargets.A), N: norm(traitTargets.N),
};
await svc.from("assessments").insert({
  user_id: userId, type: "big5",
  responses: big5Resp, scores: big5Scores, items_version: 1,
});

// ─────────────────────────────────────────────────────────────────
// 5. Values — pick 5 + rank 3
// ─────────────────────────────────────────────────────────────────
console.log("5. Inserting Values assessment…");
const valuesSubmission = {
  picked: ["impact", "learning", "challenge", "balance", "creativity"],
  ranked: ["impact", "learning", "challenge"],
};
// scoreValues() returns { topThree, alsoPicked } — matching-engine reads .scores
const valuesScores = {
  topThree: [...valuesSubmission.ranked],
  alsoPicked: valuesSubmission.picked.filter((id) => !valuesSubmission.ranked.includes(id)),
};
await svc.from("assessments").insert({
  user_id: userId, type: "values",
  responses: valuesSubmission, scores: valuesScores, items_version: 1,
});

// ─────────────────────────────────────────────────────────────────
// 6. Constraints — Tel Aviv, advanced English, 20h/wk
// ─────────────────────────────────────────────────────────────────
console.log("6. Inserting Constraints…");
const constraints = {
  location_he: "מרכז",
  remote_ok: true,
  time_per_week_hours: 20,
  training_budget_nis: 8000,
  english_level: "advanced",
  risk_tolerance: 6,
  needs_immediate_income: false,
};
await svc.from("assessments").insert({
  user_id: userId, type: "constraints",
  responses: constraints, scores: constraints, items_version: 1,
});

// ─────────────────────────────────────────────────────────────────
// 7. Career profile (mirrors what chat-extraction would produce)
// ─────────────────────────────────────────────────────────────────
console.log("7. Writing chat-extracted profile…");
await svc.from("career_profile").insert({
  user_id: userId,
  conversation_id: null,
  current_stage: "complete",
  extraction_count: 4,
  last_extracted_at: new Date().toISOString(),
  data: {
    interests: { R: 50, I: 100, A: 50, S: 75, E: 75, C: 50 },
    skills: [
      { id: "communication", name_he: "תקשורת", level: 0.85 },
      { id: "analysis",      name_he: "ניתוח נתונים", level: 0.8 },
      { id: "problem_solving", name_he: "פתרון בעיות", level: 0.9 },
      { id: "english",       name_he: "אנגלית", level: 0.85 },
    ],
    values: ["impact", "learning", "challenge"],
    constraints,
    summary_he: "בן 22 אחרי צבא, רקע ביחידה טכנולוגית, מחפש כיוון מקצועי שמשלב חשיבה אנליטית עם השפעה אמיתית.",
  },
});

// ─────────────────────────────────────────────────────────────────
// 8. Trigger recommendations + plan via public API with this user's cookie
// ─────────────────────────────────────────────────────────────────
console.log("8. Triggering POST /api/recommendations (LLM call, ~10-20s)…");
const recRes = await fetch(`${APP_URL}/api/recommendations`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: `co_anon=${coAnonToken}`,
  },
  body: JSON.stringify({ force: true }),
});
const recJson = await recRes.json();
if (!recRes.ok) {
  console.error("   recommendations failed:", recRes.status, recJson);
} else {
  console.log(`   recs ok: top ${recJson.rankings?.length ?? 0} occupations, paths=${JSON.stringify(recJson.paths)}`);
}

console.log("9. Triggering POST /api/plan/generate (LLM call, ~15-25s)…");
try {
  const planRes = await fetch(`${APP_URL}/api/plan/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `co_anon=${coAnonToken}`,
    },
  });
  const planBody = await planRes.text();
  let planJson;
  try { planJson = JSON.parse(planBody); } catch { planJson = { _raw: planBody.slice(0, 120) }; }
  if (!planRes.ok) {
    console.error(`   plan failed (status=${planRes.status}):`, planJson);
    console.error("   (You can still trigger plan generation manually by visiting /plan and clicking the Generate button.)");
  } else {
    console.log(`   plan ok: archetype=${planJson.archetype}, ${planJson.tasks?.length ?? 0} tasks`);
  }
} catch (e) {
  console.error("   plan request errored:", e.message);
  console.error("   (You can still trigger plan generation manually by visiting /plan and clicking the Generate button.)");
}

// ─────────────────────────────────────────────────────────────────
// Output usage instructions
// ─────────────────────────────────────────────────────────────────
console.log("\n");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("DEMO USER READY");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");
console.log("To browse the app as this seeded user:");
console.log("");
console.log("1. Open Chrome DevTools (F12) on https://career-os-wine.vercel.app");
console.log("2. Go to Application tab → Cookies → https://career-os-wine.vercel.app");
console.log("3. Find the `co_anon` cookie. EDIT its Value to:");
console.log("");
console.log(`     ${coAnonToken}`);
console.log("");
console.log("4. Refresh any page. You're now the seeded demo user.");
console.log("");
console.log("Surfaces with populated data:");
console.log(`   • Recommendations: ${APP_URL}/recommendations`);
console.log(`   • 30-day plan:     ${APP_URL}/plan`);
console.log(`   • Assessments:     ${APP_URL}/assessment  (all 4 marked complete)`);
console.log(`   • PDF report:      Click "הורד דוח" on /recommendations`);
console.log("");
console.log(`user_id=${userId}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
