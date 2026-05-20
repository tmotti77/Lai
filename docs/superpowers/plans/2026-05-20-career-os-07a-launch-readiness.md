# Phase 7a Implementation Plan — Production Launch Readiness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the smoke runner, internal Sentry test endpoint, Node 24 upgrade, README env-doc expansion, and rollback runbook — then verify a real production deploy against the smoke suite + manual user journey.

**Architecture:** Two parallel tracks. Track A (this PR) is code + docs: Node 24 upgrade, `scripts/smoke-production.mjs` (15 blocking checks + R1 Sentry polling), `scripts/smoke-cleanup.mjs` (async sweeper), `/api/_internal/sentry-test` endpoint, README, rollback runbook. Track B is infrastructure setup by the human at deploy time (Vercel project, Supabase prod project, env vars, firewall, Sentry API token, Anthropic spend cap). Track C is verification (deploy + smoke run + manual walk + rollback dry-run). Tasks are tagged `[agent]`, `[human]`, or `[agent+human]` to make ownership explicit.

**Tech Stack:** Node 24 LTS • Next.js 16 App Router • Supabase (Postgres + RLS + Storage) • `@sentry/nextjs` (server+edge) • `@vercel/analytics` • Vitest • PowerShell (Windows host).

**Spec:** `docs/superpowers/specs/2026-05-20-career-os-07a-launch-readiness-design.md` (commit `89f9d6d`, Codex-approved).

---

## File map

### New files

```
app/api/_internal/sentry-test/route.ts         POST: gated by ADMIN_EXPORT_TOKEN; throws + flushes + returns {eventId}
scripts/smoke-production.mjs                   15-check blocking smoke + R1 Sentry-event poller
scripts/smoke-cleanup.mjs                      Async sweeper for stale anonymous users
docs/superpowers/runbooks/launch-rollback.md   Operational quick-reference extracted from spec §8
tests/unit/api/sentry-test-route.test.ts       Unit test for auth gating
```

### Modified files

```
.nvmrc                                          20 → 24
package.json                                    engines.node "^24"; @types/node "^24"
.github/workflows/*.yml                         CI runner Node 24
README.md                                       Production env-vars docs (currently only ADMIN_EXPORT_TOKEN)
CLAUDE.md                                       Phase 7a architecture section
```

### Not modified (intentionally)

- No CSP middleware or headers code (decision #14, deferred to 7b)
- No `/api/consent` contract changes (spec matches current `200 {ok:true}`)
- No root URL redirect (decision #15, closed-beta enters at `/chat`)
- No code-level rate limiting (decision #13, Vercel Firewall config only)
- No matching engine / AI prompts / UI surfaces

---

## Task 0 [agent]: Create feature branch

- [ ] **Step 1: Branch off main**

```powershell
git checkout main
git pull --ff-only
git checkout -b feat/phase-7a-launch-readiness
```

All Phase 7a code tasks land on this branch. (Task 24 [CLAUDE.md] lands separately on `main` after the PR merges.)

---

## Task 1 [agent]: Node 24 upgrade — local toolchain

**Files:**
- Modify: `.nvmrc`
- Modify: `package.json`

- [ ] **Step 1: Bump .nvmrc**

Edit `.nvmrc`:

```
24
```

- [ ] **Step 2: Bump engines.node + @types/node**

In `package.json`, set:
```json
{
  "engines": { "node": "^24.0.0" },
  "devDependencies": {
    "@types/node": "^24.0.0"
  }
}
```

(Preserve existing entries; only change those two values.)

- [ ] **Step 3: Install under Node 24 (regenerates lockfile)**

```powershell
nvm use 24
npm install
```

If `nvm use 24` says version not installed, run `nvm install 24` first.

**Note:** use `npm install` (not `npm ci`) because the lockfile needs to update for the new `@types/node` version. `npm ci` would fail with a lockfile/package-json mismatch.

- [ ] **Step 4: Sanity-check with npm ci (after install regenerated lockfile)**

```powershell
npm ci
```

This should now succeed cleanly. If it fails, the lockfile didn't update properly — re-run `npm install`.

- [ ] **Step 5: Verify type-check + tests + build pass under Node 24**

```powershell
node --version          # → v24.x
npx tsc --noEmit
npm test
npm run build
```

All four must succeed. If `@sentry/nextjs` or any other dep complains about Node 24, STOP and report — likely just needs a version bump.

- [ ] **Step 6: Commit**

```powershell
git add .nvmrc package.json package-lock.json
git commit -m "chore(node): upgrade .nvmrc + engines + @types/node to 24

Node 20 EOL 2026-04-30. Vercel supports Node 24 LTS for builds and
functions. Phase 7a launch readiness mandates this upgrade before
prod deploy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 [agent]: Node 24 in CI workflow

**Files:**
- Modify: `.github/workflows/*.yml` (whatever workflow runs `npm test` / `npm run build`)

- [ ] **Step 1: Find workflow files**

```powershell
Get-ChildItem .github\workflows\*.yml
```

Read each to find the one(s) that run tests/build.

- [ ] **Step 2: Bump `node-version` to 24**

In every `actions/setup-node` step, change:

```yaml
with:
  node-version: '20'   # or whatever it currently is
```

to:

```yaml
with:
  node-version: '24'
```

- [ ] **Step 3: Push and verify CI runs under 24**

```powershell
git add .github/workflows
git commit -m "ci: pin Node 24 in workflows (matches .nvmrc)"
```

Push to a feature branch; verify the CI run shows Node 24 in the logs. Once green, the commit can land. Don't merge to main yet — this lands as part of the Phase 7a PR.

---

## Task 3 [agent]: `/api/_internal/sentry-test` endpoint with TDD

**Files:**
- Create: `app/api/_internal/sentry-test/route.ts`
- Create: `tests/unit/api/sentry-test-route.test.ts`

- [ ] **Step 1: Write failing unit test**

```typescript
// tests/unit/api/sentry-test-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(() => "abc123def456abc123def456abc12345"),
  flush: vi.fn().mockResolvedValue(true),
}));

import { POST } from "@/app/api/_internal/sentry-test/route";
import { captureException, flush } from "@sentry/nextjs";

beforeEach(() => vi.clearAllMocks());

function makeReq(token: string | null): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request("http://test/api/_internal/sentry-test", {
    method: "POST",
    headers,
  });
}

describe("POST /api/_internal/sentry-test", () => {
  it("returns 401 without Bearer token", async () => {
    process.env.ADMIN_EXPORT_TOKEN = "expected-token-value";
    // Route signature is (req: NextRequest); cast `as never` per existing route-test convention
    const res = await POST(makeReq(null) as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    process.env.ADMIN_EXPORT_TOKEN = "expected-token-value";
    const res = await POST(makeReq("wrong-token-length-different-from-expected") as never);
    expect(res.status).toBe(401);
  });

  it("returns 503 when ADMIN_EXPORT_TOKEN env not set", async () => {
    delete process.env.ADMIN_EXPORT_TOKEN;
    const res = await POST(makeReq("anything") as never);
    expect(res.status).toBe(503);
  });

  it("captures + flushes and returns eventId on valid token", async () => {
    process.env.ADMIN_EXPORT_TOKEN = "expected-token-value";
    const res = await POST(makeReq("expected-token-value") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eventId).toBe("abc123def456abc123def456abc12345");
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(5000);
  });
});
```

- [ ] **Step 2: Run failing test**

```powershell
npx vitest run tests/unit/api/sentry-test-route.test.ts
```

Expected: FAIL with `Cannot find module '@/app/api/_internal/sentry-test/route'`.

- [ ] **Step 3: Implement the route**

```typescript
// app/api/_internal/sentry-test/route.ts
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authOk(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.ADMIN_EXPORT_TOKEN;
  if (!token || !expected) return false;
  const tokenBuf = Buffer.from(token, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (tokenBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(tokenBuf, expectedBuf);
}

export async function POST(req: NextRequest) {
  if (!process.env.ADMIN_EXPORT_TOKEN) {
    return NextResponse.json({ error: "smoke_disabled" }, { status: 503 });
  }
  if (!authOk(req)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const eventId = Sentry.captureException(
    new Error("phase-7a smoke: sentry pipeline verification")
  );
  await Sentry.flush(5000);

  return NextResponse.json({ eventId });
}
```

- [ ] **Step 4: Run test, expect PASS**

```powershell
npx vitest run tests/unit/api/sentry-test-route.test.ts
```

All 4 cases pass.

- [ ] **Step 5: Type-check clean**

```powershell
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```powershell
git add app/api/_internal/sentry-test/route.ts tests/unit/api/sentry-test-route.test.ts
git commit -m "feat(observability): /api/_internal/sentry-test endpoint

Bearer-gated (reuses ADMIN_EXPORT_TOKEN) test endpoint that throws
+ flushes a captured exception and returns the Sentry eventId.
Used by smoke-production.mjs R1 check to verify the Sentry pipeline
via polling the Sentry Events API.

Returns 503 if ADMIN_EXPORT_TOKEN is unset (preview env). 401 on
wrong/missing token via timingSafeEqual on UTF-8 byte buffers
(consistent with admin-export route auth).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 [agent]: Smoke runner skeleton + checks 1–5

**Files:**
- Create: `scripts/smoke-production.mjs`

- [ ] **Step 1: Create the skeleton with arg parsing + first 5 checks**

```javascript
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
    "skip-admin-success":       { type: "boolean", default: false },  // preview-env mode
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
let smokeUserId = null;   // captured from anonymous_sessions right after cookie creation
let coAnonToken = null;   // the co_anon cookie value, used to look up our user_id

function rememberCookies(res) {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return;
  // Take only the cookie name=value pairs (not attributes).
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
```

- [ ] **Step 2: Run against dev server (sanity-check the skeleton)**

```powershell
npm run dev    # in another terminal
node scripts/smoke-production.mjs `
  --url http://localhost:3000 `
  --admin-token "any-value-not-used-by-checks-1-5" `
  --supabase-url $env:NEXT_PUBLIC_SUPABASE_URL `
  --supabase-anon-key $env:NEXT_PUBLIC_SUPABASE_ANON_KEY `
  --supabase-service-role-key $env:SUPABASE_SERVICE_ROLE_KEY `
  --expected-supabase-ref "wqswamtcppjmkwykukjp"
```

Expected: checks 01, 02, 03, 04a, 05a, 05b, 05c all pass. (Some flakiness on 05c is acceptable since chat hits Anthropic — re-run on flake.)

- [ ] **Step 3: Commit**

```powershell
git add scripts/smoke-production.mjs
git commit -m "feat(smoke): scripts/smoke-production.mjs skeleton + checks 1-5

Arg parsing, cookie jar, fetch wrapper, result reporting, and the
first 5 blocking checks: boot+RTL, anon cookie attrs+persistence,
static pages, chat reachability (403 without consent), consent
endpoint (200 {ok:true}; body ignored per current contract) +
chat-unblocked after consent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 [agent]: Smoke runner checks 6–10

**Files:**
- Modify: `scripts/smoke-production.mjs`

- [ ] **Step 1: Append checks 6–10 + cleanup tracking**

Add to `scripts/smoke-production.mjs` (between the existing `checkConsent()` and `main()`):

```javascript
// (smokeUserId + coAnonToken declared at top of file; captured during checkAnonCookie)

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
    const ok = await fetch(`${URL}/api/admin/feedback/export`, {
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

  const wrong = await fetch(`${URL}/api/admin/feedback/export`, {
    headers: { authorization: "Bearer wrong-token-different-length-than-real-one" },
  });
  if (wrong.body) await wrong.body.cancel();
  check("10b admin-wrong", wrong.status === 401, `status=${wrong.status}`);

  const noAuth = await fetch(`${URL}/api/admin/feedback/export`);
  if (noAuth.body) await noAuth.body.cancel();
  check("10c admin-noauth", noAuth.status === 401, `status=${noAuth.status}`);
}
```

Update `main()`:

```javascript
async function main() {
  await checkBootAndRtl();
  await checkAnonCookie();
  await checkStaticPages();
  await checkChatReachable();
  await checkConsent();

  const recs = await checkRecommendationsShape();
  // Pick any occupation id from the catalog for thumb test
  // (use a known catalog id that exists in occupations table)
  const KNOWN_OCC_ID = "data-analyst";
  if (recs?.recommendation_id) {
    await checkThumbWrites(recs.recommendation_id, KNOWN_OCC_ID);
  } else {
    check("07 thumb-write", false, "no recommendation_id from check 6");
  }
  await checkNpsIdempotency();
  await checkNpsDismiss();
  await checkAdminExportAuth();

  // Checks 11-15 + R1 added in subsequent tasks.

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed; smoke_run_id=${SMOKE_RUN_ID}`);
  if (failed.length > 0) {
    console.error(JSON.stringify(failed, null, 2));
    process.exit(1);
  }
  process.exit(0);
}
```

- [ ] **Step 2: Sanity-check against dev server**

Run the same command from Task 4 Step 2. Expected: all 11 checks pass. If `06 recs-shape` returns null `recommendation_id`, that's a route bug — the spec contract requires the field to always be present (empty `paths`/`rankings` arrays are OK for a fresh user, but `recommendation_id` itself must be set). Stop and investigate.

- [ ] **Step 3: Commit**

```powershell
git add scripts/smoke-production.mjs
git commit -m "feat(smoke): smoke-production.mjs checks 6-10

Recommendations shape, thumb writes (service-role row check), NPS
idempotent submission, dismiss, admin-export auth matrix
(status+content-type only — body drained without inspection per
spec §6.1 to avoid leaking real beta-user data in smoke logs).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 [agent]: Smoke runner checks 11–15 + cleanup

**Files:**
- Modify: `scripts/smoke-production.mjs`

- [ ] **Step 1: Append checks 11–15 + cleanup logic**

```javascript
// ── #11 Migration check (read-only) ──────────────────────────────
async function checkMigrations() {
  // PostgREST exposes public schema only; information_schema isn't queryable via supabase-js.
  // Use a tiny service-role SELECT on the actual tables: if the SELECT succeeds with no error,
  // the table + columns exist. limit(0) returns empty data fast.
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

  // Anon-client list MUST return an explicit error (private bucket).
  // An empty successful list is a false positive — bucket might be public-readable but empty.
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await anon.storage.from("cv-uploads").list();
  check("12b storage-anon-denied",
    !!error,
    error ? `denied (expected): ${error.message}` : "FAIL: anon list succeeded — bucket is not private");
}

// ── #13 Security headers (CSP deferred to 7b — not asserted) ─────
async function checkSecurityHeaders() {
  const r = await fetch(`${URL}/api/admin/feedback/export`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  if (r.body) await r.body.cancel();
  check("13 nosniff",
    r.headers.get("x-content-type-options") === "nosniff",
    `nosniff=${r.headers.get("x-content-type-options")}`);
}

// ── #14 Env sanity (existence-check only — never print values) ───
async function checkEnvSanity() {
  // Required vars must be set (locally to the smoke run; production is verified separately)
  const required = ["url", "admin-token", "supabase-url", "supabase-anon-key",
                    "supabase-service-role-key", "expected-supabase-ref"];
  const missing = required.filter((k) => !args[k]);
  check("14a env-args-present", missing.length === 0,
    missing.length ? `missing=${missing.join(",")}` : "all-set");

  // Supabase URL host must match expected ref
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
```

Update `main()` to call the new checks and wrap with `try/finally`:

```javascript
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

  // R1 release evidence added in next task.

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed; smoke_run_id=${SMOKE_RUN_ID}`);
  if (failed.length > 0) {
    console.error(JSON.stringify(failed, null, 2));
    process.exit(1);
  }
  process.exit(0);
}
```

- [ ] **Step 2: Sanity-check against dev server**

Same command as before. Expected: ~15 checks reported, cleanup runs even if earlier checks failed (because of `try/finally`).

- [ ] **Step 3: Commit**

```powershell
git add scripts/smoke-production.mjs
git commit -m "feat(smoke): smoke-production.mjs checks 11-15 + cleanup

Migration check uses a read-only SELECT limit(0) on actual tables
(feedback + users NPS columns). Storage bucket privacy + anon-denied (requires
explicit error, not empty list). Security headers (nosniff; CSP
deferred to 7b). Env sanity (existence-only never-print + supabase
ref host match). Cleanup via cascade-DELETE from users by smoke
user_id (captured during check 02b from anonymous_sessions). All
wrapped in try/finally so cleanup runs even on early failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 [agent]: Smoke runner — Release Evidence R1 (Sentry polling)

**Files:**
- Modify: `scripts/smoke-production.mjs`

- [ ] **Step 1: Append R1 check**

Append before the final results log in `main()`:

```javascript
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
    const trig = await fetch(`${URL}/api/_internal/sentry-test`, {
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
        // Network blip during polling — keep retrying until deadline
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
```

Add the call to `main()` (NON-blocking — failure logs but doesn't gate exit code):

```javascript
async function main() {
  let blockingFailed = 0;
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

    blockingFailed = results.filter((r) => !r.ok).length;
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
```

- [ ] **Step 2: Commit**

```powershell
git add scripts/smoke-production.mjs
git commit -m "feat(smoke): R1 Sentry pipeline release-evidence check

Triggers /api/_internal/sentry-test, polls Sentry Events API for the
returned eventId (15s interval, 5-min deadline). Non-blocking — R1
failure logs but doesn't affect exit code, because blocking smoke
must be fast/reliable. R1 skips cleanly if SENTRY_* args not provided
(e.g., when running against a preview).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 [agent]: `scripts/smoke-cleanup.mjs` async sweeper

**Files:**
- Create: `scripts/smoke-cleanup.mjs`

- [ ] **Step 1: Create the sweeper**

```javascript
#!/usr/bin/env node
// scripts/smoke-cleanup.mjs
// Async sweeper: deletes anonymous users older than 24h with no chat activity.
// Run periodically (e.g., once a day) to catch residue if inline smoke cleanup fails.
// Safe to run anytime — only touches anonymous users with no conversations.

import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values: args } = parseArgs({
  options: {
    "supabase-url":             { type: "string" },
    "supabase-service-role-key":{ type: "string" },
    "older-than-hours":         { type: "string", default: "24" },
    "dry-run":                  { type: "boolean", default: false },
  },
});

if (!args["supabase-url"] || !args["supabase-service-role-key"]) {
  console.error("smoke-cleanup: missing --supabase-url and/or --supabase-service-role-key");
  process.exit(2);
}

const svc = createClient(args["supabase-url"], args["supabase-service-role-key"], {
  auth: { autoRefreshToken: false, persistSession: false },
});

const cutoffMs = Date.now() - parseInt(args["older-than-hours"], 10) * 60 * 60 * 1000;
const cutoffIso = new Date(cutoffMs).toISOString();

// Find anonymous users older than the cutoff with no conversations.
// "No chat activity" = no row in conversations referencing this user.
const { data: candidates, error } = await svc
  .from("users")
  .select("id, created_at, conversations!left(id)")
  .eq("is_anonymous", true)
  .lt("created_at", cutoffIso)
  .limit(500);

if (error) {
  console.error("smoke-cleanup: query failed", error.message);
  process.exit(1);
}

const stale = (candidates ?? []).filter((u) => !u.conversations || u.conversations.length === 0);

console.log(`smoke-cleanup: cutoff=${cutoffIso} candidates=${candidates?.length ?? 0} stale=${stale.length}`);

if (args["dry-run"]) {
  console.log(`smoke-cleanup: dry-run, no deletions`);
  process.exit(0);
}

let deleted = 0;
for (const u of stale) {
  const { error: delErr } = await svc.from("users").delete().eq("id", u.id);
  if (delErr) {
    console.error(`smoke-cleanup: delete failed for ${u.id}`, delErr.message);
  } else {
    deleted++;
  }
}

console.log(`smoke-cleanup: deleted=${deleted}/${stale.length}`);
process.exit(0);
```

- [ ] **Step 2: Dry-run sanity check against dev**

```powershell
node scripts/smoke-cleanup.mjs `
  --supabase-url $env:NEXT_PUBLIC_SUPABASE_URL `
  --supabase-service-role-key $env:SUPABASE_SERVICE_ROLE_KEY `
  --dry-run
```

Expected: prints candidates/stale counts, no deletions.

- [ ] **Step 3: Commit**

```powershell
git add scripts/smoke-cleanup.mjs
git commit -m "feat(smoke): smoke-cleanup.mjs async sweeper

Deletes anonymous users older than 24h with no conversations.
FK cascades drop dependent rows (anonymous_sessions, consents,
career_profile, recommendations, etc.). Always safe to run — only
touches stale anonymous accounts. --dry-run flag for visibility.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 [agent]: Expand README env-vars section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current state**

```powershell
Get-Content README.md | Select-String -Pattern "Environment variables" -Context 0,30
```

Currently lists only `ADMIN_EXPORT_TOKEN` (per Phase 6b trim).

- [ ] **Step 2: Replace the env-vars section**

Replace the existing `## Environment variables` block (and its content up to the next `##`) with:

```markdown
## Environment variables

Required in Production scope (Vercel Project → Environment Variables → Production):

- `ANTHROPIC_API_KEY` — Anthropic Claude API key from console.anthropic.com
- `ANTHROPIC_MODEL` — Exact Claude model ID (verify current ID before setting)
- `NEXT_PUBLIC_SUPABASE_URL` — `https://<prod-ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project anon/publishable key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service-role key (server-only)
- `NEXT_PUBLIC_SITE_URL` — Exact production host, no trailing slash
- `SENTRY_DSN` — Sentry DSN for the prod project
- `SENTRY_AUTH_TOKEN` — Sentry auth token for sourcemap upload at build time
- `SENTRY_ORG` — Sentry organization slug
- `SENTRY_PROJECT` — Sentry project slug
- `ADMIN_EXPORT_TOKEN` — Bearer token for admin feedback CSV export (also gates `/api/_internal/sentry-test` for smoke). Generate with `openssl rand -hex 32`. Fresh per environment.

Required in Preview scope: Use dev/staging Supabase credentials (NOT prod). `ADMIN_EXPORT_TOKEN` may be omitted in Preview — admin export will return 401, which is the desired behavior.

For local development, copy `.env.example` to `.env.local` and fill in values.
```

- [ ] **Step 3: Commit**

```powershell
git add README.md
git commit -m "docs(readme): expand env-vars section for Phase 7a launch

Currently only ADMIN_EXPORT_TOKEN was documented (from Phase 6b trim).
7a adds the full prod env-var manifest: Anthropic, Supabase, Sentry,
Site URL, plus the preview-vs-prod scope distinction.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10 [agent]: Create rollback runbook document

**Files:**
- Create: `docs/superpowers/runbooks/launch-rollback.md`

- [ ] **Step 1: Create the runbook**

```markdown
# Launch Rollback Runbook

Quick operational reference. Full design rationale lives in `docs/superpowers/specs/2026-05-20-career-os-07a-launch-readiness-design.md` §8.

## When to roll back

- Issue is user-facing AND broad AND security-sensitive OR revenue-blocking OR the forward fix is uncertain → **roll back**
- Issue is small AND well-understood AND tested AND safer than restoring old code/data → **roll forward**
- Database state is unclear → **pause and escalate**

## App-level rollback (primary path)

1. Identify currently active production deployment SHA and previous known-good SHA.
2. In Vercel dashboard → Deployments → previous known-good deployment → "Promote to Production".
3. Verify production routes:
   - `GET /` → 200
   - `GET /privacy` → 200
   - `GET /terms` → 200
   - `POST /api/chat` (with consent) → 200 stream
   - `GET /api/admin/feedback/export` → 401 without auth
4. Re-run `node scripts/smoke-production.mjs ...` against the deployed URL.
5. Record incident: rollback SHA, reason, timestamp, verifier.

This action is instant and idempotent.

## Database rollback (never automatic)

Requires explicit human decision. Before any production schema change, confirm a pre-deploy backup exists.

Options:

- **PITR restore** if point-in-time recovery enabled (not enabled in 7a)
- **Manual SQL repair** — reviewed, transaction-wrapped
- **Forward migration** when safer than reverting

**Never apply destructive SQL during an incident without a second reviewer.**

## Scenario quick-ref

| Scenario | First action |
|---|---|
| Bad migration applied | Stop promote if possible. If live: decide if app rollback alone suffices. Schema-incompatible? Forward-fix migration or manual SQL. |
| Bad env var set | Correct env var → redeploy → smoke. Never print secrets. |
| Bad code shipped | Vercel promote previous known-good → smoke. |
| Production data corruption from buggy mutation | Disable mutation path (kill switch / feature flag) → preserve evidence → estimate blast radius → PITR / manual SQL / forward repair. App rollback alone won't fix corrupted rows. |

## Testing this runbook

Before public launch: dry-run by promoting a previous SHA and back. Confirm smoke passes after each promotion. Record screenshots.

## Communications

Notify release owner, engineering lead, product owner, support/admin watchers. For security or data-integrity incidents add data owner and incident lead. Update format: impact, action taken, current SHA, DB decision, next verification step.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/superpowers/runbooks/launch-rollback.md
git commit -m "docs(runbook): launch-rollback quick-reference

Operational extract from spec §8. Decision tree, scenario quick-ref,
testing instructions, communications. Spec stays authoritative for
rationale; runbook is for incident-response speed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11 [human]: Create Supabase production project

**Action required by user — Claude cannot do this.**

- [ ] **Step 1: Create the project**

In Supabase Dashboard:
1. Organization: `tmotti777's Org` (existing)
2. Click "New Project"
3. Name: `career-os-prod`
4. Region: `eu-central-1` (Frankfurt — matches dev region)
5. Plan: Pro tier ($25/mo — required for daily backups)
6. Database password: generate strong, store in 1Password/equivalent
7. Click Create. Wait ~2 minutes for provisioning.

- [ ] **Step 2: Confirm backups enabled**

Settings → Backups → Daily Backups should show "Enabled". PITR can stay disabled (decision #5).

- [ ] **Step 3: Capture project ref + URL + keys**

Settings → API:
- Project Ref (e.g., `abcdefghijklmnop`) — needed for `--expected-supabase-ref` smoke arg
- Project URL (`https://<ref>.supabase.co`)
- `anon` key
- `service_role` key (treat as secret)

Store these — they'll be Vercel env vars in Task 14.

- [ ] **Step 4: Report ref + URL back to Claude**

Reply with the project ref and URL (NOT the keys). Claude will use them to verify Vercel setup later.

---

## Task 12 [human]: Apply migrations to prod Supabase

**Action required by user — Claude cannot run migrations against prod from this environment.**

- [ ] **Step 1: Confirm pre-migration backup OR take a manual dump**

Supabase Dashboard → Database → Backups → confirm a backup exists from within the last 24h.

⚠️ For brand-new Pro projects, the first daily backup may not have run yet. If no backup is listed, take a manual dump before applying migrations:

```powershell
npx supabase login    # if not logged in
npx supabase link --project-ref <prod-ref>
npx supabase db dump --linked --file backup-pre-7a-migrations.sql
```

Store `backup-pre-7a-migrations.sql` securely (e.g., move to a backup folder outside the repo — DO NOT commit it).

- [ ] **Step 2: Apply migrations**

```powershell
npx supabase db push --linked
```

Expected: 11 migration files apply cleanly. Output should end with "Finished supabase db push." If any migration errors, STOP and report.

- [ ] **Step 3: Verify schema**

```powershell
npx supabase db query --linked "select table_name from information_schema.tables where table_schema='public' order by table_name"
```

Expected tables: `anonymous_sessions`, `assessments`, `career_profile`, `consents`, `conversations`, `cv_uploads`, `feedback`, `interview_messages`, `interview_sessions`, `messages`, `occupations`, `plan_tasks`, `plans`, `recommendations`, `skills`, `users`.

```powershell
npx supabase db query --linked "select count(*) from information_schema.columns where table_name='feedback'"
```

Expected: `count = 12`.

- [ ] **Step 5: Seed occupations + skills**

```powershell
npm run seed:occupations
```

(Reads `content/occupations/*.json` and `content/skills/taxonomy.json`, writes to prod DB via service role using env vars from `.env.local` — TEMPORARILY point those at prod for this run, then revert.)

⚠️ Critical: change `.env.local` BACK to dev after seeding. The `.env.local` should never persistently point at prod.

- [ ] **Step 6: Verify seed**

```powershell
npx supabase db query --linked "select count(*) from occupations"
npx supabase db query --linked "select count(*) from skills"
```

Expected: occupations ~20, skills ~60.

- [ ] **Step 7: Confirm to Claude**

Reply "migrations + seed done" with the table count from Step 4.

---

## Task 13 [human]: Configure Supabase auth + storage

**Action required by user.**

- [ ] **Step 1: Configure auth redirect URLs**

Supabase Dashboard (prod) → Authentication → URL Configuration:

- Site URL: `https://<prod-domain>` (whatever you've decided — `career-os.app` etc.)
- Redirect URLs (add all): `https://<prod-domain>/auth/callback`

- [ ] **Step 2: Configure Google OAuth (if used)**

If Google sign-in will be enabled for closed beta:

1. Google Cloud Console → APIs & Services → Credentials → "Create OAuth Client ID" → Web application
2. Authorized redirect URIs: `https://<prod-ref>.supabase.co/auth/v1/callback`
3. Capture Client ID + Secret
4. Supabase Dashboard → Authentication → Providers → Google → Enable + paste Client ID + Secret

- [ ] **Step 3: Decide on custom SMTP (decision #12)**

Either:
- **Option A (defer)**: Use Supabase default email for closed beta. Note this is rate-limited (~4 emails/h) and deliverability may be inconsistent.
- **Option B (custom SMTP)**: Authentication → Email → SMTP Settings → configure with Postmark/Resend/SES.

Document choice in `docs/superpowers/runbooks/launch-rollback.md` (append a "Notes" section).

- [ ] **Step 3b: Magic-link smoke test (mandatory regardless of SMTP choice)**

This verifies the entire auth pipeline works. Do NOT skip — applies to both Option A and Option B.

1. Visit `https://<prod-domain>/auth/sign-in` (or wherever the magic-link form is)
2. Enter a real email address you control
3. Submit the form. Expect: "check your email" confirmation message
4. Open the email (check spam folder if Option A — Supabase default often lands there)
5. Click the magic link. Expect: lands on `https://<prod-domain>/auth/callback` then redirects to the post-auth destination (probably `/recommendations`)
6. Verify in Supabase Dashboard → Authentication → Users that your email appears as a signed-in user
7. Confirm the session works: visit `/recommendations` — should NOT prompt for sign-in again

Record the result + delivery time in your notes. If the email took >5 min to arrive on Option A, strongly consider Option B before public launch.

- [ ] **Step 4: Verify `cv-uploads` storage bucket**

Supabase Dashboard → Storage → confirm `cv-uploads` bucket exists (created by migration). Verify:
- Privacy: Private (NOT public)
- File size limit: appropriate (e.g., 10MB)

Storage → Settings → S3 connection (or Object lifecycle on Edge) → add lifecycle rule: delete objects in `cv-uploads` older than 30 days. (This is dashboard-only; not in migration.)

Take a screenshot of the lifecycle rule and save to `docs/superpowers/runbooks/screenshots/storage-lifecycle.png` (you'll add this in Task 23).

- [ ] **Step 4b: Take a screenshot of the storage lifecycle rule**

Save to `docs/superpowers/runbooks/screenshots/storage-lifecycle.png` (you'll commit this in Task 23).

- [ ] **Step 5: RLS spot-check (3 tables — users, feedback, career_profile)**

For each of the three tables below, hit the REST endpoint with the anon key and verify NO real rows leak:

```powershell
# Replace <prod-ref> + <anon-key>
$headers = @{ apikey = "<anon-key>"; Authorization = "Bearer <anon-key>" }
foreach ($table in @("users","feedback","career_profile")) {
  $url = "https://<prod-ref>.supabase.co/rest/v1/$table" + "?select=*&limit=5"
  $r = Invoke-WebRequest -Uri $url -Headers $headers -SkipHttpErrorCheck
  Write-Host "$table → status=$($r.StatusCode), bodyLen=$($r.Content.Length)"
}
```

Expected for ALL THREE tables: status 200 with body `[]` (RLS hides rows), OR status 401/403. **Never** a list of real user rows. If any of the three returns real data, STOP — RLS is misconfigured.

- [ ] **Step 6: Confirm to Claude**

Reply with: auth redirect URLs configured, OAuth choice (configured / skipped), SMTP choice (custom / default), magic-link smoke result, bucket private + lifecycle set + screenshot taken, RLS spot-check result for all 3 tables.

---

## Task 14 [human]: Create Vercel project + production env vars

**Action required by user.**

- [ ] **Step 1: Create Vercel project**

Vercel Dashboard → Add New → Project → Import `tmotti77/Lai`.

- Team: `mos-projects-a3126879`
- Project name: `career-os`
- Framework Preset: Next.js
- Root directory: `./`
- Build command: `npm run build` (default)
- Install command: `npm ci` (default)
- Node version: **24 LTS** (in project settings → General → Node.js Version)

Stop short of clicking "Deploy" — env vars must be set first.

- [ ] **Step 2: Generate ADMIN_EXPORT_TOKEN (fresh)**

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store in 1Password/equivalent. This is the PROD token — do not reuse the dev token.

- [ ] **Step 3: Generate SENTRY_API_TOKEN (read-only)**

Sentry → User Auth Tokens → Create New Token:
- Name: `career-os-smoke-readonly`
- Scopes: `event:read`, `project:read`
- Save the token (only visible once).

This is separate from `SENTRY_AUTH_TOKEN` (which is build-time + needs write scope for sourcemap upload).

- [ ] **Step 4: Set Production env vars**

Vercel Dashboard → Project → Settings → Environment Variables → For each, set Environment to **Production** only:

| Name | Value source |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic console |
| `ANTHROPIC_MODEL` | Latest verified Claude model ID |
| `NEXT_PUBLIC_SUPABASE_URL` | Prod project URL from Task 11 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod project anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod project service-role key |
| `NEXT_PUBLIC_SITE_URL` | `https://<prod-domain>` |
| `SENTRY_DSN` | Prod Sentry project DSN |
| `SENTRY_AUTH_TOKEN` | Build-time upload token (Sentry → Settings → Auth Tokens → write scope) |
| `SENTRY_ORG` | Sentry org slug |
| `SENTRY_PROJECT` | Sentry project slug |
| `ADMIN_EXPORT_TOKEN` | From Step 2 |

(`SENTRY_API_TOKEN` is NOT a Vercel env var — it's local-only, used by the smoke script.)

- [ ] **Step 5: Set Preview env vars (isolated)**

Same list, scoped to **Preview** environment, but with **dev** values:

- `NEXT_PUBLIC_SUPABASE_URL` → dev project URL (`https://wqswamtcppjmkwykukjp.supabase.co`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → dev anon key
- `SUPABASE_SERVICE_ROLE_KEY` → dev service-role key
- `NEXT_PUBLIC_SITE_URL` → **set to a stable dev/preview URL** (e.g., your branch's predictable Vercel URL OR `https://preview.career-os.app` if you set up a domain alias). Custom env vars are NOT auto-filled by Vercel from `VERCEL_URL`. If you can't pin a single value, set it to the prod domain — anything that's a valid URL works for the few routes that read it.
- `ANTHROPIC_*` — same as prod or dev (cost decision)
- `SENTRY_*` — optionally omit, or share dev Sentry project with `environment=preview` tag
- `ADMIN_EXPORT_TOKEN` — **OMIT** (admin export returns 401 in preview = desired)

- [ ] **Step 6: Confirm**

Reply: env vars set per the matrix. Include the prod domain you chose.

---

## Task 15 [human]: Anthropic spend cap + Vercel Firewall rules

**Action required by user.**

- [ ] **Step 1: Anthropic spend cap**

Anthropic Console → Settings → Billing → Spend Limits → set a **hard monthly cap** (e.g., $200 for closed beta — adjust to risk tolerance). Hard cap shuts off API access when reached.

Take a screenshot for the runbook.

- [ ] **Step 2: Vercel Firewall rate limits**

⚠️ Rate limiting on Vercel Firewall requires Pro plan or higher. Confirm your team's plan supports rate-limit rules before this step. Docs: https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting

Vercel Project → Firewall → Custom Rules → Add Rule:

- Name: `rate-limit-chat`
- Match: Path `/api/chat`
- Action: Rate Limit
- Rate: 30 requests / 60 seconds / per IP
- Response: 429

Add another rule for `/api/feedback`:
- Name: `rate-limit-feedback`
- Match: Path `/api/feedback`
- Action: Rate Limit
- Rate: 60 requests / 60 seconds / per IP

**Critical**: after adding rules, click **Review Changes** then **Publish** in the Firewall UI. Unpublished rules don't take effect.

Take screenshots for the runbook (Review Changes view AND Published rules view).

- [ ] **Step 3: Confirm**

Reply: spend cap = `$X/mo`, firewall rate limits configured.

---

## Task 16 [agent+human]: First preview deploy + verify isolation

**Action: agent prepares feature branch; human triggers deploy via push; agent verifies isolation.**

- [ ] **Step 1 [agent]: Create feature branch**

The current branch is `feat/phase-7a-launch-readiness` (created when Task 1 began). It has commits from Tasks 1–10. Confirm:

```powershell
git log --oneline main..HEAD
```

Should show ~10 commits.

- [ ] **Step 2 [human]: Push to trigger preview**

```powershell
git push -u origin feat/phase-7a-launch-readiness
```

Vercel will auto-deploy a Preview build. Wait until "Ready" status in Vercel Dashboard.

- [ ] **Step 3 [agent+human]: Verify preview isolation**

Get the Preview URL from Vercel (e.g., `https://career-os-git-feat-phase-7a-...vercel.app`).

Run:

```powershell
# Use curl.exe (the actual curl binary), NOT PowerShell's curl alias which maps to Invoke-WebRequest
curl.exe -X POST "$previewUrl/api/feedback" `
  -H "content-type: application/json" `
  -H "cookie: co_anon=test" `
  -d '{"kind":"thumb","surface":"recommendations","target_type":"recommendation_occupation","target_id":"dummy:data-analyst","thumbs_value":1}'
```

Expected: either a 4xx error (because of consent/target checks against the dev DB) OR 200 with the row landing in the **dev** Supabase project. Confirm by querying:

```
mcp__claude_ai_Supabase__execute_sql with project_id=wqswamtcppjmkwykukjp:
select count(*) from feedback where created_at > now() - interval '5 minutes'
```

(Or the Codex/MCP equivalent in your tooling.)

If the row landed in **prod** Supabase, STOP — preview env vars are misconfigured.

- [ ] **Step 4 [agent]: Confirm via the smoke script (against preview URL, dev DB)**

For preview, check 10a (admin export with correct token) will fail because preview env intentionally has no `ADMIN_EXPORT_TOKEN`. Use the `--skip-admin-success` flag to skip 10a while still asserting 10b/10c return 401:

```powershell
node scripts/smoke-production.mjs `
  --url $previewUrl `
  --admin-token "any-token-because-preview-has-none" `
  --skip-admin-success `
  --supabase-url $env:NEXT_PUBLIC_SUPABASE_URL `
  --supabase-anon-key $env:NEXT_PUBLIC_SUPABASE_ANON_KEY `
  --supabase-service-role-key $env:SUPABASE_SERVICE_ROLE_KEY `
  --expected-supabase-ref "wqswamtcppjmkwykukjp"
```

The smoke script needs to support `--skip-admin-success`. Add to Task 5 step 1 the following: a new boolean arg `"skip-admin-success": { type: "boolean", default: false }`, and modify `checkAdminExportAuth()` to skip the 200-token branch when set:

```javascript
async function checkAdminExportAuth() {
  if (!args["skip-admin-success"]) {
    const ok = await fetch(`${URL}/api/admin/feedback/export`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    if (ok.body) await ok.body.cancel();
    check("10a admin-ok",
      ok.status === 200 && (ok.headers.get("content-type") ?? "").startsWith("text/csv"),
      `status=${ok.status} ct=${ok.headers.get("content-type")}`);
  } else {
    check("10a admin-ok-skipped", true, "skipped via --skip-admin-success (preview env)");
  }
  // 10b + 10c unchanged
  // ...
}
```

(Apply this edit when implementing Task 5 — added here for cross-reference.)

Expect: most checks pass; 10a skipped; 10b/10c return 401; R1 sentry skips (no SENTRY_API_TOKEN provided).

- [ ] **Step 5 [agent+human]: Confirm**

Both confirm: preview isolation verified, smoke passes against preview. Move on.

---

## Task 17 [agent+human]: First production deploy

**Action: human triggers via PR merge; agent monitors + smoke-runs against prod URL.**

- [ ] **Step 1 [agent]: Open PR for Phase 7a code work**

PowerShell can't parse bash heredoc syntax. Write the PR body to a temp file and pass `--body-file`:

```powershell
$body = @"
## Summary
- Node 24 upgrade (.nvmrc + engines + @types/node + CI workflow)
- New ``/api/_internal/sentry-test`` endpoint (Bearer-gated)
- New ``scripts/smoke-production.mjs`` (15 blocking + R1 release-evidence)
- New ``scripts/smoke-cleanup.mjs`` (async sweeper)
- README env-vars docs expanded
- ``docs/superpowers/runbooks/launch-rollback.md`` operational quick-ref

Track B infra work (Vercel project, Supabase prod, env vars, firewall) is done out-of-band; this PR is the code+docs portion.

## Test plan
- [x] tsc clean
- [x] tests green (incl. new sentry-test route test)
- [x] build green under Node 24
- [x] Smoke passes against Preview deploy
- [ ] (After merge) Smoke passes against Production deploy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
"@
$body | Out-File -FilePath pr-body.tmp.md -Encoding utf8
gh pr create --title "feat(7a): production launch readiness — code track" --body-file pr-body.tmp.md
Remove-Item pr-body.tmp.md
```

- [ ] **Step 2 [human]: Review + merge**

Review the PR diff. If all looks right, merge to `main` (squash or merge-commit per project convention).

- [ ] **Step 3 [human]: Promote to Production**

After merge, Vercel auto-deploys `main` to Production. Wait for "Ready".

If your Vercel project has "Auto-deploy production from main" disabled (some teams do this), promote manually: Dashboard → Deployments → latest `main` deployment → "Promote to Production".

- [ ] **Step 4 [agent]: Confirm prod URL is live**

Visit `https://<prod-domain>/` — should show the "coming soon" page in Hebrew.
Visit `https://<prod-domain>/chat` — should set co_anon cookie and load chat UI.

---

## Task 18 [agent+human]: Run smoke against production

- [ ] **Step 1 [human]: Provide secrets to Claude (one-time, in chat)**

You'll need to share the following so the agent can run the smoke. Use a secure channel if available, or paste into chat:

- Prod URL (e.g., `https://career-os.app`)
- `ADMIN_EXPORT_TOKEN` (prod value from Task 14)
- `SENTRY_ORG` + `SENTRY_PROJECT` + `SENTRY_API_TOKEN` (from Task 14)
- Supabase prod ref (from Task 11)
- Prod Supabase URL + anon key + service-role key

⚠️ These will be in the conversation transcript. Rotate after the smoke run if desired.

- [ ] **Step 2 [agent]: Run smoke**

```powershell
$env:PROD_URL = "https://<prod-domain>"
$env:ADMIN_EXPORT_TOKEN = "<prod-token>"
$env:NEXT_PUBLIC_SUPABASE_URL = "https://<prod-ref>.supabase.co"
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "<prod-anon>"
$env:SUPABASE_SERVICE_ROLE_KEY = "<prod-sr>"
$env:SENTRY_ORG = "<org>"
$env:SENTRY_PROJECT = "<project>"
$env:SENTRY_API_TOKEN = "<smoke-readonly-token>"

node scripts/smoke-production.mjs `
  --url $env:PROD_URL `
  --admin-token $env:ADMIN_EXPORT_TOKEN `
  --supabase-url $env:NEXT_PUBLIC_SUPABASE_URL `
  --supabase-anon-key $env:NEXT_PUBLIC_SUPABASE_ANON_KEY `
  --supabase-service-role-key $env:SUPABASE_SERVICE_ROLE_KEY `
  --expected-supabase-ref "<prod-ref>" `
  --sentry-org $env:SENTRY_ORG `
  --sentry-project $env:SENTRY_PROJECT `
  --sentry-api-token $env:SENTRY_API_TOKEN
```

Expected: All 15 blocking checks PASS. R1 either PASSes within 5 min or SKIPs cleanly. Cleanup runs. Exit code 0.

- [ ] **Step 3 [agent]: Capture output**

Save full smoke output to `docs/superpowers/runbooks/screenshots/smoke-output-prod-first-run.txt` (gitignored).

- [ ] **Step 4 [human]: Optional: rotate ADMIN_EXPORT_TOKEN**

If you'd rather not have the prod token in the chat transcript, generate a fresh one and update the Vercel env var. Trigger a redeploy (`gh workflow run` or push an empty commit).

---

## Task 19 [human]: Manual user-journey verification

**Per spec §7 — Claude can guide via browser MCP if needed, but the human is the source of truth here.**

- [ ] **Step 1: Fresh browser profile**

Open a new browser profile or incognito session. Record:
- Deployment URL: ___
- Commit SHA: ___
- Tester: ___
- Browser/version: ___
- Device/viewport: ___
- Timestamp: ___

- [ ] **Step 2: Walk the journey**

Per spec §7 items 1–9: start at `/chat`, accept consent, complete 3+ chat turns in Hebrew, do the assessment, view recommendations, thumb a recommendation, download PDF, submit NPS + double-submit, mobile 375px check.

- [ ] **Step 3: Record findings**

Create `docs/superpowers/runbooks/launch-checklist-<date>.md` with one row per finding:

```markdown
| Severity | URL | Expected | Actual | Owner | Resolution |
|---|---|---|---|---|---|
| critical | /chat | streams Hebrew response | 500 error | Claude | rollback or forward fix |
| nit | /recommendations | thumbs button has 44px tap target | 36px | Claude | defer to 7b polish |
```

- [ ] **Step 4: Decide**

If any finding is **fail-fast** category (data loss, privacy leak, broken consent gating, broken chat, broken PDF, admin/auth bypass, widespread mobile unusability) → **rollback per Task 21**. Otherwise → notes deferred.

---

## Task 20 [agent+human]: Sentry + Vercel Analytics evidence (R1 + R3)

- [ ] **Step 1 [agent]: R1 already covered by smoke**

The Task 18 smoke run included R1 polling. If it passed, R1 is done.

If R1 was skipped (because args not provided) or failed, re-run JUST R1:

```powershell
# Re-trigger the test event — use curl.exe, not the PowerShell curl alias
curl.exe -X POST "$env:PROD_URL/api/_internal/sentry-test" `
  -H "authorization: Bearer $env:ADMIN_EXPORT_TOKEN"
# Get eventId from the response, then poll Sentry manually in the dashboard:
# https://sentry.io/organizations/<org>/projects/<project>/?query=event.id:<eventId>
```

- [ ] **Step 2 [human]: R3 manual screenshot**

Within 24h of the smoke's `feedback_submitted` event (from check 07/08):

1. Vercel Dashboard → Project → Analytics → Custom Events
2. Filter by `feedback_submitted`
3. Confirm at least one event landed in the last hour
4. Screenshot → save to `docs/superpowers/runbooks/screenshots/vercel-analytics-feedback-submitted.png`

- [ ] **Step 3 [agent]: Commit screenshots**

```powershell
New-Item -ItemType Directory -Force -Path docs\superpowers\runbooks\screenshots | Out-Null
# Copy the screenshot file into that folder (drag-drop or Copy-Item)
git add docs/superpowers/runbooks/screenshots/vercel-analytics-feedback-submitted.png
git commit -m "docs(runbook): Vercel Analytics R3 evidence screenshot"
```

---

## Task 21 [agent+human]: Rollback runbook dry-run

- [ ] **Step 1 [human]: No-op deploy**

In Vercel Dashboard, push an empty commit to `main`:

```powershell
git checkout main
git pull
git commit --allow-empty -m "chore: phase-7a rollback drill no-op"
git push
```

Vercel deploys the no-op. Let it promote to production.

- [ ] **Step 2 [human]: Promote previous SHA**

Vercel Dashboard → Deployments → find the deployment BEFORE the no-op → "Promote to Production".

- [ ] **Step 3 [agent]: Verify smoke still passes**

Re-run the smoke command from Task 18. Expect: all blocking checks still pass (the no-op didn't change anything observable).

- [ ] **Step 4 [human]: Promote forward (back to the no-op)**

Vercel Dashboard → Deployments → most recent → "Promote to Production".

- [ ] **Step 5 [agent]: Record the drill**

Append a "Drill log" section to `docs/superpowers/runbooks/launch-rollback.md` noting the date, the two SHAs involved (no-op SHA + previous known-good SHA), and the verifier name.

```powershell
$ts = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"
git add docs/superpowers/runbooks/launch-rollback.md
git commit -m "docs(runbook): record rollback drill on $ts"
```

---

## Task 22 [agent+human]: R2 sourcemap evidence

Sentry source-map upload is build-time and must be verified for stack-trace symbolication to work.

- [ ] **Step 1 [agent]: Inspect prod build logs**

Vercel Dashboard → Project → Deployments → latest prod deployment → "Build Logs". Search for "Sentry" or "sourcemaps". Expect a line like `Uploading source maps...` followed by `Successfully uploaded X file(s)`.

If no such line: the Sentry webpack/turbopack plugin is misconfigured. STOP and report.

Save the relevant log snippet (or screenshot) to `docs/superpowers/runbooks/screenshots/sentry-sourcemap-upload.png`.

- [ ] **Step 2 [agent]: Verify .map files are NOT publicly served**

```powershell
# Pick any chunk file name from the deployed app (view-source on the prod page)
$chunkUrl = "$env:PROD_URL/_next/static/chunks/main-abc123.js.map"
$resp = Invoke-WebRequest -Uri $chunkUrl -SkipHttpErrorCheck
Write-Host "status=$($resp.StatusCode)"
```

Expected: 404 or 403. If 200, sourcemaps are publicly served — Sentry-plugin's `sourcemaps.deleteSourcemapsAfterUpload: true` (Phase 6c) isn't working. Investigate.

- [ ] **Step 3 [agent+human]: Confirm symbolication works on the R1 test event**

From Task 18's smoke run, Sentry has the test event. Open it in the Sentry dashboard:

1. Sentry → Issues → search for `phase-7a smoke: sentry pipeline verification`
2. Open the event
3. Verify the stack trace shows source-mapped file names (e.g., `app/api/_internal/sentry-test/route.ts:24`) instead of minified chunk paths (e.g., `_next/static/chunks/abc-123.js:1:42312`)

If symbolication is broken, sourcemaps uploaded but the upload-association is wrong. Check Sentry → Releases → confirm a release exists matching the deployed commit SHA.

- [ ] **Step 4 [agent]: Commit evidence**

```powershell
git add docs/superpowers/runbooks/screenshots/sentry-sourcemap-upload.png
git commit -m "docs(runbook): R2 sourcemap upload evidence"
```

---

## Task 23 [agent]: Collect remaining infra screenshots

Per Tasks 13, 15: dashboard screenshots are part of the launch evidence. Gather them all in one place.

- [ ] **Step 1: Required screenshots**

Save each to `docs/superpowers/runbooks/screenshots/`:

| File | Source |
|---|---|
| `storage-lifecycle.png` | Supabase → Storage → cv-uploads → lifecycle rule view (from Task 13) |
| `anthropic-spend-cap.png` | Anthropic console → Settings → Billing → Spend Limits (from Task 15) |
| `vercel-firewall-rules-published.png` | Vercel → Firewall → Custom Rules (showing both rate-limit rules in "Published" state, from Task 15) |
| `supabase-backups.png` | Supabase → Database → Backups (showing daily backups enabled, from Task 11) |
| `vercel-env-vars-prod-scope.png` | Vercel → Project → Env Vars (showing all required vars scoped to Production, from Task 14). **Redact values before screenshotting.** |
| `vercel-analytics-feedback-submitted.png` | Vercel → Analytics → Custom Events (from Task 20, already added if Task 20 ran first) |
| `sentry-sourcemap-upload.png` | From Task 22 |

- [ ] **Step 2: Commit**

```powershell
git add docs/superpowers/runbooks/screenshots/*.png
git commit -m "docs(runbook): infra setup screenshots for launch evidence

Storage lifecycle, Anthropic spend cap, Vercel Firewall rules,
Supabase backups, Vercel env scope (values redacted), Vercel
Analytics event, Sentry sourcemap upload."
```

---

## Task 24 [agent]: Update CLAUDE.md with Phase 7a architecture

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append Phase 7a section**

After the existing Phase 6c section (and before "Project-specific conventions"), add:

```markdown
## Phase 7a architecture (production launch readiness)

Single-question scope: "can this app safely receive real production traffic from closed-beta testers?" Three tracks: code+docs (this repo PR), infra setup (human via dashboards), verification (smoke + manual walk + rollback drill).

- **Smoke runner**: `scripts/smoke-production.mjs` runs 15 blocking checks + R1 Sentry polling against any deployed URL. Cookie-jar fetch wrapper carries consent state through the journey. Cleanup is cascade-DELETE from `users` by the smoke user_id (captured during check 02b via an anonymous_sessions lookup keyed on the co_anon cookie value, BEFORE any application writes happen — so cleanup works even if later checks fail).
- **Async sweeper**: `scripts/smoke-cleanup.mjs` deletes anonymous users older than 24h with no chat activity. Safe to run anytime — only touches stale anonymous accounts.
- **Sentry test endpoint**: `/api/_internal/sentry-test` reuses ADMIN_EXPORT_TOKEN, calls `captureException` + `flush(5000)`, returns `eventId`. Smoke polls the Sentry Events API with a separate read-only token (`SENTRY_API_TOKEN`, never set in Vercel — local-only).
- **Node 24 mandate**: `.nvmrc=24`, `engines.node "^24"`, `@types/node "^24"`, CI workflow Node 24, Vercel project Node 24. Node 20 EOL 2026-04-30.
- **CSP deferred to 7b**: 7a verifies existing security headers (`x-content-type-options: nosniff`) but does not introduce a Content Security Policy. CSP is meaningful surface — script/style/img/connect inventory — and belongs with 7b legal/hardening.
- **AI abuse/cost guards (config-only)**: Anthropic console hard spend cap + Vercel Firewall rate limits on `/api/chat` and `/api/feedback`. Code-level per-user quotas defer to 7b.
- **Preview-env isolation**: Production scope uses prod Supabase + ADMIN_EXPORT_TOKEN; Preview scope uses dev Supabase and OMITS ADMIN_EXPORT_TOKEN (admin export 401s in preview = desired).
- **Database rollback posture**: never automatic. App rollback via Vercel promote previous SHA is instant + idempotent. DB rollback requires PITR (deferred) OR manual SQL OR forward-fix — no destructive SQL during incidents without second reviewer.

Architectural rule: any new admin/internal endpoint MUST reuse `ADMIN_EXPORT_TOKEN` for auth or define its own env var in `lib/env.ts`. Any new smoke check MUST log row counts only, never row payloads, to avoid leaking real beta-user data in CI logs.
```

- [ ] **Step 2: Commit + PR**

```powershell
git add CLAUDE.md
git commit -m "docs(claude.md): document Phase 7a launch-readiness architecture

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

This commit can land on `main` directly (it's a docs-only follow-up to the merged 7a code PR).

```powershell
git push origin main
```

---

## Self-review checklist

- [x] Every code-task has TDD steps (test first, fail, implement, pass, commit)
- [x] Every file path is exact
- [x] No `<placeholder>` markers
- [x] Code blocks are complete (no `// ...rest`)
- [x] Spec coverage:
  - [x] §1 Goal — Tasks 1–24 cover it
  - [x] §2 Decisions — Tasks 1, 4, 14, 15 (Node 24), Task 13 (#12 SMTP), Task 14 (#8 preview), Task 13 (#10 cleanup), Task 11 (#15 entry URL via /chat in smoke check 02)
  - [x] §3 Env-var manifest — Task 14 (set) + Task 9 (docs)
  - [x] §4 Supabase prod setup — Tasks 11, 12, 13
  - [x] §5 Vercel project setup — Tasks 14, 16
  - [x] §6 Blocking smoke + release evidence — Tasks 4, 5, 6, 7
  - [x] §6.1 Worked examples — embedded in Tasks 4–7 smoke checks
  - [x] §7 Manual journey — Task 19
  - [x] §8 Rollback runbook — Task 10 (doc) + Task 21 (drill)
  - [x] §9 New code surface — Tasks 3, 4–7, 8, 10
  - [x] §10 Definition of done — all gates traceable to Tasks 1–24
  - [x] §11 Out of scope — explicit "Not modified" list in file map
  - [x] §12 Risks — runbook covers operational risks; smoke covers technical risks
- [x] Type/name consistency: `smokeUserId`, `SMOKE_RUN_ID`, `ADMIN_EXPORT_TOKEN`, `SENTRY_API_TOKEN` used consistently across tasks
