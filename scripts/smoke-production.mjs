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

const URL = args.url;
const ADMIN_TOKEN = args["admin-token"];
const SUPABASE_URL = args["supabase-url"];
const SUPABASE_ANON_KEY = args["supabase-anon-key"];
const SUPABASE_SR_KEY = args["supabase-service-role-key"];
const EXPECTED_REF = args["expected-supabase-ref"];
const SENTRY_ORG = args["sentry-org"];
const SENTRY_PROJECT = args["sentry-project"];
const SENTRY_API_TOKEN = args["sentry-api-token"];

if (!URL || !ADMIN_TOKEN || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SR_KEY || !EXPECTED_REF) {
  console.error("smoke: missing required args. See spec §6.");
  process.exit(2);
}

const SMOKE_RUN_ID = randomUUID();
const results = [];

// Track cookies the server sets so we can include them on subsequent requests.
let cookieJar = "";
let smokeUserId = null;
let coAnonToken = null;

function rememberCookies(res) {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return;
  const pairs = setCookie.split(/,\s*(?=[a-zA-Z0-9_-]+=)/);
  for (const pair of pairs) {
    const nameValue = pair.split(";")[0];
    cookieJar = cookieJar
      ? `${cookieJar}; ${nameValue}`
      : nameValue;
  }
}

async function fetchWith(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookieJar) headers.set("cookie", cookieJar);
  const res = await fetch(`${URL}${path}`, { ...init, headers, redirect: "manual" });
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
  // /chat is the closed-beta entry; first request should set co_anon
  const res = await fetchWith("/chat");
  const setCookie = res.headers.get("set-cookie") ?? "";
  const hasCoAnon = /\bco_anon=/.test(setCookie);
  const hasSecure = /\bSecure\b/i.test(setCookie);
  const hasHttpOnly = /\bHttpOnly\b/i.test(setCookie);
  const hasSameSite = /\bSameSite=Lax\b/i.test(setCookie);
  check("02 anon-cookie", hasCoAnon && hasSecure && hasHttpOnly && hasSameSite,
    `co_anon=${hasCoAnon} Secure=${hasSecure} HttpOnly=${hasHttpOnly} SameSite=${hasSameSite}`);

  // Extract co_anon value from Set-Cookie header for user_id lookup
  const match = setCookie.match(/co_anon=([^;]+)/);
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

async function main() {
  await checkBootAndRtl();
  await checkAnonCookie();
  await checkStaticPages();
  await checkChatReachable();
  await checkConsent();

  // Checks 6-15 + R1 added in subsequent tasks.

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed; smoke_run_id=${SMOKE_RUN_ID}`);
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
