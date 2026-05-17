# CareerOS — Phase 6c Design: Production-readiness fixes + Polish + Observability

**Status:** Approved 2026-05-17. Ready for implementation plan.
**Phase:** 6c (of split Phase 6 = 6a interview / 6b feedback+analytics / **6c polish + observability**)
**Out of scope here:** 6b (feedback infra + Vercel Analytics).

---

## 1. Goal

Two complementary objectives bundled into one phase:

1. **Fix the production-readiness bugs surfaced in the 2026-05-17 deep review** — three High-severity (chat-engine regression, SECURITY DEFINER privileges, server-side consent), four Mediums (CV race, extraction shape, CV confirm correctness, recommendations regen), one Low (nested `<button>`).
2. **Land observability + polish on top of a known-correct baseline** — Sentry (server + edge only), state audit, mobile QA, a11y pass.

Bucket A (bugs) lands before Bucket B (polish + observability) so Sentry doesn't ship to production noisily logging the bugs we already know about.

## 2. Architecture decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Bucket ordering | **A (bugs) before B (polish)** in the same PR | Sentry on top of broken behavior just records the same error 10,000 times. Fix first; observe second. |
| 2 | Chat-message bug fix | **Caller appends current user message to history before `streamLlmTurn`** | Mirrors the interview route's `[...history, llmUserMessage]` pattern (which is correct). The engine intentionally stays minimal and doesn't infer caller intent. Add a regression test that asserts the streamText `messages` array ends with the current user turn. |
| 3 | SECURITY DEFINER hardening | **One migration that `REVOKE EXECUTE … FROM PUBLIC` on every `SECURITY DEFINER` function, then `GRANT EXECUTE … TO service_role`** | Defense in depth. Service role bypasses RLS anyway, so this is the principle-of-least-privilege baseline. Anonymous + authenticated clients can never call these RPCs directly. |
| 4 | Server-side consent enforcement | **Single `requireConsent(userId)` helper called at the top of chat/cv/recommendations/plan/interview API routes** | Centralized check. Reads `users.consented_at` (or whatever the column is — see §4) — if null, route returns 403 with `error: "no_consent"`. Client modal still enforces UX-side, server now enforces correctness. |
| 5 | CV race fix | **Move `cvUploadId` setting into `onUploadComplete` callback that returns before the user can click submit** | Synchronous-ordering pattern. Don't allow submit until the upload promise resolves with the id. |
| 6 | Chat extraction shape fix | **Align extraction zod schema with `MatchingProfile` types** | The matcher is the consumer of the extraction. Whichever side is "correct", make the other match. The matcher's shape is canonical (it's what the deterministic engine consumes), so extraction must produce that shape. |
| 7 | CV confirm multi-row fix | **Pick the latest row for read; scope UPDATE to that specific `id`** | `order("updated_at desc").limit(1)` for the read, then `.eq("id", that.id)` for the update. |
| 8 | Recommendations regen | **Server-side `force=true` body param skips `getCached`** | Client already sends `cache: "no-store"`, but that only affects HTTP cache. Server has its own DB-level cache via `getCached(userId, profileHash)`. Add a `force` body field that bypasses it. |
| 9 | Sentry depth | **Server + edge runtimes only. No browser SDK. No replay. No performance tracing (tracesSampleRate: 0).** | Minimal-viable observability for pre-launch. Free tier 5K events/mo is plenty. Browser/performance can land in 6c.5 once we have real traffic baseline. |
| 10 | Sentry PII | **`sendDefaultPii: false` + strict `beforeSend` scrubber that drops user message text** | Hebrew chat content is sensitive (career struggles, mental-health phrasing for the safety detector). Sentry sees: route name, conversation_id, stage, user.is_anonymous, error message, stack trace. NOT the user's words. |
| 11 | a11y target | **WCAG 2.2 AA** | Industry standard. Matches the project's existing focus-rings/44px-tap-targets/contrast rules in `~/.claude/rules/ui-design.md`. Tooling: axe-core via `@axe-core/playwright`. |
| 12 | Mobile QA viewports | **375 (iPhone SE) + 768 (iPad portrait) + 1280 (desktop)** | Drop 414 unless 375/768 reveal layout fragility. Smallest-still-supported + smallest tablet + smallest desktop. |
| 13 | State audit pattern | **For each surface, catalog empty/loading/error states; add the missing ones; use existing `/recommendations` empty-state as the canonical pattern** | One-pass audit, fix in-place. Not a global state-state-management refactor. |

## 3. File / module structure

### 3.1 New files

```
lib/ai/consent.ts                                    requireConsent(userId): throws or returns
sentry.server.config.ts                              Sentry server-runtime init
sentry.edge.config.ts                                Sentry edge-runtime init
instrumentation.ts                                   Next.js 16 instrumentation entrypoint (loads sentry configs)

supabase/migrations/20260517100000_revoke_rpc_execute.sql
                                                     REVOKE EXECUTE … FROM PUBLIC on all SECURITY DEFINER fns

tests/unit/ai/engine-message-flow.test.ts            Regression test: current user msg reaches streamText
tests/unit/ai/consent.test.ts                        requireConsent helper unit tests
scripts/verify-all-surfaces.mjs                      Reusable playwright sweep at 3 viewports
```

### 3.2 Modified files (Bucket A — bugs)

```
app/api/chat/route.ts                                A1: append {role:"user", content:userText} to history
app/api/cv/upload/route.ts                           A3: requireConsent gate
app/api/cv/confirm/route.ts                          A3: requireConsent + A6: scope UPDATE to specific id
app/api/recommendations/route.ts                     A3: requireConsent + A7: respect force=true
app/api/plan/generate/route.ts                       A3: requireConsent
app/api/interview/route.ts                           A3: requireConsent
components/cv/CvUploadClient.tsx                     A4: synchronous cvUploadId state before submit
components/cv/CvReview.tsx                           A8: flatten nested <button>
components/recommendations/RecommendationsClient.tsx A7: pass force:true in regen body
lib/ai/extraction.ts                                 A5: align values + constraints output shape with MatchingProfile
```

### 3.3 Modified files (Bucket B — polish + observability)

```
package.json                                         @sentry/nextjs + @axe-core/playwright deps
app/(app)/chat/...                                   B3: state audit
app/(app)/cv/...                                     B4: state audit
app/(app)/assessment/...                             B5: state audit
app/(app)/plan/...                                   B6: state audit
components/ui/...                                    Possible shared loading/empty/error shells
lib/i18n/he.ts                                       New he.empty.*, he.loading.*, he.error.* if shared
CLAUDE.md                                            Phase 6c architecture section
```

## 4. Bug-fix specifications

### A1 — Chat-engine regression (current user message not in LLM input)

**Where:** `app/api/chat/route.ts` (introduced in commit `9033071`, Phase 6a Task 2).

**Cause:** When extracting `streamLlmTurn`, the user-persist call moved INSIDE the engine (via `onUserPersist`), but the chat route still calls `loadMessages` BEFORE the engine runs. Result: `history` snapshot misses the just-sent message; `streamText` receives stale messages.

**Fix:** Caller appends the current user message to history before passing to engine. Same pattern interview route already uses:

```ts
const llmUserMessage: ModelMessage = { role: "user", content: userText };
const messagesForLlm = userText ? [...historyAsModelMessages, llmUserMessage] : historyAsModelMessages;

return streamLlmTurn({
  userText,
  history: messagesForLlm,  // includes current turn
  // ...
});
```

**Test gate:** new unit test in `tests/unit/ai/engine-message-flow.test.ts`:

```ts
it("the current user message reaches the streamText messages array", async () => {
  // Mock streamText, capture its args
  let captured: { messages?: ModelMessage[] } = {};
  (streamText as Mock).mockImplementation((opts: any) => {
    captured = opts;
    return mockStreamResult();
  });

  // Drive chat route equivalent (or call streamLlmTurn directly with proper history)
  await streamLlmTurn({
    userText: "hello",
    history: [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "fine" },
      { role: "user", content: "hello" }, // ← the current turn
    ],
    // ...
  });

  const lastMessage = captured.messages![captured.messages!.length - 1];
  expect(lastMessage.role).toBe("user");
  expect(lastMessage.content).toBe("hello");
});
```

Plus an integration test that drives the actual `/api/chat` route and asserts the message gets through.

### A2 — SECURITY DEFINER privileges

**Where:** `supabase/migrations/20260510141000_counters_rpc.sql:8` + `supabase/migrations/20260510183000_career_profile.sql:37`.

**Cause:** Functions marked `SECURITY DEFINER` bypass RLS but default to `EXECUTE` granted to `PUBLIC`. Anon clients can call them directly with the publishable key.

**Fix:** Single new migration:

```sql
-- supabase/migrations/20260517100000_revoke_rpc_execute.sql

-- Counter RPCs
revoke execute on function increment_conversation_counter(uuid, text) from public, anon, authenticated;
grant execute on function increment_conversation_counter(uuid, text) to service_role;

revoke execute on function increment_user_counter(uuid, text) from public, anon, authenticated;
grant execute on function increment_user_counter(uuid, text) to service_role;

-- Career profile RPC
revoke execute on function merge_career_profile(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function merge_career_profile(uuid, uuid, text, jsonb) to service_role;
```

(Real function signatures will be verified against the actual migrations before writing this — placeholders shown.)

### A3 — Server-side consent enforcement

**Where:** API routes that mutate user data without checking consent.

**Helper:** New `lib/ai/consent.ts`:

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export class NoConsentError extends Error {
  constructor() {
    super("no_consent");
  }
}

export async function requireConsent(userId: string): Promise<void> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("users")
    .select("consented_at")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`requireConsent: ${error.message}`);
  if (!data?.consented_at) throw new NoConsentError();
}
```

Each gated API route catches `NoConsentError` and returns 403:

```ts
try {
  await requireConsent(userId);
} catch (e) {
  if (e instanceof NoConsentError) {
    return Response.json({ error: "no_consent" }, { status: 403 });
  }
  throw e;
}
```

If `users.consented_at` doesn't exist as a column, the consent-record is wherever Phase 1 put it (TBD — verify in implementation; the column name may be different, e.g. `t_and_c_accepted_at`).

### A4 — CV upload race

**Where:** `components/cv/CvUploadClient.tsx` lines 64, 96, 113.

**Cause:** State machine briefly has `cvUploadId` undefined between upload complete and submit. Click races can fire `confirm()` with an empty UUID.

**Fix:** Make the "submit" button disabled until the upload promise resolves with an id. Move state setter into the awaited `.then()`, not next to the submit call.

### A5 — Chat extraction shape mismatch

**Where:** `lib/ai/extraction.ts:30` ↔ `lib/matching/profile.ts:62` ↔ `lib/matching/score/values.ts:15`.

**Cause:** Extraction zod emits values as `{ key: string, label_he: string }` (or similar object form), but the matcher's `MatchingProfile.values` expects `{ topThree: string[], alsoPicked: string[] }` (raw strings). Same divergence for constraints fields: `risk_tolerance_1_10` vs `risk_tolerance`, `native` vs `fluent`, etc.

**Fix:** Align the extraction zod schema to produce the matcher's shape directly. Where the LLM emits richer objects, the prompt instructs it to emit the string identifier (which the matcher uses as the key).

### A6 — CV confirm multi-row corruption

**Where:** `app/api/cv/confirm/route.ts:94, 124`.

**Cause:** `.from("career_profile").select(...).eq("user_id", userId).maybeSingle()` returns one row but UPDATEs by user_id, which targets ALL rows for that user.

**Fix:**

```ts
// Read latest row
const { data: profile } = await svc
  .from("career_profile")
  .select("id, data")
  .eq("user_id", userId)
  .order("updated_at", { ascending: false })
  .limit(1)
  .maybeSingle();

// Update by THAT row's id
await svc
  .from("career_profile")
  .update({ data: mergedData })
  .eq("id", profile.id);
```

### A7 — Regenerate doesn't bypass server cache

**Where:** `app/api/recommendations/route.ts:31` ↔ `components/recommendations/RecommendationsClient.tsx:43`.

**Fix server-side:**

```ts
const body = await request.json().catch(() => ({}));
const force = body?.force === true;

if (!force) {
  const cached = await getCached(internalUserId, hash);
  if (cached) return Response.json({ ...cached, cached: true });
}
// ... otherwise compute fresh
```

**Fix client-side:** send `{ force: true }` in regenerate body. Remove the now-superfluous `cache: "no-store"` (HTTP cache wasn't actually the issue).

### A8 — Nested `<button>` in CvReview

**Where:** `components/cv/CvReview.tsx:354, 371`.

**Fix:** Change the outer `<button onClick={toggleExpand}>` to `<div role="button" tabIndex={0} onClick={...} onKeyDown={Enter/Space→...}>` OR (cleaner) make the outer container a `<div>` with two SIBLING buttons inside. Whichever yields cleaner a11y behavior. Add a test if axe complains.

## 5. Sentry configuration detail (B1)

### 5.1 Install

```bash
npm install --save @sentry/nextjs
```

### 5.2 `sentry.server.config.ts`

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  environment: process.env.VERCEL_ENV ?? "development",
  release: process.env.VERCEL_GIT_COMMIT_SHA,

  // No replay, no tracing — minimal observability for pre-launch
  tracesSampleRate: 0,
  profilesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // PII scrubbing — Hebrew chat content is sensitive
  sendDefaultPii: false,

  beforeSend(event, hint) {
    // Drop request bodies entirely
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
    }
    // Drop user.email/username if it somehow got attached
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
    }
    // Drop free-text breadcrumbs we explicitly mark as user-content
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.filter(
        (b) => b.category !== "user-content",
      );
    }
    return event;
  },

  ignoreErrors: [
    "NEXT_NOT_FOUND",
    "NEXT_REDIRECT",
    // AbortError on stream cancellation is normal
    "AbortError",
  ],
});
```

### 5.3 `sentry.edge.config.ts`

Same shape, edge-runtime build. Identical PII scrubbing.

### 5.4 `instrumentation.ts`

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
```

### 5.5 Environment variables

- `SENTRY_DSN` — required, set in Vercel project env
- `SENTRY_AUTH_TOKEN` — for source map upload during build; set in Vercel build env only
- Source map upload via `withSentryConfig` in `next.config.ts`

### 5.6 No client SDK

We intentionally do NOT install `@sentry/nextjs/client` or its instrumentation. Client errors will be visible in browser DevTools during dev; Vercel logs catch what reaches the server. Add browser SDK in 6c.5 once production traffic shape is known.

## 6. State audit (B3-B6)

For each surface, verify the three states render correctly and add missing ones. Pattern reference: `components/recommendations/RecommendationsClient.tsx` (empty-state with CTA, error-state with retry).

| Surface | Empty | Loading | Error |
|---|---|---|---|
| `/chat` | ✅ "בוא נתחיל להכיר" exists | Initial-fetch skeleton needed | Stream-error toast needed |
| `/cv` | ✅ Drop zone is the empty state | Parsing/extracting indicator OK | Parse-failed error UI needed |
| `/assessment` hub | Already shows "טרם התחלת" badges | N/A (server component) | Hub-level fetch failure |
| `/assessment/{riasec,big5,values,constraints}` | New session = empty | Submission-in-flight | Submission-failed retry |
| `/recommendations` | ✅ `emptyProfile` exists | ✅ Computing exists | ✅ `error.generic` exists |
| `/plan` | ✅ "צור תוכנית 30 יום" CTA | Generation-in-flight indicator | Generation-failed retry |
| `/interview` | ✅ "עדיין לא קיימת/ ראיון" | N/A | Start-failed toast |
| `/interview/[sessionId]` | N/A (404 if missing) | Initial stream loading | Stream-failed retry |

Missing states get added using shared `<EmptyState>`, `<LoadingState>`, `<ErrorState>` components if multiple surfaces need them (DRY); inline if just one or two.

## 7. Mobile QA (B8)

Run `scripts/verify-all-surfaces.mjs` (generalization of yesterday's `verify-interview-ui.mjs`) at three viewports per surface:

- `{ width: 375, height: 667 }` — iPhone SE
- `{ width: 768, height: 1024 }` — iPad portrait
- `{ width: 1280, height: 800 }` — small desktop

Script outputs a screenshot grid (one image per surface × viewport). Manual eyeball: anything broken gets fixed in-place. Don't preemptively rewrite layouts that look fine.

## 8. a11y pass (B9-B10)

### 8.1 axe-core integration

`@axe-core/playwright` runs against each surface. Output: JSON report with violations classified by impact (critical / serious / moderate / minor). Fix all critical + serious; document moderate + minor in CLAUDE.md follow-up.

### 8.2 Manual checks

- Keyboard nav: Tab through every interactive element on every surface, ensure focus order matches visual order, every element gets a visible focus ring
- Hit areas: visually confirm ≥44px tap targets on mobile viewport
- aria-labels: scan for icon-only buttons missing labels (especially the close-X buttons in modals, the dismiss buttons in CvReview)
- Color contrast: trust axe for automation; spot-check the muted-text-on-dark-card pattern that the dark mode uses

## 9. Testing strategy

### 9.1 New unit tests (Bucket A)

- `tests/unit/ai/engine-message-flow.test.ts` — A1 regression gate
- `tests/unit/ai/consent.test.ts` — A3 helper
- `tests/unit/ai/extraction-shape.test.ts` — A5 schema produces matcher-compatible output
- `tests/unit/cv/confirm-multi-row.test.ts` — A6 picks latest row

### 9.2 New integration tests (Bucket A)

- `tests/integration/chat-current-message.test.ts` — drives `/api/chat`, captures streamText messages, asserts current turn present
- `tests/integration/consent-enforcement.test.ts` — calls each gated API without consent, asserts 403

### 9.3 New automation script (Bucket B)

- `scripts/verify-all-surfaces.mjs` — playwright sweep, 3 viewports × N surfaces, axe-core report per

### 9.4 Test runs in PR verification

`npx tsc --noEmit && npm test && npm run lint && npm run build` + `node scripts/verify-all-surfaces.mjs` (against running dev server).

## 10. Out of scope (deferred)

| Item | Lives in |
|---|---|
| Per-message thumbs feedback | 6b |
| NPS prompt | 6b |
| `feedback` table + admin export | 6b |
| Vercel Analytics events | 6b |
| Sentry browser SDK | 6c.5 (post-launch traffic) |
| Sentry Performance/tracing | 6c.5 (after baseline exists) |
| Sentry Session Replay | 7+ |
| WCAG 2.2 AAA | Never (excessive for this product) |
| 414px iPhone Plus viewport | Only if 375/768 reveal fragility |
| Full screen-reader test pass | 6c.5 (manual, time-consuming) |
| Internationalization (English UI) | Master roadmap out-of-scope |

## 11. Known risks + mitigations

| Risk | Mitigation |
|---|---|
| A1 fix changes chat history shape, breaking the integration test against a real Anthropic API | Mock streamText for the unit test (no real API call); integration test uses a fixture-driven mock too. Real-API e2e test stays manual via `scripts/e2e-test-chat.ts`. |
| A2 migration locks out a legitimate caller we missed | Audit before applying: `grep -rn "merge_career_profile\|increment_..._counter" --include="*.ts"` shows all callers; verify each goes through service role (it should). |
| A3 false-positives (anonymous-promoted users hitting routes pre-consent acceptance) | Anonymous user creation runs in middleware; consent is captured on the very next interaction. If `consented_at` is null on a user who's already past the disclaimer modal, that's a bug in client-side flow — fix that bug if surfaced, don't loosen the server check. |
| A5 fix breaks existing chat conversations whose extracted profiles are in the OLD shape | One-time migration that normalizes existing rows to the new shape. OR: matcher's `buildMatchingProfile` accepts both shapes during a transition window. Pick the simpler one in implementation. |
| Sentry source-map upload fails at build time (auth token missing/wrong) | Build proceeds without source maps; Sentry shows minified stacks. Acceptable for first deploy; fix iteratively. |
| axe-core flags issues in shadcn/ui components I shouldn't fix | Skip those violations from the report (`disabledRules` per-surface) or accept them. Don't rewrite library components. |
| State audit balloons (every surface needs a unique loading skeleton) | Start with shared `<LoadingSpinner>` + `<EmptyState>` + `<ErrorState>` shells; only build surface-specific UIs where the shared one looks wrong. |

## 12. Verification plan

After implementation:

1. **Unit:** all `tests/unit/**` pass.
2. **Integration:** all `tests/integration/**` pass.
3. **Engine regression test passes:** the current user message reaches `streamText` (proves A1 is fixed AND doesn't regress).
4. **Consent enforcement test passes:** all gated endpoints return 403 for a no-consent user (proves A3).
5. **Type check:** `npx tsc --noEmit` clean.
6. **Lint:** `npm run lint` clean (no new warnings).
7. **Build:** `npm run build` clean.
8. **Migration applied:** the REVOKE migration is on the remote DB.
9. **Sentry smoke test:** trigger a deliberate server error in dev (e.g., visit `/api/__sentry-test`) and confirm it shows up in Sentry dashboard (after Vercel deploy).
10. **a11y:** axe-core reports zero critical or serious violations across all surfaces.
11. **Mobile QA:** screenshot grid produced; no broken layouts at 375/768/1280.
12. **Manual E2E:** drive `/chat` end-to-end with the A1 fix in place — ask one question, verify the model answers it (not the previous one).

## 13. Definition of Done

**Bucket A (bugs):**
- [ ] A1: chat sends current user message to Claude; regression test asserts it
- [ ] A2: SECURITY DEFINER RPCs are no longer callable by anon/authenticated; migration applied
- [ ] A3: consent enforced server-side on chat/cv/recommendations/plan/interview routes
- [ ] A4: CV upload's `cv_upload_id` is guaranteed non-empty before submit can fire
- [ ] A5: chat-extracted values + constraints match `MatchingProfile` shape; existing rows migrated or matcher accepts both shapes
- [ ] A6: CV confirm uses latest-row read + scoped UPDATE
- [ ] A7: recommendations regenerate accepts `force=true` and bypasses cache
- [ ] A8: nested `<button>` in CvReview flattened

**Bucket B (polish + observability):**
- [ ] B1: Sentry server + edge configs live, source maps upload, smoke test in dashboard
- [ ] B2: axe-core integrated into Playwright sweep
- [ ] B3-B6: state audit complete for chat, cv, assessment, plan
- [ ] B7: state audit verified on recommendations + interview
- [ ] B8: mobile QA passes at 375/768/1280 across all surfaces
- [ ] B9: WCAG 2.2 AA — zero critical or serious axe violations
- [ ] B10: keyboard nav + visible focus rings verified across all surfaces
- [ ] B11: final smoke-test pass (verify-all-surfaces.mjs green)
- [ ] B12: CLAUDE.md "Phase 6c architecture" section appended

**Project gates:**
- [ ] PR title: *"Phase 6c: production-readiness fixes + observability + a11y"*
- [ ] lint + tsc + tests + build all green
- [ ] CI passes on PR
