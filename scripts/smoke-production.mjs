#!/usr/bin/env node
// scripts/smoke-production.mjs
// Phase 7a blocking smoke suite. See specs/2026-05-20-career-os-07a-launch-readiness-design.md §6.
// Run: node scripts/smoke-production.mjs --url https://... --admin-token $TOKEN ...

import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const { values: args } = parseArgs({
  options: {
    url:                        { type: "string" },
    "admin-token":              { type: "string" },
    "supabase-url":             { type: "string" },
    "supabase-anon-key":        { type: "string" },
    "supabase-service-role-key":{ type: "string" },
    "expected-supabase-ref":    { type: "string" },
    "sentry-org":               { type: "string" },
    "sentry-project":           { type: "string" },
    "sentry-api-token":         { type: "string" },
    "skip-admin-success":       { type: "boolean", default: false },
  },
});

const APP_URL = args.url;
const ADMIN_TOKEN = args["admin-token"];
const SUPABASE_URL = args["supabase-url"];
const SUPABASE_ANON_KEY = args["supabase-anon-key"];
const SUPABASE_SR_KEY = args["supabase-service-role-key"];
const EXPECTED_REF = args["expected-supabase-ref"];
const SENTRY_ORG = args["sentry-org"];
const SENTRY_PROJECT = args["sentry-project"];
const SENTRY_API_TOKEN = args["sentry-api-token"];

if (!APP_URL || !ADMIN_TOKEN || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SR_KEY || !EXPECTED_REF) {
  console.error("smoke: missing required args. See spec §6.");
  process.exit(2);
}

const SMOKE_RUN_ID = randomUUID();
const results = [];

// Track cookies the server sets so we can include them on subsequent requests.
let cookieJar = "";
let smokeUserId = null;
let coAnonToken = null;
// Persist the first co_anon-issuing Set-Cookie line so check 02 can inspect
// its attributes even after the cookie is in the jar (subsequent requests
// won't re-issue the cookie).
let firstCoAnonSetCookie = "";

function rememberCookies(res) {
  // Modern undici/Node 20+ exposes getSetCookie() returning an array; older
  // platforms only have get("set-cookie") which returns the first header.
  const setCookies = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  for (const sc of setCookies) {
    if (!firstCoAnonSetCookie && /\bco_anon=/.test(sc)) firstCoAnonSetCookie = sc;
    const nameValue = sc.split(";")[0];
    cookieJar = cookieJar ? `${cookieJar}; ${nameValue}` : nameValue;
  }
}

async function fetchWith(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookieJar) headers.set("cookie", cookieJar);
  const res = await fetch(`${APP_URL}${path}`, { ...init, headers, redirect: "manual" });
  rememberCookies(res);
  return res;
}

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
}

// ── #1 App boots + RTL ───────────────────────────────────────────
async function checkBootAndRtl() {
  const res = await fetchWith("/");
  const html = await res.text();
  check("01 boot+rtl",
    res.status === 200 && html.includes('dir="rtl"') && html.includes('lang="he"'),
    `status=${res.status}`);
}

// ── #2 Anonymous cookie attributes + capture user_id for cleanup ─
async function checkAnonCookie() {
  // /chat is the closed-beta entry. Cookie was already issued on the earlier
  // check 01 request to /, so the response here won't re-set co_anon. We
  // inspect the persisted `firstCoAnonSetCookie` captured by rememberCookies.
  await fetchWith("/chat");
  const coAnonCookie = firstCoAnonSetCookie;
  const hasCoAnon = /\bco_anon=/.test(coAnonCookie);
  const hasSecure = /\bSecure\b/i.test(coAnonCookie);
  const hasHttpOnly = /\bHttpOnly\b/i.test(coAnonCookie);
  const hasSameSite = /\bSameSite=Lax\b/i.test(coAnonCookie);
  check("02 anon-cookie", hasCoAnon && hasSecure && hasHttpOnly && hasSameSite,
    `co_anon=${hasCoAnon} Secure=${hasSecure} HttpOnly=${hasHttpOnly} SameSite=${hasSameSite}`);

  // Extract co_anon value from the matched cookie line for user_id lookup
  const match = coAnonCookie.match(/co_anon=([^;]+)/);
  if (match) coAnonToken = match[1];

  // Capture the smoke user_id IMMEDIATELY so cleanup works even on early failure.
  // Middleware creates the anonymous_sessions row before any other write.
  if (coAnonToken) {
    const svc = createClient(SUPABASE_URL, SUPABASE_SR_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: session } = await svc
      .from("anonymous_sessions")
      .select("user_id")
      .eq("token", coAnonToken)
      .maybeSingle();
    if (session?.user_id) smokeUserId = session.user_id;
  }
  check("02b smoke-user-captured", !!smokeUserId,
    `user_id=${smokeUserId ? smokeUserId.slice(0, 8) + "..." : "missing"}`);

  // Persistence: a second request must round-trip the cookie back.
  const res2 = await fetchWith("/chat");
  check("02c anon-cookie-persists", res2.status === 200, `status=${res2.status}`);
}

// ── #3 Static pages render ───────────────────────────────────────
async function checkStaticPages() {
  for (const path of ["/privacy", "/terms"]) {
    const res = await fetchWith(path);
    const html = await res.text();
    const ok = res.status === 200 && /<main|<h1/.test(html);
    check(`03 static ${path}`, ok, `status=${res.status}`);
  }
}

// ── #4 Chat reachability ─────────────────────────────────────────
async function checkChatReachable() {
  // Without consent: 403 expected.
  // AI SDK v6 UIMessage shape uses {parts: [{type:'text', text:'...'}]}.
  const res403 = await fetchWith("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "שלום" }] }],
    }),
  });
  check("04a chat-no-consent", res403.status === 403,
    `status=${res403.status}`);
}

// ── #5 Consent endpoint (current contract: 200 {ok:true}; body ignored) ──
async function checkConsent() {
  const post = await fetchWith("/api/consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const postBody = await post.json().catch(() => ({}));
  check("05a consent-post", post.status === 200 && postBody.ok === true,
    `status=${post.status} ok=${postBody.ok}`);

  const get = await fetchWith("/api/consent");
  const getBody = await get.json().catch(() => ({}));
  check("05b consent-get", get.status === 200 && getBody.processing === true && getBody.disclaimer === true,
    `processing=${getBody.processing} disclaimer=${getBody.disclaimer}`);

  // Now chat should be unblocked (small deterministic prompt; abort after first chunk)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchWith("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "היי" }] }],
      }),
      signal: ctrl.signal,
    });
    if (res.status !== 200) {
      check("05c chat-with-consent", false, `status=${res.status}`);
    } else if (!res.body) {
      check("05c chat-with-consent", false, "no body");
    } else {
      const reader = res.body.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      check("05c chat-with-consent", !!value && value.length > 0, "got first chunk");
    }
  } catch (err) {
    check("05c chat-with-consent", false, `error: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── #6 Recommendations shape ─────────────────────────────────────
async function checkRecommendationsShape() {
  const res = await fetchWith("/api/recommendations", { method: "POST" });
  if (res.status !== 200) {
    check("06 recs-shape", false, `status=${res.status}`);
    return null;
  }
  const body = await res.json();
  const ok = typeof body.recommendation_id === "string" &&
             body.thumbs && typeof body.thumbs === "object";
  check("06 recs-shape", ok, `rec_id=${!!body.recommendation_id} thumbs=${!!body.thumbs}`);
  return body;
}

// ── #7 Thumb writes ──────────────────────────────────────────────
async function checkThumbWrites(recommendationId, occupationId) {
  const targetId = `${recommendationId}:${occupationId}`;
  const res = await fetchWith("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "thumb",
      surface: "recommendations",
      target_type: "recommendation_occupation",
      target_id: targetId,
      thumbs_value: 1,
      metadata: { smoke_run_id: SMOKE_RUN_ID },
    }),
  });
  if (res.status !== 200) {
    check("07 thumb-write", false, `status=${res.status}`);
    return;
  }
  // Service-role lookup to confirm the row exists and belongs to our smoke user
  const svc = createClient(SUPABASE_URL, SUPABASE_SR_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await svc
    .from("feedback")
    .select("user_id")
    .eq("target_id", targetId)
    .eq("user_id", smokeUserId)
    .eq("thumbs_value", 1)
    .maybeSingle();
  check("07 thumb-write", !!data, `row=${!!data} matches_smoke_user=${data?.user_id === smokeUserId}`);
}

// ── #8 NPS idempotency ───────────────────────────────────────────
async function checkNpsIdempotency() {
  const body = {
    kind: "nps",
    nps_score: 9,
    nps_trigger: "pdf_download",
    comment_he: "",
  };
  const r1 = await fetchWith("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j1 = await r1.json().catch(() => ({}));
  const okFirst = r1.status === 200 && j1.ok === true && !j1.already;
  check("08a nps-first", okFirst, `status=${r1.status} ok=${j1.ok} already=${j1.already}`);

  const r2 = await fetchWith("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j2 = await r2.json().catch(() => ({}));
  const okSecond = r2.status === 200 && j2.ok === true && j2.already === true;
  check("08b nps-already", okSecond, `status=${r2.status} already=${j2.already}`);
}

// ── #9 NPS dismiss ───────────────────────────────────────────────
async function checkNpsDismiss() {
  const res = await fetchWith("/api/feedback/nps-dismiss", { method: "POST" });
  check("09 nps-dismiss", res.status === 204, `status=${res.status}`);
}

// ── #10 Admin export auth matrix (status + content-type ONLY) ────
async function checkAdminExportAuth() {
  if (!args["skip-admin-success"]) {
    const ok = await fetch(`${APP_URL}/api/admin/feedback/export`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const okStatus = ok.status === 200;
    const okType = (ok.headers.get("content-type") ?? "").startsWith("text/csv");
    // Drain body without inspecting it
    if (ok.body) await ok.body.cancel();
    check("10a admin-ok", okStatus && okType,
      `status=${ok.status} ct=${ok.headers.get("content-type")}`);
  } else {
    check("10a admin-ok-skipped", true, "skipped via --skip-admin-success (preview env)");
  }

  const wrong = await fetch(`${APP_URL}/api/admin/feedback/export`, {
    headers: { authorization: "Bearer wrong-token-different-length-than-real-one" },
  });
  if (wrong.body) await wrong.body.cancel();
  check("10b admin-wrong", wrong.status === 401, `status=${wrong.status}`);

  const noAuth = await fetch(`${APP_URL}/api/admin/feedback/export`);
  if (noAuth.body) await noAuth.body.cancel();
  check("10c admin-noauth", noAuth.status === 401, `status=${noAuth.status}`);
}

// ── #11 Migration check (read-only) ──────────────────────────────
async function checkMigrations() {
  // PostgREST exposes the public schema for the supabase-js client. The cleanest
  // way to assert a column exists is a SELECT limit(0) which returns no rows
  // but still validates the column list at the query layer.
  const svc = createClient(SUPABASE_URL, SUPABASE_SR_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: fbErr } = await svc
    .from("feedback")
    .select("id, surface, target_type, target_id, thumbs_value, nps_score, nps_trigger, comment_he, metadata, created_at, updated_at, user_id")
    .limit(0);
  check("11a migration-feedback", !fbErr, fbErr ? `error=${fbErr.message}` : "feedback table + 12 cols exist");

  const { error: usrErr } = await svc
    .from("users")
    .select("id, nps_eligibility_first_at, nps_submitted_at, nps_dismissed_at, nps_trigger_first, first_report_downloaded_at")
    .limit(0);
  check("11b migration-users-nps", !usrErr, usrErr ? `error=${usrErr.message}` : "users NPS cols exist");
}

// ── #12 Storage bucket ───────────────────────────────────────────
async function checkStorage() {
  const svc = createClient(SUPABASE_URL, SUPABASE_SR_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: bucket } = await svc.storage.getBucket("cv-uploads");
  check("12a storage-private",
    bucket && bucket.public === false,
    `exists=${!!bucket} public=${bucket?.public}`);

  // Anon must not be able to READ any path inside the bucket. Two acceptable
  // signals of denial: (a) Storage returns an explicit error, OR (b) Storage
  // returns an empty array because the only SELECT policy
  // (cv_storage_select_own) filters to user_id and anon has none. Supabase
  // returns empty-no-error for the policy-filtered case — that's still secure.
  // Anything non-empty means a leak.
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: anonList, error } = await anon.storage.from("cv-uploads").list();
  const empty = Array.isArray(anonList) && anonList.length === 0;
  check("12b storage-anon-denied",
    !!error || empty,
    error ? `denied (expected): ${error.message}` : empty ? "RLS-filtered to 0 rows (private to owner)" : `FAIL: anon listed ${anonList?.length} entries`);
}

// ── #13 Security headers (CSP deferred to 7b — not asserted) ─────
async function checkSecurityHeaders() {
  const r = await fetch(`${APP_URL}/api/admin/feedback/export`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  if (r.body) await r.body.cancel();
  check("13 nosniff",
    r.headers.get("x-content-type-options") === "nosniff",
    `nosniff=${r.headers.get("x-content-type-options")}`);
}

// ── #14 Env sanity (existence-check only — never print values) ───
async function checkEnvSanity() {
  // Required args were already validated at the top of the script (exit 2 if missing).
  // Here we assert NEXT_PUBLIC_SUPABASE_URL host matches the expected prod ref.
  const required = ["url", "admin-token", "supabase-url", "supabase-anon-key",
                    "supabase-service-role-key", "expected-supabase-ref"];
  const missing = required.filter((k) => !args[k]);
  check("14a env-args-present", missing.length === 0,
    missing.length ? `missing=${missing.join(",")}` : "all-set");

  const host = new URL(SUPABASE_URL).host;
  const matches = host === `${EXPECTED_REF}.supabase.co`;
  check("14b env-supabase-ref", matches,
    `host=${host} expected=${EXPECTED_REF}.supabase.co`);
}

// ── #15 Cleanup (cascade-DELETE by user_id) ──────────────────────
async function cleanup() {
  if (!smokeUserId) {
    check("15 cleanup-skipped", true, "no smoke user_id captured");
    return;
  }
  const svc = createClient(SUPABASE_URL, SUPABASE_SR_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error, count } = await svc
    .from("users")
    .delete({ count: "exact" })
    .eq("id", smokeUserId);
  // Log COUNT only, never payloads
  check("15 cleanup", !error,
    `deleted_user_count=${count ?? 0}${error ? " error=" + error.message : ""}`);
}

// ── R1 Sentry pipeline (release evidence, non-blocking) ──────────
// IMPORTANT: must NEVER throw — any network/JSON error must be caught
// and logged as a check failure (which is itself non-blocking for exit code).
async function checkSentryPipeline() {
  try {
    if (!SENTRY_ORG || !SENTRY_PROJECT || !SENTRY_API_TOKEN) {
      check("R1 sentry-skipped", true, "sentry args not provided");
      return;
    }
    // Trigger the test event
    const trig = await fetch(`${APP_URL}/api/_internal/sentry-test`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    if (trig.status !== 200) {
      check("R1a sentry-trigger", false, `status=${trig.status}`);
      return;
    }
    const triggerBody = await trig.json();
    const eventId = triggerBody?.eventId;
    check("R1a sentry-trigger", typeof eventId === "string" && eventId.length >= 16,
      `eventId=${eventId ? eventId.slice(0, 8) + "..." : "missing"}`);
    if (!eventId) return;

    // Poll Sentry Events API for up to 5 min
    const deadline = Date.now() + 5 * 60 * 1000;
    let found = false;
    while (Date.now() < deadline) {
      try {
        const sentryRes = await fetch(
          `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/events/?query=event.id:${eventId}`,
          { headers: { authorization: `Bearer ${SENTRY_API_TOKEN}` } },
        );
        if (sentryRes.ok) {
          const arr = await sentryRes.json();
          if (Array.isArray(arr) && arr.length > 0) {
            found = true;
            break;
          }
        }
      } catch (pollErr) {
        console.warn(`R1 poll attempt failed: ${pollErr.message}`);
      }
      await new Promise((r) => setTimeout(r, 15000));
    }
    check("R1b sentry-event-visible", found,
      `event polling completed; visible=${found}`);
  } catch (err) {
    check("R1 sentry-error", false, `unexpected: ${err.message}`);
  }
}

async function main() {
  try {
    await checkBootAndRtl();
    await checkAnonCookie();
    await checkStaticPages();
    await checkChatReachable();
    await checkConsent();

    const recs = await checkRecommendationsShape();
    const KNOWN_OCC_ID = "data-analyst";
    if (recs?.recommendation_id) {
      await checkThumbWrites(recs.recommendation_id, KNOWN_OCC_ID);
    } else {
      check("07 thumb-write", false, "no recommendation_id from check 6");
    }
    await checkNpsIdempotency();
    await checkNpsDismiss();
    await checkAdminExportAuth();

    await checkMigrations();
    await checkStorage();
    await checkSecurityHeaders();
    await checkEnvSanity();
  } finally {
    await cleanup();
  }

  // R1 is release-evidence, runs but doesn't block exit
  const beforeR1 = results.length;
  await checkSentryPipeline();
  const r1Results = results.slice(beforeR1);

  const failed = results.slice(0, beforeR1).filter((r) => !r.ok);
  console.log(`\nblocking ${beforeR1 - failed.length}/${beforeR1} passed`);
  console.log(`release-evidence R1: ${r1Results.filter((r) => r.ok).length}/${r1Results.length} ok`);
  console.log(`smoke_run_id=${SMOKE_RUN_ID}`);
  if (failed.length > 0) {
    console.error(JSON.stringify(failed, null, 2));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("smoke: fatal", err);
  process.exit(2);
});
