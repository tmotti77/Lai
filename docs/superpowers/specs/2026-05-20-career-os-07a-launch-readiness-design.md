# CareerOS — Phase 7a Design: Production Launch Readiness

**Status:** Approved 2026-05-20. Ready for implementation plan.
**Phase:** 7a (of split Phase 7 = **7a launch readiness** / 7b legal+data rights / 7c growth+ops / 7d §30 self-employment)
**Predecessors:** Phases 6a (merged), 6b (merged), 6c (merged).
**Out of scope here:** Cookie banner, lawyer-reviewed legal pages, GDPR endpoints, hard-delete, native-speaker Hebrew copy review, load testing, admin dashboard UI, beta-tester recruitment, §30 self-employment module.

---

## 1. Goal

Phase 7a answers exactly one question: **"Can this app safely receive real production traffic from closed-beta testers?"**

A green-pass on 7a means every code path that runs against deployed infrastructure (Supabase prod, Vercel functions, Anthropic API direct, Sentry, Vercel Analytics) has been smoke-verified end-to-end. No new product features. No legal-compliance scope (that's 7b). No load testing (that's 7c). Just: production traffic can flow safely without losing data, leaking PII, or silently dropping observability signal.

---

## 2. Architecture decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Phase split | **7a launch readiness only** | Legal/data-rights, growth/ops, and §30 are independent subsystems with different review/timeline requirements. Lump = scope creep. |
| 2 | Cookie banner / analytics consent | **Deferred to 7b**, *unless* legal review concludes required before closed beta | Spec does NOT make a legal call here. Defer with the explicit escape hatch. |
| 3 | Hebrew copy review (native speaker / copywriter) | **Deferred to 7b polish pass** | Polish, not safety. 7a verifies pages render without error; 7b polishes the strings. |
| 4 | Supabase production posture | **Separate `career-os-prod` project** (not reuse dev) | Production must be isolated from 12+ days of dev test data. Pay the $25/mo Pro tier for clean separation. |
| 5 | Supabase backup tier | **Pro daily backups only**; PITR add-on deferred | PITR is paid add-on + requires Small compute. For closed beta, daily backups are sufficient. Re-evaluate before public launch. |
| 6 | AI Gateway | **Not in scope** | App uses `@ai-sdk/anthropic` direct. No migration to AI Gateway in 7a. |
| 7 | Node version | **Upgrade `.nvmrc` 20 → 24** (Node 20 EOL 2026-04-30) | Mandatory before launch. Vercel supports Node 24 LTS for builds + functions. Run full suite under 24 before deploy. |
| 8 | Preview environment isolation | **Preview uses dev/staging Supabase; ADMIN_EXPORT_TOKEN may be omitted in preview** | Production env scope contains prod Supabase + admin token; preview scope must not contain prod-mutating credentials. ADMIN_EXPORT_TOKEN is intentionally NOT in `lib/env.ts`'s required list — admin export returns 401 in preview, the desired behavior. |
| 9 | Smoke vs release evidence | **Split into blocking smoke (15 checks) + release evidence (3 gates, non-blocking)** | Sentry events / Vercel Analytics dashboards have async indexing — forcing them into blocking smoke creates flakiness. Sentry verified via Events API polling (release evidence). Vercel Analytics manually verified. |
| 10 | Cleanup strategy | **Track the anonymous `user_id` created at smoke start; cascade-delete from `users` (FK cascades drop dependent rows). Plus async sweeper for stale anonymous users older than 24h with no chat activity.** | Middleware creates `users` + `anonymous_sessions` BEFORE any tagged row is written; `metadata.smoke_run_id` only reaches rows our routes insert. Cascading from the smoke user_id catches everything reliably. The async sweeper is the fallback if inline cleanup fails. |
| 11 | Database rollback posture | **Explicit human decision, never automatic** | App rollback (Vercel promote previous SHA) is instant + idempotent. DB rollback requires PITR (not enabled in 7a) OR manual SQL OR forward-fix migration. No destructive SQL without second reviewer. |
| 12 | Custom SMTP for auth emails | **Decision deferred to deploy time**: configure custom SMTP OR explicitly accept Supabase default for closed beta + smoke magic-link click-through | Default is fine for closed beta; custom SMTP recommended pre-public-launch (deliverability). |
| 13 | AI abuse/cost guard for anonymous chat | **Config-only defenses in 7a**: (a) Anthropic console spend cap configured (hard cap); (b) Vercel Firewall rate limits on `/api/chat` (e.g., 30 req/min/IP); (c) accept-and-document that closed beta = trusted-tester audience. Code-level rate limiting deferred to 7b. | Anonymous AI endpoints + closed beta = real cost exposure if abused. Config caps + IP rate limits cover the bulk of the risk without new code; harder defenses (per-user quotas, captcha) wait for 7b. |
| 14 | Content Security Policy | **Deferred to 7b (security hardening pass)**. 7a verifies existing security headers (`x-content-type-options: nosniff` on admin export) but does NOT introduce CSP. | A real CSP requires inventory of all script/style/img/connect sources + careful Vercel + Next.js integration. Out of scope for "can app receive prod traffic safely" — defer to 7b legal/hardening alongside cookie banner work. |
| 15 | Beta entry URL | **Closed-beta entry is `/chat`** (not `/`). `/` remains the public "coming soon" page until 7c. | Avoids a "production redirect" code change in 7a; testers receive `/chat` URLs directly. Public `/` redirect to app is a 7c growth-task. |

---

## 3. Production env-var manifest

Names match runtime consumers (not all live in `lib/env.ts` — Sentry vars consumed in instrumentation, admin token in route).

```
# Anthropic
ANTHROPIC_API_KEY              # Console: https://console.anthropic.com
ANTHROPIC_MODEL                # <verified-current-model-id> — verify exact ID before setting

# Supabase prod project
NEXT_PUBLIC_SUPABASE_URL       # https://<prod-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  # Project Settings → API
SUPABASE_SERVICE_ROLE_KEY      # Project Settings → API (server-side only)

# Site
NEXT_PUBLIC_SITE_URL           # Exact prod host, no trailing slash

# Sentry (Phase 6c) — mandatory for prod
SENTRY_DSN
SENTRY_AUTH_TOKEN              # Sourcemap upload at build time
SENTRY_ORG
SENTRY_PROJECT

# Admin export (Phase 6b)
ADMIN_EXPORT_TOKEN             # openssl rand -hex 32 — fresh per environment
```

**Required-vs-optional matrix:**

| Var | Required by `lib/env.ts`? | Production | Preview |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | prod | dev/staging |
| `ANTHROPIC_MODEL` | yes | prod | dev/staging |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | prod | dev |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | prod | dev |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | prod | dev |
| `NEXT_PUBLIC_SITE_URL` | yes | prod | preview URL |
| `SENTRY_*` quartet | no (optional) | prod | omit or share dev |
| `ADMIN_EXPORT_TOKEN` | **no** | set | **omit** (endpoint returns 401, desired) |

---

## 4. Supabase production project setup

1. New Supabase project `career-os-prod` in `eu-central-1` (Frankfurt — matches dev region)
2. **Pro tier** (daily backups; PITR deferred)
3. **Pre-migration backup availability confirmed** (no restore drill in 7a)
4. **Apply all migrations** from `supabase/migrations/` in order — currently **11 files**
5. **Storage:** verify `cv-uploads` bucket exists, is private (`public === false`), has 30-day lifecycle deletion policy configured via dashboard
6. **Auth providers + email deliverability:**
   - Magic link: configure custom SMTP OR explicitly accept Supabase default for closed beta + smoke-test magic links work end-to-end (deliverability + `/auth/callback` click-through)
   - Google OAuth: new prod Google Cloud OAuth client; redirect URLs include `<prod-domain>/auth/callback`
   - Supabase Dashboard → Authentication → URL Configuration: allowed redirect URLs include prod domain
7. **Seed:** `npm run seed:occupations` against prod DB
8. **RLS spot-check:** anon role can't `SELECT * FROM users` / `FROM feedback` / `FROM career_profile`

---

## 5. Vercel project setup

1. New Vercel project linked to `tmotti77/Lai`
2. Production branch: `main`
3. Production env vars per §3 manifest
4. **Preview environment env scope** uses dev/staging Supabase; ADMIN_EXPORT_TOKEN omitted; SENTRY_* either omitted or pointed at dev project / `environment=preview` tag
5. **Preview-write smoke**: deploy a feature branch preview, confirm `POST /api/feedback` does NOT write to prod tables (writes to dev or returns 500 — both acceptable; what's unacceptable is writing to prod)
6. Custom domain configured (user decides exact host — `career-os.app` / `careeros.co.il` / etc.)
7. Build command: `npm run build` (default)
8. **Node version: 24 LTS** in Vercel project settings → Build & Development

**Node upgrade prerequisite work:**
- `.nvmrc` currently `20`; bump to `24`
- `package.json` `engines.node` → `>=24.0.0`
- Run full `npm test` + `npm run build` under Node 24 before deploy

---

## 6. Blocking smoke suite — `scripts/smoke-production.mjs`

Reproducible CI-runnable verification script. Runs against any deployed URL. Exits 0 on all-pass, non-zero with JSON output on failure.

**Required env (passed via flags or env vars, never printed):**

```
node scripts/smoke-production.mjs \
  --url https://career-os.app \
  --admin-token "$ADMIN_EXPORT_TOKEN" \
  --supabase-url "$NEXT_PUBLIC_SUPABASE_URL" \
  --supabase-anon-key "$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --supabase-service-role-key "$SUPABASE_SERVICE_ROLE_KEY" \
  --expected-supabase-ref "<prod-ref>" \
  --sentry-org "$SENTRY_ORG" \
  --sentry-project "$SENTRY_PROJECT" \
  --sentry-api-token "$SENTRY_API_TOKEN"   # read-only events:read scope; separate from SENTRY_AUTH_TOKEN
```

| # | Check | Pass criteria |
|---|---|---|
| 1 | App boots + RTL | `GET /` → 200, HTML contains `<html dir="rtl" lang="he">`. (Coming-soon body OK for 7a; entry is `/chat`.) |
| 2 | Anonymous cookie attrs | `GET /chat` → first response includes `Set-Cookie: co_anon=...` with `Secure`, `HttpOnly`, `SameSite=Lax`; cookie persists across one follow-up request |
| 3 | Static pages render | `GET /privacy` + `GET /terms` → 200, contain stable DOM marker (`<main>` or `<h1>` text from the page, not full prose match) |
| 4 | Chat reachability | Tiny deterministic Hebrew prompt to `POST /api/chat`; abort stream after first valid chunk; short timeout (8s). Without consent → 403; with consent → 200 + ≥1 stream chunk; never 500. |
| 5 | Consent endpoint | `POST /api/consent {}` (body ignored by current contract) → 200 `{ok: true}`. `GET /api/consent` → `{processing: true, disclaimer: true}`. Followup chat unblocked. |
| 6 | Recommendations shape | `POST /api/recommendations` → JSON with keys `recommendation_id` + `thumbs` map (shape-only assertion — empty `paths`/`rankings` arrays OK for fresh user) |
| 7 | Thumb writes | `POST /api/feedback` thumb body → 200 `{ok:true}`; service-role SELECT confirms row exists under the smoke `user_id` (NOT by smoke_run_id which only lives in `metadata`) |
| 8 | NPS idempotency | NPS submit → 200 `{ok:true}`; immediate double-submit → 200 `{ok:true, already:true}` |
| 9 | NPS dismiss | `POST /api/feedback/nps-dismiss` → 204 |
| 10 | Admin export auth matrix | With correct Bearer → 200 with `content-type: text/csv` (verify status + header only; **do NOT inspect CSV payload — concurrent beta traffic could leak via the script's logs**). Wrong token → 401. No token → 401. |
| 11 | Migration check (read-only) | `information_schema.columns` query via service-role: `feedback` table exists with expected column count; `users.nps_eligibility_first_at` column exists. NO writes. |
| 12 | Storage bucket | Via storage admin API: `cv-uploads` bucket exists, `public === false`. Anon-client `list` against bucket fails. |
| 13 | Security headers | `x-content-type-options: nosniff` on admin export response; cookies on `/chat` have `Secure` + `SameSite`. **CSP deferred to 7b — do not assert.** |
| 14 | Env sanity | Required secrets present (existence-check only — never print values). `NEXT_PUBLIC_SUPABASE_URL` host matches `<expected-supabase-ref>.supabase.co`. |
| 15 | Cleanup (idempotent) | `try/finally` cascade-DELETE from `users WHERE id = <smoke_user_id>` — FKs cascade to conversations, messages, feedback, recommendations, plans, plan_tasks, consents, anonymous_sessions, interview_sessions, cv_uploads, etc. If CV uploads were exercised, also delete from `cv-uploads` storage by user_id prefix. Logs **row counts only**, never payloads. Separate async sweeper (`scripts/smoke-cleanup.mjs`) deletes anonymous users with `is_anonymous=true AND created_at < now() - 24h AND no chat activity`. |

**Release evidence** (separate gates, non-blocking for deploy promote):

| # | Check | Method | Window |
|---|---|---|---|
| R1 | Sentry pipeline | `POST /api/_internal/sentry-test` (gated by **reused `ADMIN_EXPORT_TOKEN`** — no new env var) calls `Sentry.captureException(new Error("smoke"))` + `Sentry.flush(5000)` + returns `{eventId}` → smoke script polls `GET https://sentry.io/api/0/projects/{org}/{project}/events/?query=event.id:{eventId}` using `SENTRY_API_TOKEN` (read scope) with 2–5 min retry window | 2–5 min |
| R2 | Sourcemaps uploaded | **Build-time verification**: confirm sourcemap upload step exited 0 in Vercel build logs; verify no public `.map` files served from prod (`curl https://career-os.app/_next/static/chunks/<chunk>.js.map` → 404 or 403) | Build, not smoke |
| R3 | Vercel Analytics dashboard | **Manual evidence only** — capture screenshot of dashboard showing the `feedback_submitted` event | Within 24h post-deploy; **NOT a promote gate** |

**Implementation note**: Vercel Analytics has no stable public query API (per their docs: dashboard-viewable + exportable only). Treat as manual evidence.

**Why split blocking vs evidence**: blocking smoke must be fast + reliable so any deploy attempt can run it. Release evidence has slower windows (Sentry indexing ~30-120s; Vercel Analytics dashboard ~minutes) — putting them in blocking smoke creates false negatives that delay safe deploys.

### 6.1 Worked examples (representative requests + responses)

```bash
# Check #4 — chat reachability (with consent already accepted)
curl -X POST "$URL/api/chat" \
  -H "content-type: application/json" \
  -H "cookie: co_anon=$SMOKE_TOKEN" \
  -d '{"messages":[{"role":"user","content":"שלום"}],"conversationId":"<smoke-conv-id>"}' \
  --max-time 8
# Expect: 200 with text/event-stream body; abort after first chunk

# Check #5 — consent
curl -X POST "$URL/api/consent" \
  -H "content-type: application/json" \
  -H "cookie: co_anon=$SMOKE_TOKEN" -d '{}'
# Expect: 200 {"ok": true}

curl "$URL/api/consent" -H "cookie: co_anon=$SMOKE_TOKEN"
# Expect: 200 {"processing": true, "disclaimer": true}

# Check #7 — thumb feedback
curl -X POST "$URL/api/feedback" \
  -H "content-type: application/json" \
  -H "cookie: co_anon=$SMOKE_TOKEN" \
  -d '{"kind":"thumb","surface":"recommendations","target_type":"recommendation_occupation","target_id":"<rec-id>:<occupation-id>","thumbs_value":1,"metadata":{"smoke_run_id":"<uuid>"}}'
# Expect: 200 {"ok": true}

# Check #8 — NPS double-submit idempotency
curl -X POST "$URL/api/feedback" -H "content-type: application/json" -H "cookie: co_anon=$SMOKE_TOKEN" \
  -d '{"kind":"nps","nps_score":9,"nps_trigger":"pdf_download","comment_he":""}'
# First: 200 {"ok": true}
# Second (identical body): 200 {"ok": true, "already": true}

# Check #10 — admin export auth matrix (status + content-type only; never inspect body)
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  "$URL/api/admin/feedback/export" -H "authorization: Bearer $ADMIN_EXPORT_TOKEN"
# Expect: 200 text/csv; charset=utf-8

curl -s -o /dev/null -w "%{http_code}\n" "$URL/api/admin/feedback/export"
# Expect: 401

# Release evidence R1 — Sentry test endpoint
curl -X POST "$URL/api/_internal/sentry-test" -H "authorization: Bearer $ADMIN_EXPORT_TOKEN"
# Expect: 200 {"eventId": "<32-hex-chars>"}

# Then poll Sentry Events API for the returned eventId:
curl "https://sentry.io/api/0/projects/$SENTRY_ORG/$SENTRY_PROJECT/events/?query=event.id:$EVENT_ID" \
  -H "authorization: Bearer $SENTRY_API_TOKEN"
# Retry every 15s up to 5 min; success when results array is non-empty
```

---

## 7. Manual user-journey verification

Run this **after** the scripted smoke suite passes against the production deployment. Use a fresh browser profile or incognito session and record the deployment URL, commit SHA, tester name, browser, device/viewport, and timestamp.

1. Start as an anonymous visitor on **`/chat`** (the closed-beta entry — `/` is still the "coming soon" landing page until 7c). Confirm the first screen loads quickly, Hebrew copy renders right-to-left, and no logged-in-only UI appears.
2. Accept consent. Confirm the consent state persists after refresh and that chat is no longer blocked.
3. Complete at least three chat turns. Use realistic Hebrew input. Confirm streamed responses appear incrementally, preserve RTL direction, and do not show raw model/system errors.
4. Continue into the assessment flow. Verify progress, validation, back/forward behavior, and that dynamic Hebrew content remains aligned and readable.
5. Reach recommendations. Confirm each recommendation has a clear title, rationale, recommendation ID-backed feedback controls, and no empty/loading placeholders.
6. Submit thumbs feedback on one recommendation. Confirm the UI acknowledges it once and does not duplicate on refresh.
7. Download the PDF. Open it and verify Hebrew text, layout direction, user-specific content, and filename are acceptable for closed beta.
8. Submit NPS once, then attempt a second submit. Confirm the second attempt is handled idempotently rather than creating a visible error.
9. Repeat the core screens at a 375px mobile viewport: home, consent, chat, assessment, recommendations, feedback, and PDF download entry point. No clipped buttons, overlapping text, or unusable controls.
10. Record findings in the launch checklist with severity, URL, screenshot/video, expected behavior, actual behavior, and owner. **Fail fast and rollback** for: data loss, privacy leaks, broken consent gating, broken chat, broken PDF generation, admin/auth bypass, or widespread mobile unusability. **Defer** only: cosmetic issues, minor copy problems, or non-blocking analytics gaps that don't affect closed-beta users.

---

## 8. Rollback runbook

Rollback is allowed when production is materially worse than the previous known-good deployment and the fix cannot be safely shipped forward within the incident window.

### 8.1 App-level rollback (primary path)

Promote the previous known-good Vercel deployment.

1. Identify the currently active production deployment SHA and the previous known-good production SHA.
2. Confirm the previous deployment passed Phase 7a smoke checks or was the last stable production release.
3. In Vercel, use **Instant Rollback / Promote previous deployment** for that deployment.
4. Verify production routes after promotion:
   - `/`
   - `/privacy`
   - `/terms`
   - `/api/chat`
   - admin export auth check
5. Re-run `scripts/smoke-production.mjs`.
6. Record the rollback SHA, incident reason, timestamp, and verifier.

This action is intended to be instant and idempotent: promoting the same known-good deployment again should leave production in the same state.

### 8.2 Database rollback posture

Database rollback is **never automatic** in Phase 7a. It requires an explicit human decision.

Before every deploy promotion, confirm a pre-deploy database backup exists. If a database rollback is required, choose one of:

- **PITR restore** if point-in-time recovery is enabled (not required for Phase 7a)
- **Manual SQL repair** using reviewed, transaction-wrapped SQL
- **Forward migration** when safer than reverting schema or data

**Do not apply destructive SQL during an incident without a second reviewer.**

### 8.3 Scenario guidance

- **Bad migration applied**: stop deploy promotion if possible. If already live, decide whether app rollback alone is enough. If schema/data is incompatible with the old app, prefer forward-fix migration or manual SQL repair.
- **Bad env var set**: correct the env var, redeploy/promote a known-good build using the corrected environment, then rerun smoke. Do not print secret values in logs.
- **Bad code shipped**: use Vercel rollback to previous known-good deployment, then smoke production.
- **Production data corruption from buggy mutation**: immediately disable the mutation path if possible (kill switch / feature flag), preserve evidence, estimate blast radius, then choose PITR / manual SQL / forward repair. App rollback alone may not repair corrupted rows.

### 8.4 Rollback vs roll-forward decision

- **Roll back** when the issue is user-facing, broad, security-sensitive, revenue-blocking, or the forward fix is uncertain
- **Roll forward** when the fix is small, well understood, tested, and safer than restoring old code or data
- **Pause and escalate** when database state is unclear

### 8.5 Testing the runbook

Before release: perform a no-op deploy, promote it, then promote the previous SHA back as a dry run. Confirm smoke passes after each promotion and record the commands/screenshots used.

### 8.6 Communications

Notify the release owner, engineering lead, product owner, and anyone monitoring support/admin channels. For security or data integrity incidents, include the data owner and incident lead. Keep updates factual: impact, action taken, current SHA, database decision, and next verification step.

---

## 9. New code surface (small — most work is configuration)

```
scripts/smoke-production.mjs                Reproducible smoke runner (15 blocking + 1 polling release-evidence check R1)
scripts/smoke-cleanup.mjs                   Async sweeper: anonymous users older than 24h with no chat activity
app/api/_internal/sentry-test/route.ts      ADMIN_EXPORT_TOKEN-gated; calls captureException + flush(5000) + returns {eventId}

.nvmrc                                       20 → 24
package.json                                 engines.node update + @types/node bump to ^24
.github/workflows/test.yml                   CI runner Node version 24 (currently 20)
README.md                                    Production env-var docs expanded (currently only ADMIN_EXPORT_TOKEN documented)
docs/superpowers/runbooks/launch-rollback.md  Operational runbook extracted from §8 for quick reference
```

**Explicitly NOT added in 7a code:**
- No CSP middleware/headers work (deferred to 7b per decision #14)
- No code-level rate limiting (config-only defenses per decision #13)
- No `/api/consent` contract changes (smoke matches current `200 {ok:true}` shape)
- No root URL redirect (closed-beta enters at `/chat` per decision #15)

No new product code. No matching engine / AI prompt / UI changes. Phase 7a is purely deployment + verification.

---

## 10. Definition of done

**Promote gate** — must pass before promoting a deploy to production traffic:

| Gate | How verified |
|---|---|
| `.nvmrc=24` + `engines.node` + `@types/node@^24` + CI workflow Node 24 + Vercel project Node 24 | Build logs show Node 24; CI runs under 24; `package.json` diff |
| All 11 migrations applied to `career-os-prod` | `information_schema` query confirms tables + columns |
| All env vars in §3 manifest set in Vercel Production scope | Vercel dashboard verification |
| Preview env isolated (no prod credentials) | Preview deploy of branch → confirm `POST /api/feedback` doesn't hit prod tables |
| Anthropic console spend cap configured (config decision #13) | Anthropic dashboard screenshot in runbook |
| Vercel Firewall rate limits on `/api/chat` configured (decision #13) | Firewall rules screenshot in runbook |
| `npx tsc --noEmit` clean | CI |
| `npm test` green under Node 24 | CI |
| `npm run build` green under Node 24 | CI |
| `scripts/smoke-production.mjs` exits 0 against deployed URL | Manual + CI nightly |
| Sourcemaps uploaded at build time | Build log inspection; no public `.map` files |
| Manual user-journey passes per §7 | Tester checklist signed off |
| Rollback runbook dry-run completed | Promote-previous-SHA exercise recorded |
| README env-var docs updated | PR diff review |
| Supabase `cv-uploads` 30-day lifecycle policy configured | Dashboard screenshot in runbook |

**Phase-close evidence** — non-blocking for any single deploy promote; needed to close out 7a phase:

| Gate | How verified |
|---|---|
| Sentry pipeline verified (R1) | `/api/_internal/sentry-test` returns eventId visible via Events API within 2–5 min |
| Vercel Analytics dashboard shows test `feedback_submitted` event (R3) | Manual screenshot ≤ 24h post-deploy |

---

## 11. Out of scope (intentional)

- Cookie banner / consent UX (7b, unless legal review escalates)
- Lawyer-reviewed Hebrew T&C / privacy polish (7b)
- Hebrew copywriter pass on NPS / assessment strings (7b)
- GDPR data-export endpoint (7b)
- Hard-delete endpoint with cascading deletes + audit log (7b)
- Retention policy / data minimization (7b)
- §30 self-employment module (7d — substantial feature work)
- Admin dashboard UI (7c)
- Load testing (7c — k6/Artillery against deployed prod)
- Beta-tester recruitment + onboarding flow (7c)
- Native Hebrew copy review (7b polish)
- AI Gateway migration (not on roadmap)
- PITR add-on (re-evaluate before public launch)
- Custom SMTP setup (deferred to deploy-time decision)

---

## 12. Risks / mitigations

| Risk | Mitigation |
|---|---|
| Migration applied to prod doesn't reproduce dev behavior | Smoke #11 read-only `information_schema` check; manual user-journey §7 catches functional drift |
| Preview branch writes to prod tables | §5 preview-write smoke; per-env scope in Vercel dashboard |
| Sentry pipeline silently broken | Release-evidence R1 polls Events API; CI nightly re-runs |
| Sourcemaps not uploaded → stack traces unreadable | Build-time R2 check; manual symbolication test of R1 event |
| ADMIN_EXPORT_TOKEN leaked or reused | Fresh-per-environment generation; never printed in logs; can be rotated via Vercel env var update without redeploy |
| Bad migration corrupts production data | §8.2 explicit human decision; pre-deploy backup confirmed; second-reviewer rule on destructive SQL |
| Magic-link auth emails not delivered | Smoke includes magic-link click-through test; custom SMTP recommended pre-public-launch |
| Node 20 EOL between now and deploy | §2 #7 mandates Node 24 upgrade as gated task; full suite runs under 24 before deploy |
| Anonymous AI chat abused/spend exploded | §2 #13: Anthropic console hard spend cap + Vercel Firewall rate limits + closed-beta trusted audience. Code-level per-user quotas in 7b. |
| Smoke script accidentally logs CSV payload → leaks real beta-user data | §6 #10 hardened: assert status + content-type only, never inspect body. Smoke logs row counts, never row payloads. |
| Smoke script orphans anonymous user rows | §6 #15: cascade-DELETE from `users` covers all FK-linked tables; `scripts/smoke-cleanup.mjs` sweeper catches stale residue |
