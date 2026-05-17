# Phase 6c Implementation Plan — Production-readiness fixes + Polish + Observability

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 production-readiness bugs (Bucket A) and add observability + polish + a11y on top of the now-correct baseline (Bucket B). Sentry server+edge only, axe-core via Playwright, state audit across all surfaces, mobile QA at 375/768/1280, WCAG 2.2 AA.

**Architecture:** Bucket A lands first to avoid noisy Sentry alerts on known bugs. Chat-engine A1 regression has a unit-test gate so future engine refactors don't regress it. Consent enforcement is centralized via a single `requireConsent(userId, purposes)` helper added to the existing `lib/consent.ts`. RPC privileges revoked from anon/authenticated via one migration. Sentry runs in server + edge runtimes only with strict PII scrubbing (sendDefaultPii: false + beforeSend drops request bodies).

**Tech Stack:** Next.js 16 App Router • AI SDK v6 • Supabase (Postgres + RLS) • Vitest • Playwright + `@axe-core/playwright` (new) • `@sentry/nextjs` (new) • Tailwind v4 + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-05-17-career-os-06c-polish-and-observability-design.md` (commit `d2730b8`).

---

## File map

### New files

```
sentry.server.config.ts                              Sentry init for nodejs runtime
sentry.edge.config.ts                                Sentry init for edge runtime
instrumentation.ts                                   Next.js 16 instrumentation entrypoint
supabase/migrations/20260517100000_revoke_rpc_execute.sql
                                                     REVOKE EXECUTE FROM public on SECURITY DEFINER fns
scripts/verify-all-surfaces.mjs                      Reusable Playwright sweep at 3 viewports
tests/unit/ai/engine-message-flow.test.ts            A1 regression — current user msg reaches streamText
tests/unit/consent.test.ts                           A3 — requireConsent helper
tests/unit/ai/extraction-shape.test.ts               A5 — extraction zod produces MatchingProfile shape
tests/unit/db/cv-confirm-multi-row.test.ts           A6 — picks latest row, scoped UPDATE
tests/integration/consent-enforcement.test.ts        A3 — gated routes return 403 without consent
```

### Modified files (Bucket A — bugs)

```
app/api/chat/route.ts                                A1 + A3
app/api/cv/upload/route.ts                           A3
app/api/cv/confirm/route.ts                          A3 + A6
app/api/recommendations/route.ts                     A3 + A7
app/api/plan/generate/route.ts                       A3
app/api/interview/route.ts                           A3
app/api/interview/wrap/route.ts                      A3
components/cv/CvUploadClient.tsx                     A4
components/cv/CvReview.tsx                           A8
components/recommendations/RecommendationsClient.tsx A7
lib/ai/extraction.ts                                 A5
lib/consent.ts                                       A3 — add requireConsent + NoConsentError exports
```

### Modified files (Bucket B — polish + observability)

```
package.json                                         @sentry/nextjs + @axe-core/playwright
next.config.ts                                       Wrap with withSentryConfig
app/(app)/chat/...                                   State audit
app/(app)/cv/...                                     State audit
app/(app)/assessment/...                             State audit
app/(app)/plan/...                                   State audit
components/ui/EmptyState.tsx                         Shared (if reused ≥2 surfaces)
components/ui/LoadingState.tsx                       Shared (if reused ≥2 surfaces)
components/ui/ErrorState.tsx                         Shared (if reused ≥2 surfaces)
lib/i18n/he.ts                                       he.empty.*, he.loading.*, he.error.* additions
CLAUDE.md                                            Phase 6c architecture section
```

---

## Task 1: Install npm dependencies

**Files:**
- Modify: `package.json` (added by npm)
- Modify: `package-lock.json` (added by npm)

- [ ] **Step 1: Install Sentry + axe**

```bash
cd C:\Users\tmott\Desktop\Lai\Lai
npm install --save @sentry/nextjs
npm install --save-dev @axe-core/playwright
```

- [ ] **Step 2: Verify versions installed**

Run: `grep -E "sentry|axe-core" package.json`
Expected: shows both deps with versions

- [ ] **Step 3: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors (Sentry SDK only adds modules, no usage yet)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @sentry/nextjs + @axe-core/playwright

Phase 6c brings forward Sentry (server+edge only) for production
error observability, and axe-core integration into Playwright for
the a11y pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: A1 — Chat-engine regression test + fix

**Files:**
- Create: `tests/unit/ai/engine-message-flow.test.ts`
- Modify: `app/api/chat/route.ts:51-63`

This task fixes the bug where `/api/chat` doesn't send the current user message to Claude. The regression was introduced in commit `9033071` (Phase 6a Task 2) when `streamLlmTurn` was extracted — the chat route still calls `loadMessages` BEFORE the user message is persisted (via `onUserPersist` inside the engine), so `history` snapshot misses the current turn.

- [ ] **Step 1: Write failing regression test**

```ts
// tests/unit/ai/engine-message-flow.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelMessage } from "ai";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, streamText: vi.fn() };
});
vi.mock("@/lib/ai/safety", () => ({ checkUserMessage: vi.fn().mockResolvedValue({ allow: true }) }));
vi.mock("@/lib/ai/client", () => ({
  anthropic: vi.fn(() => "mock-model"),
  MODEL_ID: "claude-test",
  extractAnthropicCacheUsage: vi.fn(() => ({})),
}));

import { streamText } from "ai";
import { streamLlmTurn } from "@/lib/ai/engine";

beforeEach(() => vi.clearAllMocks());

describe("streamLlmTurn — message flow", () => {
  it("uses the exact history the caller provides (engine does not append userText itself)", async () => {
    let captured: { messages?: ModelMessage[] } = {};
    (streamText as ReturnType<typeof vi.fn>).mockImplementation((opts: Record<string, unknown>) => {
      captured = opts as { messages?: ModelMessage[] };
      return { toUIMessageStreamResponse: () => new Response("ok") };
    });

    const historyWithCurrentTurn: ModelMessage[] = [
      { role: "user", content: "earlier user msg" },
      { role: "assistant", content: "earlier assistant reply" },
      { role: "user", content: "CURRENT TURN" }, // ← caller appended
    ];

    await streamLlmTurn({
      userText: "CURRENT TURN",
      systemMessage: { role: "system", content: "test" },
      history: historyWithCurrentTurn,
      contextLabel: "test",
      contextId: "ctx-1",
      onUserPersist: vi.fn(),
      onAssistantFinish: vi.fn(),
    });

    expect(captured.messages).toBeDefined();
    const last = captured.messages![captured.messages!.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toBe("CURRENT TURN");
  });
});
```

- [ ] **Step 2: Run the new test**

Run: `npx vitest run tests/unit/ai/engine-message-flow.test.ts`
Expected: PASS (the engine already passes `history` through verbatim; this test pins that contract so a future engine refactor that auto-appends doesn't regress the interview route).

- [ ] **Step 3: Read current chat route to find exact spot to patch**

```bash
cd C:\Users\tmott\Desktop\Lai\Lai
sed -n '40,75p' app/api/chat/route.ts
```

Expected: see `historyAsModelMessages` followed by `return streamLlmTurn({ ... history: historyAsModelMessages, ... })`.

- [ ] **Step 4: Apply A1 fix — append current user msg to history**

Edit `app/api/chat/route.ts`. Find:

```ts
  const history = await loadMessages(conversation.id);
  const historyAsModelMessages: ModelMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
```

Add immediately after that block (BEFORE the `setCookie` line):

```ts
  // Append the current user turn so the LLM sees it. The engine persists via
  // onUserPersist AFTER loadMessages, so without this, streamText only sees
  // prior history — Claude would answer to stale context.
  const messagesForLlm: ModelMessage[] = userText
    ? [...historyAsModelMessages, { role: "user", content: userText }]
    : historyAsModelMessages;
```

Then change the `streamLlmTurn` call from `history: historyAsModelMessages` to `history: messagesForLlm`.

- [ ] **Step 5: Write integration-flavored unit test for the chat route's call**

```ts
// Add to tests/unit/ai/engine-message-flow.test.ts

describe("chat route — message flow integration shape", () => {
  it("when caller appends current turn pattern, streamText sees the right tail", async () => {
    let captured: { messages?: ModelMessage[] } = {};
    (streamText as ReturnType<typeof vi.fn>).mockImplementation((opts: Record<string, unknown>) => {
      captured = opts as { messages?: ModelMessage[] };
      return { toUIMessageStreamResponse: () => new Response("ok") };
    });

    // Simulate the chat-route construction:
    const priorHistory: ModelMessage[] = [
      { role: "user", content: "msg 1" },
      { role: "assistant", content: "reply 1" },
    ];
    const userText = "msg 2";
    const messagesForLlm: ModelMessage[] = userText
      ? [...priorHistory, { role: "user", content: userText }]
      : priorHistory;

    await streamLlmTurn({
      userText,
      systemMessage: { role: "system", content: "test" },
      history: messagesForLlm,
      contextLabel: "chat",
      contextId: "conv-1",
      onUserPersist: vi.fn(),
      onAssistantFinish: vi.fn(),
    });

    expect(captured.messages).toHaveLength(3);
    expect(captured.messages![2]).toEqual({ role: "user", content: "msg 2" });
  });
});
```

- [ ] **Step 6: Run all chat-related tests + tsc**

Run: `npx vitest run tests/unit/ai && npx tsc --noEmit`
Expected: all pass, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/ai/engine-message-flow.test.ts app/api/chat/route.ts
git commit -m "fix(chat): include current user turn in streamText messages

Regression from Phase 6a commit 9033071. When streamLlmTurn was
extracted, the chat route kept calling loadMessages BEFORE the
engine's onUserPersist, so the freshly-sent user message wasn't
in the messages array given to streamText. Claude answered to
stale context.

Fix: caller appends {role:'user', content:userText} to history
before passing it to streamLlmTurn (same pattern the interview
route already uses).

Adds a regression test that pins the contract so future engine
refactors don't auto-append and break the interview route's
explicit-preamble case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: A2 — REVOKE EXECUTE on SECURITY DEFINER RPCs

**Files:**
- Create: `supabase/migrations/20260517100000_revoke_rpc_execute.sql`

The two existing SECURITY DEFINER functions (`merge_career_profile`, `increment_conversation_counters`) default to `EXECUTE` granted to PUBLIC. Anon clients with the publishable key could call them directly. Service-role callers bypass this anyway (and bypass RLS); revoking from PUBLIC closes the hole.

- [ ] **Step 1: Verify RPC signatures (exact match required by REVOKE syntax)**

```bash
cd C:\Users\tmott\Desktop\Lai\Lai
grep -A 6 "create or replace function" supabase/migrations/20260510141000_counters_rpc.sql supabase/migrations/20260510183000_career_profile.sql | head -20
```

Expected output confirms:
- `merge_career_profile(p_user_id uuid, p_conversation_id uuid, p_stage text, p_data jsonb)`
- `increment_conversation_counters(p_conversation_id uuid, p_input_tokens int, p_output_tokens int)`

- [ ] **Step 2: Check for any additional SECURITY DEFINER functions we might've missed**

```bash
grep -rn "security definer" supabase/migrations/ | head -10
```

Expected: only the two known functions. If additional ones exist, add them to the migration in step 3.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260517100000_revoke_rpc_execute.sql

-- Tighten SECURITY DEFINER function privileges. Anon/authenticated
-- clients (using the publishable key) must NOT be able to call these
-- directly — they bypass RLS by design. Service-role callers
-- (our server code) keep access; everything else is locked out.

-- merge_career_profile: writes to public.career_profile
revoke execute on function public.merge_career_profile(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.merge_career_profile(uuid, uuid, text, jsonb)
  to service_role;

-- increment_conversation_counters: writes token usage onto conversations
revoke execute on function public.increment_conversation_counters(uuid, int, int)
  from public, anon, authenticated;

grant execute on function public.increment_conversation_counters(uuid, int, int)
  to service_role;
```

- [ ] **Step 4: Audit callers before applying — make sure nothing calls these via anon client**

```bash
grep -rn "merge_career_profile\|increment_conversation_counters" --include="*.ts" --include="*.tsx" lib/ app/
```

Expected: only `lib/db/*.ts` (which uses `createServiceClient`) and `lib/ai/*.ts` callers that go through service-role helpers. NO `lib/supabase/server.ts` callers (which would use anon key). If anything looks suspicious, STOP and reroute it through service-role before applying.

- [ ] **Step 5: Apply migration (via Supabase MCP or `npx supabase db push` if CLI is authenticated)**

```bash
# If supabase CLI is linked + authenticated:
npx supabase db push

# Otherwise use the Supabase MCP server's apply_migration tool with the
# SQL contents and name "20260517100000_revoke_rpc_execute".
```

- [ ] **Step 6: Smoke-test that service-role still works**

Run: `npx tsx scripts/e2e-test-chat.ts stage` (requires dev server running)
Expected: stage transition still works (extraction runs successfully → merge_career_profile is callable via service role).

If you don't have a dev server / no ANTHROPIC_API_KEY, skip this step and flag for the controller to verify.

- [ ] **Step 7: Regenerate types (no schema change, but good hygiene)**

```bash
npm run db:types   # or via Supabase MCP if CLI not authed
```

Expected: `lib/db/types.gen.ts` unchanged (this migration touches privileges, not schema).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260517100000_revoke_rpc_execute.sql
git commit -m "fix(security): revoke EXECUTE on SECURITY DEFINER RPCs from public

merge_career_profile and increment_conversation_counters are marked
SECURITY DEFINER so they can write past RLS. Without REVOKE, anon
and authenticated clients (using the publishable key) could call
them directly, mutating any user's career_profile or conversation
counters by user_id.

Service-role callers — our server code — keep access. The publishable
key now hits a 'permission denied for function' on these calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: A3 — `requireConsent` helper + unit tests

**Files:**
- Modify: `lib/consent.ts`
- Create: `tests/unit/consent.test.ts`

The existing `lib/consent.ts` exposes `hasActiveConsent(userId, purpose)` and `recordConsent(...)`. We add a `requireConsent(userId, purposes)` wrapper that throws `NoConsentError` if any required purpose is missing/revoked. API routes catch it and return 403.

- [ ] **Step 1: Read current `lib/consent.ts` so we extend rather than duplicate**

```bash
cat C:\Users\tmott\Desktop\Lai\Lai\lib\consent.ts
```

Expected: exports `hasActiveConsent`, `recordConsent`, `CONSENT_PURPOSES`.

- [ ] **Step 2: Write failing tests**

```ts
// tests/unit/consent.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@/lib/supabase/service";
import { requireConsent, NoConsentError } from "@/lib/consent";

function mockClient(consents: Array<{ purpose: string; revoked_at: string | null }>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            in: () => Promise.resolve({ data: consents, error: null }),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("requireConsent", () => {
  it("resolves when all required purposes have active consent", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient([
        { purpose: "processing", revoked_at: null },
        { purpose: "disclaimer", revoked_at: null },
      ]),
    );
    await expect(requireConsent("user-1", ["processing", "disclaimer"])).resolves.toBeUndefined();
  });

  it("throws NoConsentError when a required purpose is missing", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient([{ purpose: "processing", revoked_at: null }]),
    );
    await expect(requireConsent("user-1", ["processing", "disclaimer"])).rejects.toBeInstanceOf(NoConsentError);
  });

  it("throws NoConsentError when a required purpose was revoked", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient([]),
    );
    await expect(requireConsent("user-1", ["processing"])).rejects.toBeInstanceOf(NoConsentError);
  });

  it("defaults to checking processing + disclaimer when no purposes specified", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient([
        { purpose: "processing", revoked_at: null },
        { purpose: "disclaimer", revoked_at: null },
      ]),
    );
    await expect(requireConsent("user-1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test, expect fail**

Run: `npx vitest run tests/unit/consent.test.ts`
Expected: FAIL (`requireConsent` and `NoConsentError` not exported yet).

- [ ] **Step 4: Implement in `lib/consent.ts` (append, don't replace existing exports)**

Append to `lib/consent.ts`:

```ts
export class NoConsentError extends Error {
  constructor(public missing: string[]) {
    super(`no_consent: missing ${missing.join(", ")}`);
    this.name = "NoConsentError";
  }
}

const DEFAULT_REQUIRED_PURPOSES: ReadonlyArray<ConsentPurpose> = [
  "processing",
  "disclaimer",
] as const;

/**
 * Throws NoConsentError if the user is missing active consent for any
 * required purpose. Resolves silently when all required consents are active.
 *
 * Call this at the top of any API route that mutates user data or sends
 * data to third parties (LLM providers, etc.).
 */
export async function requireConsent(
  userId: string,
  purposes: ReadonlyArray<ConsentPurpose> = DEFAULT_REQUIRED_PURPOSES,
): Promise<void> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("consents")
    .select("purpose, revoked_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .in("purpose", purposes as readonly string[]);
  if (error) throw new Error(`requireConsent: ${error.message}`);

  const have = new Set((data ?? []).map((r) => r.purpose as string));
  const missing = purposes.filter((p) => !have.has(p));
  if (missing.length > 0) throw new NoConsentError(missing);
}
```

Note: the helper uses `createServiceClient`. Confirm `ConsentPurpose` type and `createServiceClient` import are already in `lib/consent.ts` — if not, add `import { createServiceClient } from "@/lib/supabase/service";`.

- [ ] **Step 5: Run tests, expect pass**

Run: `npx vitest run tests/unit/consent.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/consent.ts tests/unit/consent.test.ts
git commit -m "feat(consent): add requireConsent helper for server-side gating

Throws NoConsentError if the user is missing active consent for any
required purpose (default: processing + disclaimer). API routes
catch and return 403.

Built on top of the existing public.consents table; uses the same
service-role query pattern as hasActiveConsent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: A3 — Wire `requireConsent` into gated API routes

**Files:**
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/cv/upload/route.ts`
- Modify: `app/api/cv/confirm/route.ts`
- Modify: `app/api/recommendations/route.ts`
- Modify: `app/api/plan/generate/route.ts`
- Modify: `app/api/interview/route.ts`
- Modify: `app/api/interview/wrap/route.ts`
- Create: `tests/integration/consent-enforcement.test.ts`

- [ ] **Step 1: Write integration test that asserts each gated route returns 403 without consent**

```ts
// tests/integration/consent-enforcement.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/consent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/consent")>("@/lib/consent");
  return {
    ...actual,
    requireConsent: vi.fn(async () => {
      throw new actual.NoConsentError(["processing"]);
    }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })),
}));
vi.mock("@/lib/anonymous", () => ({
  getOrCreateAnonymousUserId: vi.fn(async () => "test-user-id"),
}));

beforeEach(() => vi.clearAllMocks());

const ROUTES_AND_BODIES = [
  { path: "@/app/api/chat/route", body: { messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] } },
  { path: "@/app/api/recommendations/route", body: {} },
  { path: "@/app/api/plan/generate/route", body: { recommendationId: "00000000-0000-0000-0000-000000000000" } },
  { path: "@/app/api/interview/route", body: { action: "start", persona: "hr", target_role_he: "מהנדס/ת" } },
  { path: "@/app/api/interview/wrap/route", body: { sessionId: "00000000-0000-0000-0000-000000000000" } },
];

describe("consent enforcement on gated routes", () => {
  for (const { path, body } of ROUTES_AND_BODIES) {
    it(`${path} returns 403 when consent is missing`, async () => {
      const mod = await import(path);
      const handler = mod.POST as (req: Request) => Promise<Response>;
      const req = new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const res = await handler(req);
      expect(res.status).toBe(403);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toBe("no_consent");
    });
  }
});
```

Note: this test imports each route module. If a route uses Next.js–specific imports that fail under vitest's environment (e.g., `cookies()` from `next/headers`), mock them at the top of the test file (`vi.mock("next/headers", () => ({ cookies: vi.fn(...) }))`). Add mocks as needed when running step 2.

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run tests/integration/consent-enforcement.test.ts`
Expected: FAIL — routes don't call requireConsent yet.

- [ ] **Step 3: Add consent gate to each route**

For each gated route, add at the top of `POST` (just after `getOrCreateAnonymousUserId` resolves `userId`):

```ts
import { requireConsent, NoConsentError } from "@/lib/consent";

// ... inside POST, after userId is resolved:
try {
  await requireConsent(userId);
} catch (e) {
  if (e instanceof NoConsentError) {
    return Response.json({ error: "no_consent" }, { status: 403 });
  }
  throw e;
}
```

Apply this pattern to all 7 routes listed above. Each edit is the same shape; only the location-after-userId-resolution differs.

For `app/api/interview/route.ts`: place the check AFTER the BodySchema parse and BEFORE the `start` branch. (Don't require consent for body-shape errors — those still return 400.)

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: integration test passes; existing tests still pass.

- [ ] **Step 5: Manually verify the consent flow still works end-to-end**

If dev server running: open `localhost:3000/chat` in a fresh incognito tab. The consent modal should appear (no consent yet). Accept it. Send a chat message. Verify the message goes through (consent now present → requireConsent passes).

If no dev server, skip this step — the integration test covers correctness.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/route.ts app/api/cv/upload/route.ts app/api/cv/confirm/route.ts app/api/recommendations/route.ts app/api/plan/generate/route.ts app/api/interview/route.ts app/api/interview/wrap/route.ts tests/integration/consent-enforcement.test.ts
git commit -m "fix(consent): enforce consent server-side on gated API routes

Adds requireConsent(userId) at the top of every mutation route:
chat, cv upload, cv confirm, recommendations, plan generate,
interview start/turn, interview wrap. Missing consent => 403
{error: 'no_consent'}.

Client-side modal still enforces UX; server now enforces correctness.
Even a forged direct API call from a no-consent user bounces.

Integration test asserts every gated route returns 403 when
requireConsent throws NoConsentError.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: A4 — CV upload race fix (`cv_upload_id` non-empty before submit)

**Files:**
- Modify: `components/cv/CvUploadClient.tsx:60-120`

The component sets `reviewData.cvUploadId` from the upload response, then submit reads it. If the user races (clicks submit while the upload is still in-flight), `reviewData.cvUploadId` is undefined and the subsequent confirm call sends an empty UUID.

- [ ] **Step 1: Read current `CvUploadClient.tsx` upload + submit flow**

```bash
sed -n '50,130p' "C:\Users\tmott\Desktop\Lai\Lai\components\cv\CvUploadClient.tsx"
```

Identify:
- Where the upload promise resolves and `setReviewData(...)` is called
- The submit button's `onClick` handler
- The `disabled` predicate on the submit button

- [ ] **Step 2: Apply the fix**

Make the submit button's `disabled` predicate include `!reviewData?.cvUploadId`. Move the `setReviewData` call into the awaited `.then()` of the upload promise so it's guaranteed-set before the user can click submit.

Concretely, find:

```tsx
// Pseudocode of the current shape — actual lines vary
const handleUpload = async (file: File) => {
  setUploading(true);
  const res = await fetch("/api/cv/upload", { ... });
  const data = await res.json();
  // Race window starts here — reviewData is updated but if user already
  // clicked submit, submit() may have read undefined.
  setReviewData({ cvUploadId: data.id, ... });
  setUploading(false);
};
```

Replace with:

```tsx
const handleUpload = async (file: File) => {
  setUploading(true);
  try {
    const res = await fetch("/api/cv/upload", { ... });
    const data = (await res.json()) as { id: string; /* ... */ };
    if (!data?.id) throw new Error("upload returned no id");
    setReviewData({ cvUploadId: data.id, ... });
  } finally {
    setUploading(false);
  }
};
```

Update the submit button:

```tsx
<Button
  onClick={submit}
  disabled={saving || !reviewData?.cvUploadId}
>
```

If `submit()` itself reads `reviewData?.cvUploadId`, ALSO guard inside `submit`:

```tsx
const submit = async (skillIds: string[]) => {
  if (!reviewData?.cvUploadId) return; // defensive: button disabled prevents this, guard prevents accidents
  // ... existing body
};
```

- [ ] **Step 3: Manual sanity check via Playwright smoke test**

```bash
node scripts/verify-interview-ui.mjs    # adapt if needed; ensures dev server is up
# Then manually: open /cv, upload a file, immediately try to click submit while uploading.
# Expected: submit is disabled until upload resolves.
```

If automating: add to `scripts/verify-cv-ui.mjs` (similar to `verify-interview-ui.mjs`) and assert the submit button is `disabled` when in the uploading state.

- [ ] **Step 4: tsc clean**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/cv/CvUploadClient.tsx
git commit -m "fix(cv): disable submit until cv_upload_id is set

Race window: setReviewData was called after the upload resolved,
but the submit button stayed enabled meanwhile. A fast click could
fire confirm() with an undefined cv_upload_id, sending an empty
UUID to /api/cv/confirm.

Fix: submit button disabled while !reviewData?.cvUploadId. Defensive
guard inside submit() too.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: A5 — Chat extraction shape alignment

**Files:**
- Modify: `lib/ai/extraction.ts`
- Modify: `lib/matching/profile.ts` (if matcher needs to accept transitional shapes)
- Create: `tests/unit/ai/extraction-shape.test.ts`

The extraction zod schema emits values as objects (`{key, label_he}`) and constraint fields named differently from what the matcher consumes (`risk_tolerance_1_10` vs `risk_tolerance`, `native` vs `fluent`, etc.). The matcher is the canonical consumer of profile data; align extraction to its shape.

- [ ] **Step 1: Read both shapes side by side**

```bash
cd C:\Users\tmott\Desktop\Lai\Lai
sed -n '20,80p' lib/ai/extraction.ts
echo ===
sed -n '40,100p' lib/matching/profile.ts
echo ===
sed -n '1,30p' lib/matching/score/values.ts
```

Catalog the divergences. Expected categories:
- **Values**: extraction emits `[{key, label_he}]`; matcher expects `{topThree: string[], alsoPicked: string[]}`.
- **Constraints**: field names differ. Specifically check `risk_tolerance` (extraction may have `risk_tolerance_1_10`), English level (`native` vs `fluent`).

- [ ] **Step 2: Write failing tests**

```ts
// tests/unit/ai/extraction-shape.test.ts
import { describe, it, expect } from "vitest";
import { ProfileSchema } from "@/lib/ai/extraction";
import { buildMatchingProfile } from "@/lib/matching/profile";

describe("extraction → matching profile shape compatibility", () => {
  it("values emitted by extraction parse into matcher's values shape", () => {
    const extracted = ProfileSchema.parse({
      values: {
        topThree: ["meaning", "autonomy", "stability"],
        alsoPicked: ["learning", "team"],
      },
    });
    const profile = buildMatchingProfile(extracted);
    expect(profile.values).toEqual({
      topThree: ["meaning", "autonomy", "stability"],
      alsoPicked: ["learning", "team"],
    });
  });

  it("constraint risk_tolerance is a single number 1..10", () => {
    const extracted = ProfileSchema.parse({
      constraints: {
        risk_tolerance: 7,
        english_level: "fluent",
      },
    });
    expect(extracted.constraints?.risk_tolerance).toBe(7);
    expect(extracted.constraints?.english_level).toBe("fluent");
  });

  it("english_level uses the matcher's enum ('none'|'basic'|'intermediate'|'advanced'|'fluent')", () => {
    const result = ProfileSchema.safeParse({
      constraints: { english_level: "native" }, // wrong — should fail
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run, expect fail**

Run: `npx vitest run tests/unit/ai/extraction-shape.test.ts`
Expected: FAIL — current schema doesn't accept these shapes (or accepts the WRONG ones).

- [ ] **Step 4: Patch `lib/ai/extraction.ts`**

In `ProfileSchema` (and any nested zod that produces values/constraints):

**Values:** Change to:

```ts
values: z.object({
  topThree: z.array(z.string()).max(3),
  alsoPicked: z.array(z.string()).max(7),
}).optional(),
```

(The LLM is now instructed to emit string keys from the values vocabulary, not object envelopes. Update the prompt in `lib/ai/prompts/stages/values.ts` to match — instruct it to emit the canonical key strings.)

**Constraints:** Match `MatchingProfile.constraints` exactly:

```ts
constraints: z.object({
  location_he: z.string().optional(),
  remote_ok: z.boolean().optional(),
  time_per_week_hours: z.number().min(0).max(60).optional(),
  training_budget_nis: z.number().min(0).max(200_000).optional(),
  english_level: z.enum(["none","basic","intermediate","advanced","fluent"]).optional(),
  risk_tolerance: z.number().int().min(1).max(10).optional(),
  needs_immediate_income: z.boolean().optional(),
  months_until_income_required: z.number().int().min(0).max(36).optional(),
}).optional(),
```

- [ ] **Step 5: Update the constraints stage prompt to instruct the LLM accordingly**

Find `lib/ai/prompts/stages/constraints.ts` (or wherever the constraints extraction prompt lives). Add a line specifying:
- `english_level` enum is exactly: `none | basic | intermediate | advanced | fluent` — NEVER `native`.
- `risk_tolerance` is integer 1-10 (lower=more risk-averse, higher=more risk-tolerant).

- [ ] **Step 6: Run tests, expect pass**

Run: `npx vitest run tests/unit/ai/extraction-shape.test.ts && npx tsc --noEmit`
Expected: tests pass, tsc clean.

- [ ] **Step 7: Run full test suite to catch any regressions**

Run: `npx vitest run`
Expected: all green (the matcher's existing values tests should now pass on extracted data).

- [ ] **Step 8: Commit**

```bash
git add lib/ai/extraction.ts lib/ai/prompts/stages/values.ts lib/ai/prompts/stages/constraints.ts tests/unit/ai/extraction-shape.test.ts
git commit -m "fix(extraction): align chat-extracted values + constraints with matcher

Extraction was emitting {key, label_he} value objects and the wrong
constraint field names (risk_tolerance_1_10, english_level: 'native')
that the deterministic matcher in lib/matching/* couldn't consume.

Align extraction zod to MatchingProfile shape:
- values: { topThree: string[], alsoPicked: string[] } with raw keys
- constraints: matcher's exact field names and english_level enum
  (none|basic|intermediate|advanced|fluent — never 'native')

Updated the values + constraints stage prompts to instruct the LLM
accordingly. Regression test pins the shape contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: A6 — CV confirm: latest-row read + scoped UPDATE

**Files:**
- Modify: `app/api/cv/confirm/route.ts:90-130`
- Create: `tests/unit/db/cv-confirm-multi-row.test.ts`

The current code reads ONE career_profile row by user_id but UPDATEs by user_id (all rows). For users with multiple career_profile rows (one per conversation_id), this corrupts data.

- [ ] **Step 1: Write failing test (mock the supabase service client)**

```ts
// tests/unit/db/cv-confirm-multi-row.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@/lib/supabase/service";

let capturedUpdate: { table?: string; values?: unknown; whereId?: string } = {};

function mockClient(rows: Array<{ id: string; data: unknown; updated_at: string }>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
            }),
          }),
        }),
      }),
      update: (values: unknown) => ({
        eq: (col: string, val: string) => {
          if (col === "id") {
            capturedUpdate = { table, values, whereId: val };
          }
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdate = {};
});

describe("cv confirm: multi-row update scoping", () => {
  it("picks the latest career_profile row and updates by its id", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient([
        { id: "row-LATEST", data: { skills: [] }, updated_at: "2026-05-17T00:00:00Z" },
      ]),
    );

    // Call the helper we're about to extract — see Step 4
    const { mergeCvSkillsIntoLatestProfile } = await import("@/app/api/cv/confirm/route");
    await mergeCvSkillsIntoLatestProfile("user-1", [
      { id: "python", name_he: "Python", source: "cv" },
    ]);

    expect(capturedUpdate.table).toBe("career_profile");
    expect(capturedUpdate.whereId).toBe("row-LATEST");
    expect((capturedUpdate.values as { data: { skills: unknown[] } }).data.skills).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run tests/unit/db/cv-confirm-multi-row.test.ts`
Expected: FAIL — current code likely doesn't export `mergeCvSkillsIntoLatestProfile`, AND the SELECT lacks ordering.

- [ ] **Step 3: Read current route to find exact lines**

```bash
sed -n '85,135p' "C:\Users\tmott\Desktop\Lai\Lai\app\api\cv\confirm\route.ts"
```

Locate the SELECT-and-UPDATE pair flagged in the review.

- [ ] **Step 4: Refactor — extract helper, fix scoping**

In `app/api/cv/confirm/route.ts`, find the existing inline read/update of `career_profile` and replace with a call to a new exported helper:

```ts
// Add near top of route, alongside other helpers
export async function mergeCvSkillsIntoLatestProfile(
  userId: string,
  skills: Array<{ id: string; name_he: string; source: "cv" }>,
): Promise<void> {
  const svc = createServiceClient();
  const { data: profile, error: readErr } = await svc
    .from("career_profile")
    .select("id, data")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readErr) throw new Error(`mergeCvSkillsIntoLatestProfile read: ${readErr.message}`);
  if (!profile) {
    // No profile yet — create one. The conversation_id is unknown here so leave it null.
    const { error: insErr } = await svc.from("career_profile").insert({
      user_id: userId,
      data: { skills, skills_from_chat: [] },
    });
    if (insErr) throw new Error(`mergeCvSkillsIntoLatestProfile insert: ${insErr.message}`);
    return;
  }

  const existing = (profile.data ?? {}) as { skills?: unknown[]; skills_from_chat?: unknown[] };
  // First-CV-confirm rule (from CLAUDE.md Phase 3b architecture):
  // if data.skills_from_chat is unset and data.skills has entries, archive them
  // to skills_from_chat before replacing with the CV skills.
  const archive =
    existing.skills_from_chat === undefined && Array.isArray(existing.skills) && existing.skills.length > 0
      ? existing.skills
      : (existing.skills_from_chat ?? []);

  const mergedData = {
    ...existing,
    skills,
    skills_from_chat: archive,
  };

  const { error: updErr } = await svc
    .from("career_profile")
    .update({ data: mergedData })
    .eq("id", profile.id); // ← scoped to THIS row, not all user rows
  if (updErr) throw new Error(`mergeCvSkillsIntoLatestProfile update: ${updErr.message}`);
}
```

Replace the inline read/update in the route's POST handler with `await mergeCvSkillsIntoLatestProfile(userId, skills);`.

- [ ] **Step 5: Run tests, expect pass**

Run: `npx vitest run tests/unit/db/cv-confirm-multi-row.test.ts && npx tsc --noEmit`
Expected: PASS + tsc clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/cv/confirm/route.ts tests/unit/db/cv-confirm-multi-row.test.ts
git commit -m "fix(cv): scope profile UPDATE to a single row, not all user rows

CV confirm read one career_profile row by user_id but UPDATEd by
user_id (every row for that user). With multiple rows (one per
conversation_id) this overwrites every profile.

Fix: order by updated_at desc, limit 1, scope UPDATE to that row's
id. Extracted into mergeCvSkillsIntoLatestProfile helper for testability.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: A7 — Recommendations regenerate bypasses server cache

**Files:**
- Modify: `app/api/recommendations/route.ts:25-45`
- Modify: `components/recommendations/RecommendationsClient.tsx:40-50`

- [ ] **Step 1: Read current behavior**

```bash
sed -n '20,50p' "C:\Users\tmott\Desktop\Lai\Lai\app\api\recommendations\route.ts"
sed -n '35,55p' "C:\Users\tmott\Desktop\Lai\Lai\components\recommendations\RecommendationsClient.tsx"
```

Confirm: route always calls `getCached(...)`; client sends `cache: "no-store"` (HTTP cache only, doesn't reach server cache).

- [ ] **Step 2: Patch server route to accept `force`**

In `app/api/recommendations/route.ts`, replace the unconditional `getCached` call:

```ts
// Before:
const cached = await getCached(internalUserId, hash);
if (cached) {
  return Response.json({ ... cached, cached: true, generated_at: cached.generatedAt });
}

// After:
let body: { force?: boolean } = {};
try {
  // POST body may be empty — handle gracefully
  if (request.headers.get("content-type")?.includes("application/json")) {
    body = (await request.json().catch(() => ({}))) as { force?: boolean };
  }
} catch { /* ignore body parse failures */ }

const force = body.force === true;

if (!force) {
  const cached = await getCached(internalUserId, hash);
  if (cached) {
    return Response.json({ ...cached, cached: true, generated_at: cached.generatedAt });
  }
}
// ... compute fresh path continues unchanged
```

- [ ] **Step 3: Patch client to send `force: true` on regenerate**

In `components/recommendations/RecommendationsClient.tsx`, find the regenerate handler:

```tsx
// Before:
const res = await fetch("/api/recommendations", {
  method: "POST",
  cache: "no-store",
});

// After:
const res = await fetch("/api/recommendations", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ force: true }),
  cache: "no-store", // safe to keep; HTTP cache is unrelated to server-side cache
});
```

- [ ] **Step 4: tsc + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/recommendations/route.ts components/recommendations/RecommendationsClient.tsx
git commit -m "fix(recommendations): regenerate bypasses server cache via force=true

Client was sending cache: 'no-store' but that only affects HTTP
cache. The route's getCached(userId, profileHash) hit independently
and returned the cached row anyway, so 'regenerate' never recomputed.

Server now reads { force?: boolean } from the body; force=true skips
getCached. Client sends force:true in the regenerate button's body.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: A8 — Flatten nested `<button>` in CvReview

**Files:**
- Modify: `components/cv/CvReview.tsx:354-385`

- [ ] **Step 1: Read current SkillCard component**

```bash
sed -n '350,400p' "C:\Users\tmott\Desktop\Lai\Lai\components\cv\CvReview.tsx"
```

Confirm: outer `<button onClick={onToggleExpand}>` wraps an inner `<button onClick={onDismiss}>`. Invalid HTML.

- [ ] **Step 2: Refactor to flat siblings**

Replace the `SkillCard` JSX:

```tsx
function SkillCard({
  skill,
  expanded,
  onToggleExpand,
  onDismiss,
}: {
  skill: ReviewSkill;
  expanded: boolean;
  onToggleExpand: () => void;
  onDismiss: () => void;
}) {
  const isHigh = skill.confidence >= 0.8;
  const isMid = skill.confidence >= 0.5 && skill.confidence < 0.8;
  const dotColor = isHigh
    ? "bg-emerald-500"
    : isMid
      ? "bg-amber-500"
      : "bg-muted-foreground/50";

  return (
    <div className="group rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
        >
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`} aria-hidden />
            <span className="truncate text-base font-semibold">{skill.name_he}</span>
          </div>
          {!skill.isOther && (
            <span className={`mt-1 inline-block text-xs ${CATEGORY_TEXT_COLORS[skill.category] ?? "text-muted-foreground"}`}>
              {he.cv.review.categories[skill.category as keyof typeof he.cv.review.categories] ?? skill.category}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={he.cv.review.dismiss}
          className="text-muted-foreground transition-opacity hover:text-destructive group-hover:opacity-100 sm:opacity-0"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {expanded && skill.evidence && (
        <div className="mt-3 rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed">
          <span className="font-medium text-muted-foreground">{he.cv.review.evidenceLabel}</span>{" "}
          <span dir="auto">{skill.evidence}</span>
        </div>
      )}
    </div>
  );
}
```

Key change: outer wrapper is now a `<div>`. Toggle button + dismiss button are siblings. Click handlers no longer bubble between them; aria-expanded is on the toggle button only.

- [ ] **Step 3: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/cv/CvReview.tsx
git commit -m "fix(cv): flatten nested <button> in SkillCard

Outer <button onClick={toggleExpand}> wrapped an inner
<button onClick={dismiss}> — invalid HTML. Browsers flatten the DOM
silently and click bubbling becomes unreliable.

Refactored to flat <div> with two sibling buttons. Toggle keeps
aria-expanded; dismiss has aria-label. Same visual layout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Sentry config files + instrumentation

**Files:**
- Create: `sentry.server.config.ts`
- Create: `sentry.edge.config.ts`
- Create: `instrumentation.ts`
- Modify: `next.config.ts`

- [ ] **Step 1: Read current `next.config.ts`**

```bash
cat C:\Users\tmott\Desktop\Lai\Lai\next.config.ts
```

Note the existing config shape — we'll wrap it with `withSentryConfig`.

- [ ] **Step 2: Write `sentry.server.config.ts`**

```ts
// sentry.server.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  environment: process.env.VERCEL_ENV ?? "development",
  release: process.env.VERCEL_GIT_COMMIT_SHA,

  // Minimal observability for pre-launch
  tracesSampleRate: 0,
  profilesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // PII scrubbing — Hebrew chat content is sensitive
  sendDefaultPii: false,

  beforeSend(event) {
    // Drop request bodies entirely (they may contain user message text)
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.headers;
    }
    // Drop any user fingerprint that snuck in
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
    }
    // Drop breadcrumbs marked as user-content
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
    "AbortError",
  ],
});
```

- [ ] **Step 3: Write `sentry.edge.config.ts` (same shape, edge runtime)**

```ts
// sentry.edge.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  environment: process.env.VERCEL_ENV ?? "development",
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.headers;
    }
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
    }
    return event;
  },
  ignoreErrors: ["NEXT_NOT_FOUND", "NEXT_REDIRECT", "AbortError"],
});
```

- [ ] **Step 4: Write `instrumentation.ts`**

```ts
// instrumentation.ts
import * as Sentry from "@sentry/nextjs";

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

- [ ] **Step 5: Wrap `next.config.ts` with `withSentryConfig`**

Modify `next.config.ts`. At the bottom, change `export default nextConfig` (or similar) to:

```ts
import { withSentryConfig } from "@sentry/nextjs";
// ... existing config setup
const nextConfig: NextConfig = { /* existing */ };

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN, // build-time only
  silent: !process.env.CI,
  widenClientFileUpload: false, // we have no client SDK
  hideSourceMaps: true,
  disableLogger: true,
});
```

- [ ] **Step 6: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean. Build may warn about missing Sentry env vars in dev (DSN, AUTH_TOKEN, ORG, PROJECT) — those land via Vercel env, not committed.

- [ ] **Step 7: Commit**

```bash
git add sentry.server.config.ts sentry.edge.config.ts instrumentation.ts next.config.ts
git commit -m "feat(sentry): server + edge runtime configs + instrumentation

Minimal pre-launch observability:
- Server + edge runtimes only (no client SDK)
- tracesSampleRate: 0 (no performance until baseline exists)
- sendDefaultPii: false + strict beforeSend scrubber (drops request
  bodies entirely so user message text never leaves)
- Source maps via withSentryConfig at build time

Env vars (set in Vercel project):
- SENTRY_DSN (required)
- SENTRY_ORG, SENTRY_PROJECT (for source map upload)
- SENTRY_AUTH_TOKEN (build-time only)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Wire Sentry capture into API route error paths

**Files:**
- Modify: `app/api/chat/route.ts` (catch + Sentry.captureException)
- Modify: `app/api/interview/route.ts` (same)
- Modify: `lib/ai/engine.ts` (engine's onError → captureException)

The engine's `onError` already logs to console. Have it also call `Sentry.captureException`. Add a top-level try/catch in each API route to capture unexpected errors with breadcrumbs (conversation_id, stage, etc.) — those breadcrumbs ARE allowed to land in Sentry; only request bodies are scrubbed.

- [ ] **Step 1: Patch `lib/ai/engine.ts` onError**

Find the `onError` block in `streamLlmTurn` (currently `console.error(...)`). Add Sentry capture:

```ts
import * as Sentry from "@sentry/nextjs";

// ... inside streamText:
onError: async ({ error }) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[${contextLabel}] streamText error id=${contextId} error=${message}`,
  );
  Sentry.captureException(error, {
    tags: { context: contextLabel },
    extra: { contextId },
  });
  if (onError) {
    await onError(error).catch((secondary) =>
      console.error(`[${contextLabel}] onError callback threw id=${contextId}`, secondary),
    );
  }
},
```

- [ ] **Step 2: Patch chat + interview routes with top-level error capture**

For each API route handler, wrap the body in a try/catch that captures + rethrows so Next.js still produces the 500 response:

```ts
// At the top of POST:
import * as Sentry from "@sentry/nextjs";

export async function POST(req: Request) {
  return Sentry.withScope(async (scope) => {
    // Existing handler body goes here. Set scope tags as known
    // identifiers become available, e.g. inside the start branch:
    //   scope.setTag("interview.persona", body.persona);
    //   scope.setExtra("interview.sessionId", session.id);
  });
}
```

Or simpler — let Sentry's auto-instrumentation handle uncaught errors via `onRequestError`, and only add explicit `captureException` for cases where we handle the error ourselves but still want telemetry.

**Recommended scope: only patch the engine's onError this task.** Routes already log + return 500; Sentry's `onRequestError` in `instrumentation.ts` catches them.

So Step 2 reduces to: VERIFY that `onRequestError` is exported from `instrumentation.ts` (it is, per Task 11 Step 4).

- [ ] **Step 3: Add a deliberate test endpoint for the smoke check**

Create `app/api/__sentry-test/route.ts` (not committed in prod):

```ts
export async function GET() {
  throw new Error("Sentry test from /__sentry-test");
}
```

Mark it gitignored or behind an env-var guard so it doesn't ship to prod accidentally. (Easier: don't commit it — it's a one-time smoke check.)

- [ ] **Step 4: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/engine.ts
git commit -m "feat(sentry): capture streamText errors via engine onError

When streamText errors, the engine now calls Sentry.captureException
with context tag (chat/interview/etc) and contextId extra. The
existing console.error is kept for dev visibility.

Routes themselves don't need explicit capture — Next.js 16's
onRequestError (wired in instrumentation.ts) catches uncaught
exceptions automatically.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Generalize Playwright smoke test for all surfaces

**Files:**
- Create: `scripts/verify-all-surfaces.mjs`
- Modify: `scripts/verify-interview-ui.mjs` (extract its core into shared helpers, optional)

- [ ] **Step 1: Write the multi-surface multi-viewport script**

```js
// scripts/verify-all-surfaces.mjs
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

const SURFACES = [
  { path: "/", name: "marketing" },
  { path: "/chat", name: "chat" },
  { path: "/cv", name: "cv" },
  { path: "/assessment", name: "assessment-hub" },
  { path: "/assessment/riasec", name: "assessment-riasec" },
  { path: "/assessment/big5", name: "assessment-big5" },
  { path: "/assessment/values", name: "assessment-values" },
  { path: "/assessment/constraints", name: "assessment-constraints" },
  { path: "/recommendations", name: "recommendations" },
  { path: "/plan", name: "plan" },
  { path: "/interview", name: "interview" },
  { path: "/sign-in", name: "sign-in" },
  { path: "/privacy", name: "privacy" },
  { path: "/terms", name: "terms" },
];

const browser = await chromium.launch({ headless: true });
const results = [];

for (const viewport of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: "he-IL",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push({ kind: "pageerror", msg: e.message }));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ kind: "console.error", msg: m.text() });
  });

  for (const surface of SURFACES) {
    const url = `${BASE}${surface.path}`;
    const result = { viewport: viewport.name, surface: surface.name, url };
    try {
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      result.status = response?.status() ?? null;
      result.errorsBefore = errors.length;
      await page.screenshot({
        path: `./screenshots/${viewport.name}-${surface.name}.png`,
        fullPage: false,
      });

      // axe-core a11y scan
      const axeResults = await new AxeBuilder({ page })
        .options({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } })
        .analyze();
      result.violations = axeResults.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
      }));
      result.errors = errors.slice(result.errorsBefore);
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
    results.push(result);
    console.log(`[${viewport.name}] ${surface.name}: HTTP ${result.status ?? "ERR"} · ${result.violations?.length ?? 0} a11y violations · ${result.errors?.length ?? 0} console errors`);
  }
  await ctx.close();
}

await browser.close();

// Write JSON report
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("./screenshots", { recursive: true });
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
```

- [ ] **Step 2: Add screenshots dir to gitignore**

Modify `.gitignore`:

```bash
echo -e "\n# Playwright smoke-test artifacts\n/screenshots/" >> "C:\Users\tmott\Desktop\Lai\Lai\.gitignore"
```

- [ ] **Step 3: Run it against the dev server (with consent pre-granted for the test user)**

Run: `node scripts/verify-all-surfaces.mjs` (dev server must be up on :3000)
Expected: 14 surfaces × 3 viewports = 42 combinations. Most clean. Some a11y violations expected → catalog them for Task 20.

- [ ] **Step 4: Commit (script + gitignore, NOT the screenshots)**

```bash
git add scripts/verify-all-surfaces.mjs .gitignore
git commit -m "test(verify): all-surfaces playwright sweep with axe-core

Single script: 14 surfaces × 3 viewports (375/768/1280), captures
screenshots + console errors + axe-core a11y report per combination.
Writes a JSON report and exits non-zero on critical/serious
violations or pageerror/console.error.

Reusable foundation for state audit (Task 14-17), mobile QA (Task 19),
and a11y pass (Task 20). Same shape as the Phase 6a smoke test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: State audit — `/chat`

**Files:**
- Modify: `app/(app)/chat/page.tsx` and chat components
- Possibly create: `components/ui/LoadingState.tsx`, `components/ui/ErrorState.tsx` (if shared with other tasks)

Catalog and fix `/chat`'s three states.

- [ ] **Step 1: Open `/chat` empty + load history + force an error; screenshot each**

Run: `node scripts/verify-all-surfaces.mjs` (dev server running, fresh `co_anon` cookie). Visit `/chat` in a real browser. Observe:
- Empty: "בוא נתחיל להכיר" exists ✅
- Loading: when navigating to /chat with existing history, is there a skeleton/spinner while messages load? Inspect.
- Error: trigger a network failure (DevTools "Offline") and send a message. Does anything tell the user?

- [ ] **Step 2: Catalog gaps**

For each state, write down what exists and what's missing. Add to a temporary note (delete after task).

- [ ] **Step 3: Add missing states**

If loading state missing: add a skeleton in `components/chat/ChatHistory.tsx` (or wherever messages render). If error state missing: catch fetch errors in the send handler and render `<ErrorState onRetry={...} message={he.chat.error.streamFailed} />`.

Decision rule: if 2+ surfaces would benefit from the SAME shared shell, create `components/ui/{Loading,Empty,Error}State.tsx`. If only chat needs it, inline it.

- [ ] **Step 4: Re-run smoke test, verify**

Run: `node scripts/verify-all-surfaces.mjs`
Expected: `/chat` clean across viewports (no new console errors).

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/chat components/chat lib/i18n/he.ts
git commit -m "feat(chat): add missing loading + error states

Empty state already existed. Loading: skeleton while messages fetch
on revisit. Error: retry toast with i18n message when streamText
fails or network drops.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: State audit — `/cv`

**Files:**
- Modify: `app/(app)/cv/page.tsx` + cv components

Same pattern as Task 14, applied to `/cv`.

- [ ] **Step 1: Catalog states**

Visit `/cv` in browser. States:
- Empty: drop zone is the empty state ✅
- Loading: during parsing/extracting, is there a clear indicator?
- Error: parse-failed (corrupt PDF, unsupported MIME) — does the user see a helpful message?

- [ ] **Step 2: Add missing states**

Likely missing: parse-failed error UI. Catch the `/api/cv/upload` 400 errors (unsupported_mime, file_too_large) in `CvUploadClient` and render the message via `he.cv.error.*`.

- [ ] **Step 3: Smoke test**

Run: `node scripts/verify-all-surfaces.mjs`

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/cv components/cv lib/i18n/he.ts
git commit -m "feat(cv): parse-failed error UI + loading clarity

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: State audit — `/assessment` hub + 4 children

**Files:**
- Modify: `app/(app)/assessment/page.tsx` + 4 sub-pages + their components

- [ ] **Step 1: Catalog states for each of: hub, riasec, big5, values, constraints**

For each:
- Empty: "טרם התחלת" status on hub ✅
- Loading: submission-in-flight indicator on each assessment's "Submit" button
- Error: submission-failed retry path

- [ ] **Step 2: Add missing states**

Submit button: show "שומר…" (`he.assessment.common.submitting`) while in-flight; on failure, show inline error + leave form intact so user can retry.

- [ ] **Step 3: Smoke test**

Run: `node scripts/verify-all-surfaces.mjs`

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/assessment lib/i18n/he.ts
git commit -m "feat(assessment): submission loading + error states across all 4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: State audit — `/plan`

**Files:**
- Modify: `app/(app)/plan/page.tsx` + plan components

- [ ] **Step 1: Catalog states**

Visit `/plan`:
- Empty: "צור תוכנית 30 יום" CTA ✅
- Loading: while generating (this is a ~30s LLM call) — clear indicator?
- Error: generation-failed retry

- [ ] **Step 2: Add missing states + commit**

```bash
git add app/\(app\)/plan components/plan lib/i18n/he.ts
git commit -m "feat(plan): generation loading indicator + error retry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Verify existing states on `/recommendations` and `/interview`

These two surfaces already have good states (verified in Phase 6a). This task is verification-only — if anything's actually missing, file a follow-up task; don't add to scope.

- [ ] **Step 1: Walk both surfaces in browser; confirm states**

`/recommendations`: empty (`emptyProfile`), loading ("..."), error (`error.generic`), cached note.
`/interview`: empty (history-empty), loading (sentinel-start question stream), error (`streamFailed`).
`/interview/[sessionId]`: completed state (WrapUpScreen), in-progress (live chat), forced-wrap banner.

- [ ] **Step 2: If gaps found, add them; otherwise skip the commit**

If everything is fine, the next task continues; if you found something, commit it under the appropriate Bucket B task.

---

## Task 19: Mobile QA pass

**Files:**
- Modify: any component with layout breaks at 375 or 768

- [ ] **Step 1: Run smoke test, capture screenshots**

Run: `node scripts/verify-all-surfaces.mjs`
Output: `screenshots/mobile-*.png`, `screenshots/tablet-*.png`, `screenshots/desktop-*.png`.

- [ ] **Step 2: Visually scan all 42 screenshots**

Look for: clipped buttons, overflowing Hebrew text, broken grids, misaligned RTL elements, touch targets too close together.

- [ ] **Step 3: Fix what's broken — one fix per commit**

For each layout break, edit the offending component, re-run smoke test, commit with a message like `fix(mobile): <surface> <issue>`. Don't preemptively rewrite layouts that look fine.

Common patterns to apply:
- `sm:flex-row` instead of `flex-row` for wide layouts
- `max-w-3xl` → `max-w-full sm:max-w-3xl`
- Sticky bottoms get bumped above 0 on iOS notch (use `pb-safe` or fixed padding)

- [ ] **Step 4: Re-run smoke test, expect zero layout breaks**

Run: `node scripts/verify-all-surfaces.mjs`
Expected: all screenshots clean.

---

## Task 20: a11y axe pass — fix critical + serious

**Files:**
- Modify: components that axe flags

- [ ] **Step 1: Read `screenshots/report.json` for current violations**

```bash
cat C:\Users\tmott\Desktop\Lai\Lai\screenshots\report.json | grep -E "impact|surface|help"
```

Or open `report.json` and filter for `impact: "critical"` and `impact: "serious"`.

- [ ] **Step 2: Fix each critical/serious violation**

Common issues + remediation:
- **`button-name`** (button has no accessible name): add `aria-label` to icon-only buttons.
- **`color-contrast`** (insufficient contrast): bump the muted color a notch on dark mode (e.g., `text-muted-foreground` → custom `text-muted-foreground-strong` only where flagged).
- **`label`** (form input has no label): wrap `<input>` in `<label>` or add `<label htmlFor={id}>...</label>`.
- **`aria-required-children`** / **`aria-required-parent`**: use the correct ARIA roles for radio groups / listboxes.

Commit per group: `fix(a11y): button-name on all icon-only buttons`, `fix(a11y): color contrast on dark muted text`, etc.

- [ ] **Step 3: Re-run smoke test until zero critical/serious**

Run: `node scripts/verify-all-surfaces.mjs`
Expected: exit code 0.

---

## Task 21: a11y — keyboard nav + visible focus

**Files:**
- Modify: `app/globals.css` if focus-visible ring style needs adjustment
- Modify: any interactive element missing `focus-visible:` styles

- [ ] **Step 1: Manual keyboard sweep**

Open `/chat`, `/cv`, `/assessment`, `/recommendations`, `/plan`, `/interview` in turn. Use Tab + Shift+Tab + Enter + Space + arrow keys. Verify:
- Every interactive element receives focus
- Focus ring is visible (not invisible default)
- Focus order matches reading order (RTL: right-to-left, top-to-bottom)
- No keyboard traps

- [ ] **Step 2: Add `focus-visible:` ring styles where missing**

The project uses shadcn/ui which has default `focus-visible:ring-2 focus-visible:ring-primary` on most components. Custom buttons might be missing it. Apply:

```tsx
className="... focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
```

- [ ] **Step 3: Commit**

```bash
git add app/globals.css components/...
git commit -m "feat(a11y): visible focus rings + keyboard nav verified across surfaces

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: Final verification — full smoke test

**Files:** none modified (verification only).

- [ ] **Step 1: Make sure dev server is running**

```bash
cd C:\Users\tmott\Desktop\Lai\Lai
NODE_OPTIONS="--max-old-space-size=12288" npm run dev   # in a separate terminal
```

- [ ] **Step 2: Run the full sweep**

Run: `node scripts/verify-all-surfaces.mjs`
Expected: exit code 0 — no console errors, no critical/serious a11y violations.

- [ ] **Step 3: Run static checks**

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Expected: all green.

- [ ] **Step 4: Manual e2e if ANTHROPIC_API_KEY set**

```bash
npx tsx scripts/e2e-test-chat.ts stage
```

Expected: stage advancement still works (regression check on A1 fix).

---

## Task 23: CLAUDE.md docs + open PR

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append Phase 6c architecture section**

Add after the Phase 6a section in `CLAUDE.md`:

```markdown
## Phase 6c architecture (production-readiness fixes + observability + polish)

Bundles 8 production-readiness bug fixes (Bucket A) with observability + a11y + state audit + mobile QA (Bucket B). A landed first so Sentry doesn't ship to production silencing the bugs we already know about.

- **Chat-engine message-flow fix** (A1, regression from 6a commit `9033071`): the chat route now appends `{role:"user", content:userText}` to `history` before calling `streamLlmTurn`. The engine intentionally stays minimal — it doesn't auto-append because the interview route already builds its own preamble-wrapped message. A unit test in `tests/unit/ai/engine-message-flow.test.ts` pins the contract so future engine refactors don't regress this.
- **SECURITY DEFINER privileges revoked** (A2): `merge_career_profile` + `increment_conversation_counters` previously had EXECUTE granted to PUBLIC. Anon/authenticated clients with the publishable key could call them directly. Migration `20260517100000_revoke_rpc_execute.sql` revokes from `public, anon, authenticated` and grants only to `service_role`.
- **Server-side consent enforcement** (A3): `lib/consent.ts` now exports `requireConsent(userId, purposes)` that throws `NoConsentError` if any required purpose lacks an active row in `public.consents`. Called at the top of every gated API route (chat/cv/recommendations/plan/interview). The client modal is now UX; the server enforces correctness.
- **CV upload race fix** (A4): submit button disabled until `cv_upload_id` is set; defensive guard inside `submit()` as belt-and-suspenders.
- **Extraction shape alignment** (A5): chat-extracted `values` + `constraints` now match `MatchingProfile` exactly (raw string keys, not `{key,label_he}` objects; `risk_tolerance` not `risk_tolerance_1_10`; `english_level` enum without `native`).
- **CV confirm scoped UPDATE** (A6): refactored to `mergeCvSkillsIntoLatestProfile(userId, skills)` which orders by `updated_at desc, limit 1` for the read and scopes UPDATE to that row's `id`.
- **Recommendations regen bypasses server cache** (A7): server route accepts `{force: true}` in body that skips `getCached`. Client sends it on regenerate.
- **Sentry server + edge only** (B1): `@sentry/nextjs` configured with `sendDefaultPii: false` and aggressive `beforeSend` that drops `event.request.data`, `event.request.cookies`, `event.request.headers` and PII from `event.user`. Source maps via `withSentryConfig` at build time. NO client SDK, NO performance tracing, NO replay — minimal pre-launch observability. Browser SDK + Performance can land in 6c.5 once production traffic exists.
- **All-surfaces smoke test** (B2): `scripts/verify-all-surfaces.mjs` runs 14 surfaces × 3 viewports (375/768/1280) with `@axe-core/playwright` per combination. Exits non-zero on critical/serious a11y violations, console errors, or HTTP failures.
- **WCAG 2.2 AA target**: every critical + serious axe violation is fixed; moderate + minor are documented for follow-up. Keyboard nav + visible focus rings verified manually.

Architectural rule: production-readiness bugs surface during the smoke test in CI. If any new feature lands a regression that the smoke test catches, the build fails and the regression doesn't ship.
```

- [ ] **Step 2: tsc + lint + tests + build all green**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all clean.

- [ ] **Step 3: Commit + push + open PR**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): document Phase 6c architecture

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin HEAD

gh pr create --title "Phase 6c: production-readiness fixes + observability + a11y" --body "$(cat <<'EOF'
## Summary

Two bundled buckets:

**Bucket A — production-readiness bugs surfaced by 2026-05-17 deep review**
- A1: Chat sends current user message to Claude (regression from 6a)
- A2: SECURITY DEFINER RPCs no longer callable by anon/authenticated
- A3: Consent enforced server-side on every gated API route
- A4: CV upload submit disabled until cv_upload_id is set
- A5: Chat-extracted values + constraints align with MatchingProfile
- A6: CV confirm scoped UPDATE to single row (not all user rows)
- A7: Recommendations regenerate accepts force=true and bypasses server cache
- A8: Nested <button> in CvReview flattened

**Bucket B — polish + observability on top of correct baseline**
- B1: Sentry @sentry/nextjs server+edge, sendDefaultPii:false, strict scrubbing
- B2: @axe-core/playwright integrated into a multi-viewport smoke test
- B3-B7: state audit across chat, cv, assessment, plan
- B8: mobile QA at 375/768/1280
- B9-B10: WCAG 2.2 AA — zero critical/serious axe violations, focus rings

## Plan
\`docs/superpowers/plans/2026-05-17-career-os-06c-fixes-and-polish.md\`

## Spec
\`docs/superpowers/specs/2026-05-17-career-os-06c-polish-and-observability-design.md\`

## Verification

- [x] \`npx tsc --noEmit\` clean
- [x] \`npm run lint\` clean
- [x] \`npm test\` all green (regression test on A1 included)
- [x] \`npm run build\` clean
- [x] Supabase REVOKE migration applied
- [x] \`node scripts/verify-all-surfaces.mjs\` clean (14 surfaces × 3 viewports)
- [ ] **Pending env setup**: \`SENTRY_DSN\` + \`SENTRY_AUTH_TOKEN\` + \`SENTRY_ORG\` + \`SENTRY_PROJECT\` set in Vercel project before first prod deploy
- [ ] **Pending manual**: trigger a deliberate error in prod and verify it shows up in Sentry dashboard

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Definition of Done

**Bucket A (production-readiness bugs):**
- [ ] A1: chat sends current user message to Claude; regression test asserts the messages array
- [ ] A2: SECURITY DEFINER RPCs no longer callable by anon/authenticated; migration applied
- [ ] A3: consent enforced server-side on chat/cv/cv-confirm/recommendations/plan/interview/wrap; integration test asserts 403 for missing consent
- [ ] A4: CV submit button disabled until cv_upload_id is set
- [ ] A5: extraction shape matches MatchingProfile; regression test pins it
- [ ] A6: CV confirm uses latest-row read + scoped UPDATE; unit test pins it
- [ ] A7: regenerate accepts force=true and bypasses cache
- [ ] A8: nested <button> flattened in CvReview

**Bucket B (polish + observability):**
- [ ] B1: Sentry server + edge configs live, source maps upload configured
- [ ] B2: scripts/verify-all-surfaces.mjs implemented + axe-core integrated
- [ ] B3-B7: state audit complete across chat/cv/assessment/plan; recommendations + interview verified
- [ ] B8: mobile QA pass — no layout breaks at 375/768/1280
- [ ] B9: WCAG 2.2 AA — zero critical/serious axe violations across all surfaces
- [ ] B10: keyboard nav + visible focus rings verified manually
- [ ] B11: final smoke-test run clean
- [ ] B12: CLAUDE.md "Phase 6c architecture" section appended

**Project gates:**
- [ ] PR title: *"Phase 6c: production-readiness fixes + observability + a11y"*
- [ ] lint + tsc + tests + build all green
- [ ] CI passes on PR

---

## Self-review notes (for the next person picking this up)

A few items where the plan task code assumes facts the implementer should verify before writing:

1. **Task 3 step 1 — RPC signatures**: I verified the function signatures earlier (`merge_career_profile(uuid, uuid, text, jsonb)`, `increment_conversation_counters(uuid, int, int)`). If anything was added to `supabase/migrations/` between the spec date and execution date, the REVOKE block must cover those too.

2. **Task 4 step 1 — `ConsentPurpose` type**: I'm assuming `CONSENT_PURPOSES` in `lib/consent.ts` is a `readonly tuple` typed as `ConsentPurpose`. If it's typed differently, adapt the `requireConsent` signature accordingly.

3. **Task 5 step 3 — route ordering of `requireConsent`**: each route differs slightly on when `userId` becomes available. The check goes immediately after `userId` is resolved and BEFORE any expensive work (LLM call, DB write). For routes with body validation (like `/api/interview`), validate body shape FIRST so bad requests get 400, not 403.

4. **Task 7 — extraction prompt update**: I named `lib/ai/prompts/stages/values.ts` and `constraints.ts` but didn't verify they exist. If the prompts live in a different shape (e.g., a single file with all stages), find the right file and update accordingly.

5. **Task 12 — Sentry capture in routes**: I deferred explicit `Sentry.captureException` calls in routes to Next.js 16's `onRequestError`. If that auto-instrumentation isn't catching errors as expected, fall back to explicit `try/catch` + `Sentry.captureException` in each route handler.

6. **Task 13 — surface list**: 14 surfaces are listed. If new pages have landed since this plan was written (e.g., admin pages from Phase 7 prep), add them to the array.

None of these are blockers — they're "verify before writing" notes that the writing-plans skill explicitly allows when the underlying state can drift between plan-writing and execution.
