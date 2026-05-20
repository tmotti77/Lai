# Phase 6b Implementation Plan — Feedback + Analytics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship per-message thumbs on recommendations + interview-wrap, one-shot NPS prompt on first value-delivery moment, Supabase `feedback` table as source of truth, typed `lib/analytics.ts` wrapper for Vercel Analytics aggregate events, and Bearer-token-gated CSV export endpoint. Chat thumbs deferred to Phase 6b.5.

**Architecture:** Two stores: Supabase for full per-user data (joinable, full free text, auditable, RLS-protected); Vercel Analytics for aggregate counters via typed allowlist (no user_id, no PII). DB writes are source of truth; analytics events fire only AFTER DB write succeeds. Atomic guarded-UPDATE-with-RETURNING pattern for first-time detection (NPS eligibility, is_first, transitions). `after()` from `next/server` for fire-and-forget event delivery without blocking responses.

**Tech Stack:** Next.js 16 App Router • AI SDK v6 (no changes) • Supabase (Postgres + RLS) • Vitest • Playwright + `@axe-core/playwright` (Phase 6c) • `@vercel/analytics` (new) • Tailwind v4 + shadcn/ui • Hebrew RTL.

**Spec:** `docs/superpowers/specs/2026-05-18-career-os-06b-feedback-and-analytics-design.md` (commit `4a410c5`).

---

## File map

### New files

```
lib/analytics.ts                                     Typed track() wrapper, EventName/EventPropsMap, after()
lib/db/feedback.ts                                   getUserFeedbackForTargets() for SSR hydration on interview-wrap
lib/db/nps.ts                                        getNpsEligibility(userId), markNpsEligibilityIfFirst()

components/feedback/ThumbsRow.tsx                    Client component (recs + interview-wrap)
components/feedback/NpsPrompt.tsx                    Client component (recs / plan / interview)

app/api/feedback/route.ts                            POST: thumbs + NPS submit (discriminated union body)
app/api/feedback/nps-dismiss/route.ts                POST: marks nps_dismissed_at
app/api/admin/feedback/export/route.ts               GET: Bearer-token CSV export

supabase/migrations/20260518000000_phase_6b_feedback.sql

tests/unit/analytics.test.ts                         npsBucket boundaries + noop in test env
tests/unit/feedback/schema.test.ts                   Zod discriminated-union acceptance/rejection
tests/unit/feedback/csv-escape.test.ts               Formula injection + quoting + embedded newlines
tests/unit/db/interview-transition.test.ts           Guarded-UPDATE emits once, not on re-call

tests/integration/feedback-route.test.ts             POST /api/feedback E2E
tests/integration/admin-export-route.test.ts         Auth + filter validation + CSV correctness
tests/integration/nps-eligibility.test.ts            Atomic across concurrent calls
tests/integration/plan-task-transition.test.ts       false→true emits; true→true no-op; cross-user 403
```

### Modified files

```
package.json                                         + @vercel/analytics
package-lock.json                                    npm install side-effect
.env.example                                         + ADMIN_EXPORT_TOKEN placeholder
README.md                                            + ADMIN_EXPORT_TOKEN deployment doc
app/layout.tsx                                       + <Analytics /> from @vercel/analytics/next
lib/i18n/he.ts                                       + feedback.* namespace

app/api/recommendations/route.ts                     + recommendation_id + thumbs in response; emit recommendations_generated
app/api/chat/route.ts                                Emit conversation_started on first user message
app/api/assessment/submit/route.ts                   Emit assessment_completed
app/api/cv/confirm/route.ts                          Emit cv_uploaded
app/api/report/pdf/route.ts                          Atomic is_first; emit report_downloaded; mark NPS eligibility
app/api/plan/generate/route.ts                       Emit plan_generated; mark NPS eligibility
app/api/plan/tasks/[id]/toggle/route.ts              Use refactored toggleTaskDone (preserves ownership)
app/api/interview/route.ts                           Emit interview_started

lib/db/interview.ts                                  completeInterviewSession: guarded UPDATE returning data; emit interview_completed; mark NPS eligibility
lib/db/plans.ts                                      toggleTaskDone(userId, taskId, done): preserve ownership, guarded UPDATE returning category/day on transition, emit on transition false→true only

components/recommendations/RecommendationsClient.tsx Pass thumbs initial state down to OccupationCard
components/recommendations/OccupationCard.tsx        Mount <ThumbsRow>
components/interview/WrapUpScreen.tsx                Mount <ThumbsRow>

app/(app)/recommendations/page.tsx                   SSR-render <NpsPrompt> when eligibility.show
app/(app)/plan/page.tsx                              Same
app/(app)/interview/[sessionId]/page.tsx             Same + SSR hydrate interview-wrap ThumbsRow initial value

scripts/verify-all-surfaces.mjs                      + thumbs interaction + NPS prompt + admin export checks
```

### Not modified (intentionally)

- `lib/env.ts` — `ADMIN_EXPORT_TOKEN` optional in dev/build; missing → 401 from admin route only
- `lib/anonymous.ts` — `account_saved` event deferred
- `components/chat/MessageList.tsx`, `app/(app)/chat/page.tsx` — chat thumbs deferred to 6b.5
- Matching engine, AI prompts, assessment scoring

---

## Task 1: Install @vercel/analytics

**Files:**
- Modify: `package.json` (added by npm)
- Modify: `package-lock.json` (added by npm)

- [ ] **Step 1: Install the dep**

```powershell
cd C:\Users\tmott\Desktop\Lai\Lai
npm install --save @vercel/analytics
```

- [ ] **Step 2: Verify version installed**

Run: `npx grep @vercel/analytics package.json`
Expected: shows `@vercel/analytics` in dependencies with a version like `^1.x` or `^2.x`.

- [ ] **Step 3: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors (the package only adds modules, no usage yet).

- [ ] **Step 4: Commit**

```powershell
git add package.json package-lock.json
git commit -m "chore(deps): add @vercel/analytics

Phase 6b adds Vercel Analytics custom events via a typed wrapper.
Server-side track() emits aggregate counters; <Analytics /> in the
root layout autotracks pageviews.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Database migration — feedback table + users columns

**Files:**
- Create: `supabase/migrations/20260518000000_phase_6b_feedback.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260518000000_phase_6b_feedback.sql
-- Phase 6b: feedback table for thumbs + NPS; users columns for NPS state machine.

create table public.feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  surface       text not null check (surface in ('chat', 'recommendations', 'interview', 'nps')),
  target_type   text check (target_type is null or target_type in (
                  'message', 'recommendation_occupation', 'interview_session'
                )),
  target_id     text,
  thumbs_value  smallint check (thumbs_value in (-1, 1)),
  nps_score     smallint check (nps_score between 0 and 10),
  nps_trigger   text check (nps_trigger is null or nps_trigger in (
                  'pdf_download', 'plan_generated', 'interview_completed'
                )),
  comment_he    text check (comment_he is null or char_length(comment_he) <= 1000),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint feedback_exactly_one_signal check (
    (thumbs_value is not null and nps_score is null) or
    (thumbs_value is null and nps_score is not null)
  ),
  constraint feedback_thumb_has_target check (
    (thumbs_value is null) or (target_type is not null and target_id is not null)
  ),
  constraint feedback_nps_has_trigger check (
    (nps_score is null) or (nps_trigger is not null)
  ),
  constraint feedback_nps_shape check (
    (nps_score is null) or
    (surface = 'nps' and target_type is null and target_id is null)
  ),
  constraint feedback_thumb_shape check (
    (thumbs_value is null) or (nps_trigger is null)
  ),
  constraint feedback_thumb_no_comment check (
    (thumbs_value is null) or (comment_he is null)
  ),
  constraint feedback_target_id_length check (
    target_id is null or char_length(target_id) <= 128
  ),
  constraint feedback_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index feedback_one_thumb_per_target_idx
  on public.feedback (user_id, surface, target_type, target_id)
  where thumbs_value is not null;

create unique index feedback_one_nps_per_user_idx
  on public.feedback (user_id)
  where nps_score is not null;

create index feedback_surface_created_at_idx
  on public.feedback (surface, created_at desc);

create index feedback_nps_trigger_created_at_idx
  on public.feedback (nps_trigger, created_at desc)
  where nps_score is not null;

create trigger feedback_set_updated_at
  before update on public.feedback
  for each row execute function public.set_updated_at();

alter table public.feedback enable row level security;
-- No policies → service-role-only access. Anonymous users have auth_id IS NULL
-- so any owner-select policy would never match anyway.

alter table public.users
  add column nps_eligibility_first_at  timestamptz,
  add column nps_submitted_at          timestamptz,
  add column nps_dismissed_at          timestamptz,
  add column nps_trigger_first         text check (
    nps_trigger_first is null or nps_trigger_first in (
      'pdf_download', 'plan_generated', 'interview_completed'
    )
  ),
  add column first_report_downloaded_at timestamptz;
```

- [ ] **Step 2: Push migration to remote**

Run: `npx supabase db push`
Expected: applies the migration to the linked `career-os` project; no errors.

- [ ] **Step 3: Verify feedback table exists**

Run: `npx supabase db remote query "select column_name, data_type from information_schema.columns where table_name='feedback' order by ordinal_position"`
Expected: 12 columns matching the migration above.

- [ ] **Step 4: Verify users columns added**

Run: `npx supabase db remote query "select column_name from information_schema.columns where table_name='users' and column_name like 'nps_%' or column_name='first_report_downloaded_at'"`
Expected: 5 rows — `nps_eligibility_first_at`, `nps_submitted_at`, `nps_dismissed_at`, `nps_trigger_first`, `first_report_downloaded_at`.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20260518000000_phase_6b_feedback.sql
git commit -m "feat(db): Phase 6b feedback table + users NPS columns

Single feedback table with discriminator (thumbs vs NPS), partial unique
indexes for one-current-thumb-per-target and one-NPS-per-user, CHECK
constraints enforcing exactly-one-signal + per-type field shape.

users gains 5 columns for the NPS eligibility state machine and the
first-report-download tracking column.

RLS enabled with no policies — service-role-only access. Anonymous
users have auth_id IS NULL so an owner policy would never match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Regenerate Supabase types

**Files:**
- Modify: `lib/db/types.gen.ts` (regenerated)

- [ ] **Step 1: Regenerate types**

```powershell
npm run db:types
```

Expected: `lib/db/types.gen.ts` updated to include `feedback` table types + new `users` columns.

- [ ] **Step 2: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors. (No existing code references the new types yet, but the file must still type-check.)

- [ ] **Step 3: Commit**

```powershell
git add lib/db/types.gen.ts
git commit -m "chore(db): regenerate Supabase types for Phase 6b

Adds feedback table + users NPS state-machine columns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: lib/analytics.ts — typed track wrapper

**Files:**
- Create: `lib/analytics.ts`
- Create: `tests/unit/analytics.test.ts`

- [ ] **Step 1: Write the unit test**

```typescript
// tests/unit/analytics.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@vercel/analytics/server", () => ({ track: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn((fn: () => void) => fn()) }));

import { track as vercelTrack } from "@vercel/analytics/server";
import { after } from "next/server";
import { track, npsBucket } from "@/lib/analytics";

beforeEach(() => vi.clearAllMocks());

describe("npsBucket", () => {
  it("0-6 is detractor", () => {
    expect(npsBucket(0)).toBe("detractor");
    expect(npsBucket(6)).toBe("detractor");
  });
  it("7-8 is passive", () => {
    expect(npsBucket(7)).toBe("passive");
    expect(npsBucket(8)).toBe("passive");
  });
  it("9-10 is promoter", () => {
    expect(npsBucket(9)).toBe("promoter");
    expect(npsBucket(10)).toBe("promoter");
  });
});

describe("track", () => {
  it("no-ops in test env (process.env.NODE_ENV === 'test')", () => {
    track("conversation_started", { surface: "chat" });
    expect(after).not.toHaveBeenCalled();
    expect(vercelTrack).not.toHaveBeenCalled();
  });

  it("calls vercelTrack via after() when not in test env", () => {
    const original = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    try {
      track("conversation_started", { surface: "chat" });
      expect(after).toHaveBeenCalledTimes(1);
      expect(vercelTrack).toHaveBeenCalledWith(
        "conversation_started",
        { surface: "chat" }
      );
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", { value: original, configurable: true });
    }
  });

  it("swallows errors from vercelTrack", () => {
    const original = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    (vercelTrack as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
    try {
      expect(() => track("feedback_submitted", { kind: "thumb", surface: "chat", value: "up" })).not.toThrow();
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", { value: original, configurable: true });
    }
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL — module doesn't exist)**

Run: `npx vitest run tests/unit/analytics.test.ts`
Expected: FAIL with `Cannot find module '@/lib/analytics'`.

- [ ] **Step 3: Create lib/analytics.ts**

```typescript
// lib/analytics.ts
import "server-only";
import { after } from "next/server";
import { track as vercelTrack } from "@vercel/analytics/server";

export type EventName =
  | "conversation_started"
  | "assessment_completed"
  | "cv_uploaded"
  | "recommendations_generated"
  | "report_downloaded"
  | "plan_generated"
  | "plan_task_completed"
  | "interview_started"
  | "interview_completed"
  | "feedback_submitted";

export type SkillCountBucket = "0-5" | "6-10" | "11-20" | "20+";
export type CvArchetype = "builder" | "connector" | "analyst" | "leader" | "creator" | "generalist";
export type PlanArchetype = "apply" | "taste_test" | "research";
export type PlanTaskCategory = "action" | "research" | "network" | "reflection";
export type InterviewPersona = "hr" | "technical" | "first_job";
export type NpsTrigger = "pdf_download" | "plan_generated" | "interview_completed";
export type NpsBucket = "detractor" | "passive" | "promoter";
export type QuestionCountBucket = "1-4" | "5-8" | "9+";

export type EventPropsMap = {
  conversation_started: { surface: "chat" | "interview" };
  assessment_completed: { type: "riasec" | "big5" | "values" | "constraints" };
  cv_uploaded: { skill_count_bucket: SkillCountBucket; archetype: CvArchetype };
  recommendations_generated: { cache_hit: boolean; dimension_count: 0 | 1 | 2 | 3 | 4 | 5 | 6 };
  report_downloaded: { is_first: boolean };
  plan_generated: { archetype: PlanArchetype };
  plan_task_completed: { category: PlanTaskCategory; week: 1 | 2 | 3 | 4 | 5 };
  interview_started: { persona: InterviewPersona };
  interview_completed: {
    persona: InterviewPersona;
    forced_wrap: boolean;
    question_count_bucket: QuestionCountBucket;
  };
  feedback_submitted:
    | { kind: "thumb"; surface: "chat" | "recommendations" | "interview"; value: "up" | "down" | "removed" }
    | { kind: "nps"; trigger: NpsTrigger; bucket: NpsBucket };
};

export function track<E extends EventName>(event: E, props: EventPropsMap[E]): void {
  if (process.env.NODE_ENV === "test") return;
  after(() => {
    vercelTrack(event, props as Record<string, string | number | boolean | null>).catch((err) => {
      console.error(`[analytics] track(${event}) failed:`, err);
    });
  });
}

export function npsBucket(score: number): NpsBucket {
  if (score <= 6) return "detractor";
  if (score <= 8) return "passive";
  return "promoter";
}

export function questionCountBucket(count: number): QuestionCountBucket {
  if (count <= 4) return "1-4";
  if (count <= 8) return "5-8";
  return "9+";
}

export function skillCountBucket(count: number): SkillCountBucket {
  if (count <= 5) return "0-5";
  if (count <= 10) return "6-10";
  if (count <= 20) return "11-20";
  return "20+";
}
```

- [ ] **Step 4: Run the test again**

Run: `npx vitest run tests/unit/analytics.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```powershell
git add lib/analytics.ts tests/unit/analytics.test.ts
git commit -m "feat(analytics): typed track() wrapper + EventPropsMap allowlist

lib/analytics.ts is the single gate for all Vercel Analytics events.
TypeScript enforces the no-PII rule at compile time: every event name
in EventName union and every prop schema in EventPropsMap; user_id,
free text, Hebrew strings can never fit through the type checker.

track() uses after() from next/server for fire-and-forget delivery
without blocking responses. Errors are swallowed (analytics outage
never breaks user flow). No-ops in NODE_ENV=test so unit tests don't
emit real events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: lib/db/feedback.ts — getUserFeedbackForTargets

**Files:**
- Create: `lib/db/feedback.ts`

This helper fetches initial-vote-state for SSR hydration on the interview-wrap surface. The recommendations surface hydrates via API response (Task 13), so this helper only needs to handle the `interview_session` target_type — but we'll write it generically for future use.

- [ ] **Step 1: Create the helper**

```typescript
// lib/db/feedback.ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export async function getUserFeedbackForTargets(
  userId: string,
  targets: Array<{ type: string; id: string }>
): Promise<Map<string, -1 | 1>> {
  if (targets.length === 0) return new Map();
  const supabase = createServiceClient();
  const types = [...new Set(targets.map((t) => t.type))];
  const ids = targets.map((t) => t.id);
  const { data } = await supabase
    .from("feedback")
    .select("target_type, target_id, thumbs_value")
    .eq("user_id", userId)
    .not("thumbs_value", "is", null)
    .in("target_type", types)
    .in("target_id", ids);

  const map = new Map<string, -1 | 1>();
  for (const row of data ?? []) {
    if (row.thumbs_value === 1 || row.thumbs_value === -1) {
      map.set(`${row.target_type}:${row.target_id}`, row.thumbs_value as -1 | 1);
    }
  }
  return map;
}
```

- [ ] **Step 2: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add lib/db/feedback.ts
git commit -m "feat(db): getUserFeedbackForTargets() for SSR thumbs hydration

Single query returning a Map<\`type:id\`, -1|1> of the user's current
thumb votes across the requested targets. Used by interview-wrap page
server component to prepopulate <ThumbsRow> initialValue without a
client-side roundtrip.

Recommendations surface hydrates via /api/recommendations response
payload (Task 13), so this helper is primarily for interview-wrap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: lib/db/nps.ts — NPS eligibility helpers

**Files:**
- Create: `lib/db/nps.ts`
- Create: `tests/integration/nps-eligibility.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/integration/nps-eligibility.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createServiceClient } from "@/lib/supabase/service";
import { markNpsEligibilityIfFirst, getNpsEligibility } from "@/lib/db/nps";

async function createTestUser(): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .insert({ is_anonymous: true })
    .select("id")
    .single();
  if (!data) throw new Error("createTestUser failed");
  return data.id;
}

async function cleanupTestUser(userId: string): Promise<void> {
  await createServiceClient().from("users").delete().eq("id", userId);
}

describe("markNpsEligibilityIfFirst", () => {
  it("first call sets eligibility + trigger", async () => {
    const userId = await createTestUser();
    try {
      await markNpsEligibilityIfFirst(userId, "pdf_download");
      const elig = await getNpsEligibility(userId);
      expect(elig.show).toBe(true);
      expect(elig.trigger).toBe("pdf_download");
    } finally {
      await cleanupTestUser(userId);
    }
  });

  it("second call is a no-op (first trigger wins)", async () => {
    const userId = await createTestUser();
    try {
      await markNpsEligibilityIfFirst(userId, "pdf_download");
      await markNpsEligibilityIfFirst(userId, "interview_completed");
      const elig = await getNpsEligibility(userId);
      expect(elig.trigger).toBe("pdf_download");
    } finally {
      await cleanupTestUser(userId);
    }
  });

  it("concurrent calls — exactly one wins", async () => {
    const userId = await createTestUser();
    try {
      await Promise.all([
        markNpsEligibilityIfFirst(userId, "pdf_download"),
        markNpsEligibilityIfFirst(userId, "plan_generated"),
        markNpsEligibilityIfFirst(userId, "interview_completed"),
      ]);
      const elig = await getNpsEligibility(userId);
      expect(elig.show).toBe(true);
      expect(["pdf_download", "plan_generated", "interview_completed"]).toContain(elig.trigger);
    } finally {
      await cleanupTestUser(userId);
    }
  });

  it("getNpsEligibility returns show:false when never eligible", async () => {
    const userId = await createTestUser();
    try {
      const elig = await getNpsEligibility(userId);
      expect(elig.show).toBe(false);
      expect(elig.trigger).toBe(null);
    } finally {
      await cleanupTestUser(userId);
    }
  });
});
```

- [ ] **Step 2: Run test (expect FAIL — module missing)**

Run: `npx vitest run tests/integration/nps-eligibility.test.ts`
Expected: FAIL with `Cannot find module '@/lib/db/nps'`.

- [ ] **Step 3: Create lib/db/nps.ts**

```typescript
// lib/db/nps.ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { NpsTrigger } from "@/lib/analytics";

export async function markNpsEligibilityIfFirst(
  userId: string,
  trigger: NpsTrigger
): Promise<void> {
  const supabase = createServiceClient();
  // Atomic: only updates if currently null (first-trigger wins).
  await supabase
    .from("users")
    .update({
      nps_eligibility_first_at: new Date().toISOString(),
      nps_trigger_first: trigger,
    })
    .eq("id", userId)
    .is("nps_eligibility_first_at", null);
}

export async function getNpsEligibility(userId: string): Promise<{
  show: boolean;
  trigger: NpsTrigger | null;
}> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("nps_eligibility_first_at, nps_submitted_at, nps_dismissed_at, nps_trigger_first")
    .eq("id", userId)
    .maybeSingle();

  const show =
    !!data?.nps_eligibility_first_at &&
    !data.nps_submitted_at &&
    !data.nps_dismissed_at;

  return { show, trigger: (data?.nps_trigger_first as NpsTrigger | null) ?? null };
}
```

- [ ] **Step 4: Run test again**

Run: `npx vitest run tests/integration/nps-eligibility.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```powershell
git add lib/db/nps.ts tests/integration/nps-eligibility.test.ts
git commit -m "feat(db): NPS eligibility helpers with atomic first-trigger-wins

markNpsEligibilityIfFirst uses a guarded UPDATE (WHERE column IS NULL)
so concurrent calls race against Postgres, not in app code. Integration
test verifies: first call sets state, second is no-op, concurrent
N>1 calls produce exactly one winner.

getNpsEligibility returns show: true only when eligibility_first_at
is set AND neither submitted nor dismissed. This is the single source
of truth for whether <NpsPrompt> renders.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: i18n strings + .env.example placeholder + README env doc

**Files:**
- Modify: `lib/i18n/he.ts`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add feedback namespace to he.ts**

Open `lib/i18n/he.ts` and add inside the exported `he` object (alphabetical placement, before `interview`):

```typescript
feedback: {
  thumbs: {
    upLabel: "תגובה חיובית",
    downLabel: "תגובה שלילית",
  },
  nps: {
    title: "?כמה סביר שתמליצ/י על השירות לחבר/ה",
    subtitle: "התשובה שלך עוזרת לנו לשפר את המוצר. ניתן לדלג.",
    scaleLabel: "דירוג מ-0 עד 10",
    scaleMin: "בכלל לא סביר",
    scaleMax: "סביר מאוד",
    commentPlaceholder: "מה גרם לך לבחור את הציון הזה? (אופציונלי)",
    submitButton: "שליחה",
    submitting: "שולח...",
    skipButton: "דלג",
    dismissLabel: "סגירה",
  },
},
```

- [ ] **Step 2: Add ADMIN_EXPORT_TOKEN to .env.example**

Append to `.env.example`:

```
# Phase 6b: admin CSV export endpoint
# Generate with: openssl rand -hex 32
# Used by GET /api/admin/feedback/export — missing token returns 401.
# Optional in dev; required in production for the admin export feature.
ADMIN_EXPORT_TOKEN=
```

- [ ] **Step 3: Document ADMIN_EXPORT_TOKEN in README**

Find the existing env-vars section in `README.md` and append:

```markdown
- `ADMIN_EXPORT_TOKEN` (optional, recommended for production): Bearer token
  for the admin feedback CSV export endpoint. Generate with `openssl rand
  -hex 32`. Without this set, `GET /api/admin/feedback/export` always
  returns 401.
```

- [ ] **Step 4: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```powershell
git add lib/i18n/he.ts .env.example README.md
git commit -m "feat(i18n+env): Phase 6b feedback strings + ADMIN_EXPORT_TOKEN

Hebrew strings for ThumbsRow + NpsPrompt are v1; Phase 7 launch
checklist gates on Hebrew copywriter review.

ADMIN_EXPORT_TOKEN added to .env.example with a comment explaining
its use; README env-var docs section gains a matching entry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: POST /api/feedback — Zod schema + thumb path

**Files:**
- Create: `app/api/feedback/route.ts`
- Create: `tests/unit/feedback/schema.test.ts`
- Create: `tests/integration/feedback-route.test.ts`

- [ ] **Step 1: Write the unit schema test**

```typescript
// tests/unit/feedback/schema.test.ts
import { describe, it, expect } from "vitest";
import { FeedbackBody } from "@/app/api/feedback/route";  // re-exported from route

describe("FeedbackBody (Zod discriminated union)", () => {
  it("accepts valid thumb body", () => {
    expect(() => FeedbackBody.parse({
      kind: "thumb",
      surface: "recommendations",
      target_type: "recommendation_occupation",
      target_id: "abc:data-analyst",
      thumbs_value: 1,
    })).not.toThrow();
  });

  it("accepts valid NPS body", () => {
    expect(() => FeedbackBody.parse({
      kind: "nps",
      nps_score: 9,
      nps_trigger: "pdf_download",
      comment_he: null,
    })).not.toThrow();
  });

  it("rejects thumb with NPS field", () => {
    expect(() => FeedbackBody.parse({
      kind: "thumb",
      surface: "recommendations",
      target_type: "recommendation_occupation",
      target_id: "abc:data-analyst",
      thumbs_value: 1,
      nps_score: 5,  // not allowed
    })).toThrow();
  });

  it("rejects NPS out of range", () => {
    expect(() => FeedbackBody.parse({
      kind: "nps",
      nps_score: 11,
      nps_trigger: "pdf_download",
    })).toThrow();
  });

  it("rejects target_id over 128 chars", () => {
    expect(() => FeedbackBody.parse({
      kind: "thumb",
      surface: "interview",
      target_type: "interview_session",
      target_id: "x".repeat(129),
      thumbs_value: 1,
    })).toThrow();
  });

  it("rejects comment_he over 1000 chars on NPS", () => {
    expect(() => FeedbackBody.parse({
      kind: "nps",
      nps_score: 7,
      nps_trigger: "pdf_download",
      comment_he: "x".repeat(1001),
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run unit test (expect FAIL)**

Run: `npx vitest run tests/unit/feedback/schema.test.ts`
Expected: FAIL with `Cannot find module '@/app/api/feedback/route'`.

- [ ] **Step 3: Create the route**

```typescript
// app/api/feedback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { requireConsent, NoConsentError } from "@/lib/consent";
import { createServiceClient } from "@/lib/supabase/service";
import { track, npsBucket } from "@/lib/analytics";
import { loadAllOccupations } from "@/lib/db/occupations";
import * as Sentry from "@sentry/nextjs";

const ThumbBody = z.object({
  kind: z.literal("thumb"),
  surface: z.enum(["chat", "recommendations", "interview"]),
  target_type: z.enum(["message", "recommendation_occupation", "interview_session"]),
  target_id: z.string().min(1).max(128),
  thumbs_value: z.union([z.literal(1), z.literal(-1), z.null()]),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const NpsBody = z.object({
  kind: z.literal("nps"),
  nps_score: z.number().int().min(0).max(10),
  nps_trigger: z.enum(["pdf_download", "plan_generated", "interview_completed"]),
  comment_he: z.string().max(1000).nullable().optional(),
});

export const FeedbackBody = z.discriminatedUnion("kind", [ThumbBody, NpsBody]);
export type FeedbackBodyT = z.infer<typeof FeedbackBody>;

export async function POST(req: NextRequest) {
  let body: FeedbackBodyT;
  try {
    body = FeedbackBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await getOrCreateAnonymousUserId();
    await requireConsent(userId);
  } catch (err) {
    if (err instanceof NoConsentError) {
      return NextResponse.json({ error: "consent_required" }, { status: 403 });
    }
    throw err;
  }

  const supabase = createServiceClient();

  try {
    if (body.kind === "thumb") {
      // 1. Target ownership validation
      if (body.target_type === "message") {
        const { data } = await supabase
          .from("messages")
          .select("id, conversations!inner(user_id)")
          .eq("id", body.target_id)
          .eq("conversations.user_id", userId)
          .maybeSingle();
        if (!data) return NextResponse.json({ error: "target_not_found" }, { status: 404 });
      } else if (body.target_type === "interview_session") {
        const { data } = await supabase
          .from("interview_sessions")
          .select("id")
          .eq("id", body.target_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!data) return NextResponse.json({ error: "target_not_found" }, { status: 404 });
      } else if (body.target_type === "recommendation_occupation") {
        const [recommendationId, occupationId] = body.target_id.split(":");
        if (!recommendationId || !occupationId) {
          return NextResponse.json({ error: "target_not_found" }, { status: 404 });
        }
        const { data: recRow } = await supabase
          .from("recommendations")
          .select("id")
          .eq("id", recommendationId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!recRow) return NextResponse.json({ error: "target_not_found" }, { status: 404 });
        const occs = await loadAllOccupations();
        if (!occs.some((o) => o.id === occupationId)) {
          return NextResponse.json({ error: "target_not_found" }, { status: 404 });
        }
      }

      // 2. Current state lookup
      const { data: existing } = await supabase
        .from("feedback")
        .select("id, thumbs_value")
        .eq("user_id", userId)
        .eq("surface", body.surface)
        .eq("target_type", body.target_type)
        .eq("target_id", body.target_id)
        .not("thumbs_value", "is", null)
        .maybeSingle();

      // 3. No-op short-circuit if identical
      if (existing?.thumbs_value === body.thumbs_value) {
        return NextResponse.json({ ok: true, unchanged: true });
      }

      // 4. Three states: insert, update, delete (un-vote)
      if (body.thumbs_value === null) {
        if (existing) {
          await supabase.from("feedback").delete().eq("id", existing.id);
        }
        track("feedback_submitted", { kind: "thumb", surface: body.surface, value: "removed" });
      } else if (existing) {
        await supabase
          .from("feedback")
          .update({
            thumbs_value: body.thumbs_value,
            metadata: body.metadata ?? {},
          })
          .eq("id", existing.id);
        track("feedback_submitted", {
          kind: "thumb",
          surface: body.surface,
          value: body.thumbs_value === 1 ? "up" : "down",
        });
      } else {
        await supabase.from("feedback").insert({
          user_id: userId,
          surface: body.surface,
          target_type: body.target_type,
          target_id: body.target_id,
          thumbs_value: body.thumbs_value,
          metadata: body.metadata ?? {},
        });
        track("feedback_submitted", {
          kind: "thumb",
          surface: body.surface,
          value: body.thumbs_value === 1 ? "up" : "down",
        });
      }
    } else {
      // NPS path — handled in Task 9
      return NextResponse.json({ error: "not_implemented" }, { status: 501 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/feedback", kind: body.kind } });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run unit test again**

Run: `npx vitest run tests/unit/feedback/schema.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Write integration tests for thumb path**

```typescript
// tests/integration/feedback-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/feedback/route";
import { createServiceClient } from "@/lib/supabase/service";

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  npsBucket: (s: number) => (s <= 6 ? "detractor" : s <= 8 ? "passive" : "promoter"),
}));
vi.mock("@/lib/consent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/consent")>("@/lib/consent");
  return { ...actual, requireConsent: vi.fn().mockResolvedValue(undefined) };
});

import { track } from "@/lib/analytics";

async function makeReq(body: unknown): Promise<Request> {
  return new Request("http://test/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "cookie": `co_anon=test-${crypto.randomUUID()}` },
    body: JSON.stringify(body),
  });
}

async function setupTestUser(): Promise<{ userId: string; messageId: string; sessionId: string; recId: string }> {
  const supabase = createServiceClient();
  const { data: u } = await supabase.from("users").insert({ is_anonymous: true }).select("id").single();
  const userId = u!.id;
  const { data: c } = await supabase.from("conversations").insert({ user_id: userId, stage: "onboarding" }).select("id").single();
  const { data: m } = await supabase.from("messages").insert({ conversation_id: c!.id, role: "assistant", content: "hi" }).select("id").single();
  const { data: s } = await supabase.from("interview_sessions").insert({ user_id: userId, persona: "hr", target_role_he: "test" }).select("id").single();
  const { data: r } = await supabase.from("recommendations").insert({ user_id: userId, profile_hash: "test", rankings: [], paths: {}, prose: {} }).select("id").single();
  return { userId, messageId: m!.id, sessionId: s!.id, recId: r!.id };
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/feedback — thumb path", () => {
  it("identical thumb resubmit is a no-op (no DB write, no event)", async () => {
    const { userId, sessionId } = await setupTestUser();
    // First click
    await POST(await makeReq({
      kind: "thumb", surface: "interview", target_type: "interview_session",
      target_id: sessionId, thumbs_value: 1,
    }));
    (track as ReturnType<typeof vi.fn>).mockClear();
    // Second click identical
    const res2 = await POST(await makeReq({
      kind: "thumb", surface: "interview", target_type: "interview_session",
      target_id: sessionId, thumbs_value: 1,
    }));
    const body = await res2.json();
    expect(body.unchanged).toBe(true);
    expect(track).not.toHaveBeenCalled();
  });

  it("flip thumb up → down does UPDATE (still one row, new value)", async () => {
    const { sessionId } = await setupTestUser();
    await POST(await makeReq({
      kind: "thumb", surface: "interview", target_type: "interview_session",
      target_id: sessionId, thumbs_value: 1,
    }));
    await POST(await makeReq({
      kind: "thumb", surface: "interview", target_type: "interview_session",
      target_id: sessionId, thumbs_value: -1,
    }));
    const supabase = createServiceClient();
    const { count, data } = await supabase
      .from("feedback")
      .select("*", { count: "exact" })
      .eq("target_id", sessionId);
    expect(count).toBe(1);
    expect(data![0].thumbs_value).toBe(-1);
  });

  it("un-vote (null) DELETEs the row", async () => {
    const { sessionId } = await setupTestUser();
    await POST(await makeReq({
      kind: "thumb", surface: "interview", target_type: "interview_session",
      target_id: sessionId, thumbs_value: 1,
    }));
    await POST(await makeReq({
      kind: "thumb", surface: "interview", target_type: "interview_session",
      target_id: sessionId, thumbs_value: null,
    }));
    const supabase = createServiceClient();
    const { count } = await supabase.from("feedback").select("*", { count: "exact" }).eq("target_id", sessionId);
    expect(count).toBe(0);
  });

  it("target_not_found for foreign interview session", async () => {
    await setupTestUser();  // creates a real user
    const res = await POST(await makeReq({
      kind: "thumb", surface: "interview", target_type: "interview_session",
      target_id: crypto.randomUUID(),  // random UUID, not theirs
      thumbs_value: 1,
    }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run integration tests**

Run: `npx vitest run tests/integration/feedback-route.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 7: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```powershell
git add app/api/feedback/route.ts tests/unit/feedback/schema.test.ts tests/integration/feedback-route.test.ts
git commit -m "feat(api): POST /api/feedback — thumb path with ownership validation

Discriminated-union Zod body (kind: thumb|nps); consent-gated via
requireConsent (returns 403 on NoConsentError).

Thumb flow:
- Target ownership validated for message (JOIN conversations.user_id),
  interview_session (user_id direct), recommendation_occupation
  (split target_id on ':', verify recommendation_id ownership + catalog).
- SELECT current vote; no-op short-circuit if state matches.
- INSERT / UPDATE / DELETE based on incoming value.
- track('feedback_submitted', ...) fires AFTER DB write succeeds.

NPS path returns 501 (implemented in Task 9).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: NPS path in /api/feedback + /api/feedback/nps-dismiss

**Files:**
- Modify: `app/api/feedback/route.ts:115` (replace NPS 501 stub)
- Create: `app/api/feedback/nps-dismiss/route.ts`
- Modify: `tests/integration/feedback-route.test.ts` (append NPS tests)

- [ ] **Step 1: Replace the NPS stub in route.ts**

Open `app/api/feedback/route.ts`. Replace the line `// NPS path — handled in Task 9` and the next two lines with:

```typescript
} else {
  // NPS — append-only, guarded by feedback_one_nps_per_user_idx
  const { error } = await supabase.from("feedback").insert({
    user_id: userId,
    surface: "nps",
    nps_score: body.nps_score,
    nps_trigger: body.nps_trigger,
    comment_he: body.comment_he ?? null,
  });
  if (error && (error as { code?: string }).code === "23505") {
    // Already submitted; idempotent — treat as success
    return NextResponse.json({ ok: true, already: true });
  }
  if (error) throw error;

  await supabase
    .from("users")
    .update({ nps_submitted_at: new Date().toISOString() })
    .eq("id", userId)
    .is("nps_submitted_at", null);

  track("feedback_submitted", {
    kind: "nps",
    trigger: body.nps_trigger,
    bucket: npsBucket(body.nps_score),
  });
}
```

- [ ] **Step 2: Create nps-dismiss route**

```typescript
// app/api/feedback/nps-dismiss/route.ts
import { NextResponse } from "next/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { requireConsent, NoConsentError } from "@/lib/consent";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST() {
  let userId: string;
  try {
    userId = await getOrCreateAnonymousUserId();
    await requireConsent(userId);
  } catch (err) {
    if (err instanceof NoConsentError) {
      return NextResponse.json({ error: "consent_required" }, { status: 403 });
    }
    throw err;
  }

  const supabase = createServiceClient();
  await supabase
    .from("users")
    .update({ nps_dismissed_at: new Date().toISOString() })
    .eq("id", userId)
    .is("nps_dismissed_at", null);

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: Append NPS tests to feedback-route.test.ts**

Add after the last `it()` block in `describe("POST /api/feedback — thumb path", ...)`:

```typescript
describe("POST /api/feedback — NPS path", () => {
  it("first NPS submit writes a row and marks users.nps_submitted_at", async () => {
    const { userId } = await setupTestUser();
    const res = await POST(await makeReq({
      kind: "nps", nps_score: 9, nps_trigger: "pdf_download", comment_he: "מצוין",
    }));
    expect(res.status).toBe(200);
    const supabase = createServiceClient();
    const { data: rows } = await supabase.from("feedback").select("*").eq("user_id", userId);
    expect(rows).toHaveLength(1);
    expect(rows![0].nps_score).toBe(9);
    const { data: user } = await supabase.from("users").select("nps_submitted_at").eq("id", userId).single();
    expect(user!.nps_submitted_at).not.toBeNull();
  });

  it("double-submit returns idempotent {ok, already: true} (unique index)", async () => {
    await setupTestUser();
    await POST(await makeReq({
      kind: "nps", nps_score: 9, nps_trigger: "pdf_download",
    }));
    const res2 = await POST(await makeReq({
      kind: "nps", nps_score: 5, nps_trigger: "pdf_download",
    }));
    const body = await res2.json();
    expect(res2.status).toBe(200);
    expect(body.already).toBe(true);
  });
});
```

- [ ] **Step 4: Run integration tests**

Run: `npx vitest run tests/integration/feedback-route.test.ts`
Expected: PASS (6 cases total — 4 thumb + 2 NPS).

- [ ] **Step 5: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```powershell
git add app/api/feedback/route.ts app/api/feedback/nps-dismiss/route.ts tests/integration/feedback-route.test.ts
git commit -m "feat(api): NPS submission + dismissal endpoints

POST /api/feedback (kind: 'nps'):
- INSERT row; on 23505 unique violation return {ok, already: true}
- UPDATE users.nps_submitted_at (atomic, only when null)
- Emit feedback_submitted with bucket: detractor/passive/promoter

POST /api/feedback/nps-dismiss:
- UPDATE users.nps_dismissed_at; 204 No Content
- 403 on NoConsentError (edge case if consent revoked mid-flow)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: GET /api/admin/feedback/export

**Files:**
- Create: `app/api/admin/feedback/export/route.ts`
- Create: `tests/unit/feedback/csv-escape.test.ts`
- Create: `tests/integration/admin-export-route.test.ts`

- [ ] **Step 1: Write csv-escape unit test**

```typescript
// tests/unit/feedback/csv-escape.test.ts
import { describe, it, expect } from "vitest";
import { escapeCsv } from "@/app/api/admin/feedback/export/route";  // re-exported

describe("escapeCsv", () => {
  it("returns empty string for null/undefined", () => {
    expect(escapeCsv(null)).toBe("");
    expect(escapeCsv(undefined)).toBe("");
  });

  it("returns simple strings as-is", () => {
    expect(escapeCsv("hello")).toBe("hello");
    expect(escapeCsv("שלום")).toBe("שלום");
  });

  it("quotes values containing commas", () => {
    expect(escapeCsv("a, b")).toBe('"a, b"');
  });

  it("quotes values containing newlines", () => {
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });

  it("escapes embedded double quotes by doubling them", () => {
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
  });

  it("prefixes formula-injection chars with apostrophe", () => {
    expect(escapeCsv("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsv("+1+1")).toBe("'+1+1");
    expect(escapeCsv("-cmd")).toBe("'-cmd");
    expect(escapeCsv("@user")).toBe("'@user");
  });

  it("serializes objects as JSON", () => {
    expect(escapeCsv({ a: 1 })).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2: Run csv-escape test (expect FAIL)**

Run: `npx vitest run tests/unit/feedback/csv-escape.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create the admin export route**

```typescript
// app/api/admin/feedback/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const VALID_SURFACES = new Set(["chat", "recommendations", "interview", "nps"]);
const FORMULA_INJECTION = /^[=+\-@\t\r]/;

export function escapeCsv(v: unknown): string {
  if (v == null) return "";
  const raw = typeof v === "string" ? v : JSON.stringify(v);
  const safe = FORMULA_INJECTION.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function authOk(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.ADMIN_EXPORT_TOKEN;
  if (!token || !expected) return false;
  const tokenBuf = Buffer.from(token, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (tokenBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(tokenBuf, expectedBuf);
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return new NextResponse("unauthorized", { status: 401 });

  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const surface = url.searchParams.get("surface");

  if (since && Number.isNaN(new Date(since).getTime())) {
    return NextResponse.json({ error: "invalid_since" }, { status: 400 });
  }
  if (surface && !VALID_SURFACES.has(surface)) {
    return NextResponse.json({ error: "invalid_surface" }, { status: 400 });
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("feedback")
    .select("id, user_id, surface, target_type, target_id, thumbs_value, nps_score, nps_trigger, comment_he, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(10000);

  if (since) query = query.gte("created_at", since);
  if (surface) query = query.eq("surface", surface);

  const { data, error } = await query;
  if (error) return new NextResponse("query_failed", { status: 500 });

  const headers = ["id","user_id","surface","target_type","target_id","thumbs_value","nps_score","nps_trigger","comment_he","metadata","created_at"];
  const csv = [
    headers.join(","),
    ...(data ?? []).map((row) =>
      headers.map((h) => escapeCsv((row as Record<string, unknown>)[h])).join(",")
    ),
  ].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="feedback-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
```

- [ ] **Step 4: Run csv-escape test (expect PASS)**

Run: `npx vitest run tests/unit/feedback/csv-escape.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: Write the integration test**

```typescript
// tests/integration/admin-export-route.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { GET } from "@/app/api/admin/feedback/export/route";
import { createServiceClient } from "@/lib/supabase/service";

const TOKEN = "test-token-" + crypto.randomUUID();

beforeAll(() => {
  process.env.ADMIN_EXPORT_TOKEN = TOKEN;
});

function authReq(qs: string = ""): Request {
  return new Request(`http://test/api/admin/feedback/export${qs}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
}

describe("GET /api/admin/feedback/export", () => {
  it("returns 401 without token", async () => {
    const res = await GET(new Request("http://test/api/admin/feedback/export") as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const res = await GET(new Request("http://test/api/admin/feedback/export", {
      headers: { authorization: "Bearer wrong-token-different-length" },
    }) as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid since param", async () => {
    const res = await GET(authReq("?since=not-a-date") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid surface param", async () => {
    const res = await GET(authReq("?surface=bogus") as never);
    expect(res.status).toBe(400);
  });

  it("returns CSV with correct headers on auth + valid query", async () => {
    const res = await GET(authReq() as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("feedback-");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const text = await res.text();
    expect(text.split("\n")[0]).toBe("id,user_id,surface,target_type,target_id,thumbs_value,nps_score,nps_trigger,comment_he,metadata,created_at");
  });
});
```

- [ ] **Step 6: Run integration test**

Run: `npx vitest run tests/integration/admin-export-route.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 7: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```powershell
git add app/api/admin/feedback/export/route.ts tests/unit/feedback/csv-escape.test.ts tests/integration/admin-export-route.test.ts
git commit -m "feat(api): admin CSV export endpoint with Bearer auth

GET /api/admin/feedback/export — Bearer token via timingSafeEqual on
UTF-8 byte buffers (not string length, which breaks on non-ASCII).
Query params: since (ISO8601), surface (enum). 400 on invalid input.
Returns capped CSV (10k rows) with formula-injection guard, nosniff
header, no-store cache directive.

CSV escape helper handles: nulls, commas, newlines, embedded quotes,
formula injection (=/+/-/@/tab/CR-prefixed values get apostrophe).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: <Analytics /> in root layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Read current layout**

```powershell
type app\layout.tsx
```

Note the structure — where to insert `<Analytics />`.

- [ ] **Step 2: Add the import + component**

In `app/layout.tsx`:
- Add import: `import { Analytics } from "@vercel/analytics/next";`
- Add `<Analytics />` just before the closing `</body>` tag

- [ ] **Step 3: tsc + build**

Run:
```powershell
npx tsc --noEmit
npm run build
```
Expected: both clean.

- [ ] **Step 4: Commit**

```powershell
git add app/layout.tsx
git commit -m "feat(layout): mount <Analytics /> for pageview autotracking

Vercel Analytics autotracks pageviews when <Analytics /> renders in
the root layout. Custom events from the server use track() from
@vercel/analytics/server (Task 4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: <ThumbsRow> client component

**Files:**
- Create: `components/feedback/ThumbsRow.tsx`

- [ ] **Step 1: Create the component**

```typescript
// components/feedback/ThumbsRow.tsx
"use client";

import { useState, useTransition } from "react";
import { ThumbsUpIcon, ThumbsDownIcon } from "lucide-react";
import { he } from "@/lib/i18n/he";
import { cn } from "@/lib/utils";
import * as Sentry from "@sentry/nextjs";

type Props = {
  surface: "chat" | "recommendations" | "interview";
  targetType: "message" | "recommendation_occupation" | "interview_session";
  targetId: string;
  initialValue: -1 | 1 | null;
  className?: string;
  metadata?: Record<string, string | number | boolean>;
};

export function ThumbsRow({ surface, targetType, targetId, initialValue, className, metadata }: Props) {
  const [value, setValue] = useState<-1 | 1 | null>(initialValue);
  const [pending, startTransition] = useTransition();

  function vote(next: -1 | 1) {
    const desired = value === next ? null : next;
    const prev = value;
    setValue(desired);

    startTransition(async () => {
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "thumb",
            surface,
            target_type: targetType,
            target_id: targetId,
            thumbs_value: desired,
            metadata,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        setValue(prev);
        Sentry.captureException(err, { tags: { feature: "feedback_thumbs", surface } });
        if (process.env.NODE_ENV !== "production") console.error("[ThumbsRow] vote failed:", err);
      }
    });
  }

  return (
    <div className={cn("flex gap-1 items-center", className)}>
      <button
        type="button"
        onClick={() => vote(1)}
        aria-label={he.feedback.thumbs.upLabel}
        aria-pressed={value === 1}
        disabled={pending}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-md transition-opacity",
          "hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "disabled:opacity-50",
          value === 1 ? "opacity-100 text-primary" : "opacity-50"
        )}
      >
        <ThumbsUpIcon className={cn("h-5 w-5", value === 1 && "fill-current")} />
      </button>
      <button
        type="button"
        onClick={() => vote(-1)}
        aria-label={he.feedback.thumbs.downLabel}
        aria-pressed={value === -1}
        disabled={pending}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-md transition-opacity",
          "hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "disabled:opacity-50",
          value === -1 ? "opacity-100 text-destructive" : "opacity-50"
        )}
      >
        <ThumbsDownIcon className={cn("h-5 w-5", value === -1 && "fill-current")} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add components/feedback/ThumbsRow.tsx
git commit -m "feat(ui): <ThumbsRow> reusable thumbs feedback component

Client component used on recommendations + interview-wrap surfaces.
Click same vote = un-vote (DELETE); click opposite = flip (UPDATE);
first click = INSERT. Optimistic UI with silent rollback on network
failure; Sentry capture on error, no toast.

Selected state visually distinct via filled icon (fill-current) +
aria-pressed (not color alone) — meets WCAG 1.4.1.
44px touch targets (h-11 w-11) meet WCAG 2.5.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Modify /api/recommendations — add recommendation_id + thumbs to response

**Files:**
- Modify: `app/api/recommendations/route.ts`

The route currently returns `{ rankings, paths, prose, cached, generated_at }`. Add `recommendation_id` (the row id) and `thumbs` (Map of `${recommendation_id}:${occupation_id}` → -1|1) so the client can render initial thumb state without an extra fetch.

- [ ] **Step 1: Read current route**

```powershell
type app\api\recommendations\route.ts
```

Locate where the response object is constructed for both cache-hit and fresh paths.

- [ ] **Step 2: Add helper near the imports**

In `app/api/recommendations/route.ts`, after the existing imports add:

```typescript
async function loadThumbsForRecommendation(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  recommendationId: string,
): Promise<Record<string, -1 | 1>> {
  const { data } = await supabase
    .from("feedback")
    .select("target_id, thumbs_value")
    .eq("user_id", userId)
    .eq("surface", "recommendations")
    .eq("target_type", "recommendation_occupation")
    .like("target_id", `${recommendationId}:%`)
    .not("thumbs_value", "is", null);
  return Object.fromEntries(
    (data ?? [])
      .filter((r) => r.thumbs_value === 1 || r.thumbs_value === -1)
      .map((r) => [r.target_id, r.thumbs_value as -1 | 1])
  );
}
```

- [ ] **Step 3: Modify the cache-hit response**

Find the block where cache-hit returns the response (look for `getCached`). Add `recommendation_id` lookup + `thumbs` field to the response. The cache-hit path needs the recommendations row id, so adjust `getCached` to also return `id` — or do a separate query.

Simpler: add a `getCachedWithId` variant, OR query for the id alongside. The minimal change is one extra query inside the cache-hit branch:

```typescript
// After getCached returns a hit:
const { data: recRow } = await supabase
  .from("recommendations")
  .select("id")
  .eq("user_id", userId)
  .eq("profile_hash", profileHash)
  .order("generated_at", { ascending: false })
  .limit(1)
  .single();

const recommendationId = recRow!.id;
const thumbs = await loadThumbsForRecommendation(supabase, userId, recommendationId);

return NextResponse.json({
  rankings: cached.rankings,
  paths: cached.paths,
  prose: cached.prose,
  cached: true,
  generated_at: cached.generatedAt,
  recommendation_id: recommendationId,
  thumbs,
});
```

- [ ] **Step 4: Modify the fresh-compute response**

Find the block where a fresh recommendation is computed and saved via `saveRecommendation`. After `saveRecommendation`, fetch the just-inserted row's id (since saveRecommendation doesn't return it currently — option A: modify it to return; option B: re-query). Option B is the smaller change:

```typescript
await saveRecommendation({ userId, profileHash, rankings, paths, prose });

const { data: recRow } = await supabase
  .from("recommendations")
  .select("id")
  .eq("user_id", userId)
  .eq("profile_hash", profileHash)
  .order("generated_at", { ascending: false })
  .limit(1)
  .single();

const recommendationId = recRow!.id;
// Fresh recommendations have no thumbs yet (just created), so empty map
const thumbs: Record<string, -1 | 1> = {};

return NextResponse.json({
  rankings,
  paths,
  prose,
  cached: false,
  recommendation_id: recommendationId,
  thumbs,
});
```

- [ ] **Step 5: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Manual smoke test**

```powershell
npm run dev
```

In a separate terminal:
```powershell
curl -X POST http://localhost:3000/api/recommendations -H "cookie: co_anon=<your-anon-cookie>"
```

Expected: response includes `recommendation_id` (UUID) and `thumbs: {}`.

- [ ] **Step 7: Commit**

```powershell
git add app/api/recommendations/route.ts
git commit -m "feat(api): /api/recommendations now returns recommendation_id + thumbs map

Client needs both to render <ThumbsRow> initial state without an
extra roundtrip. thumbs is keyed by composite target_id format
\${recommendation_id}:\${occupation_id} matching what the feedback
route expects.

Cache-hit path queries recommendations.id; fresh-compute path
re-queries after saveRecommendation since the helper doesn't
return the inserted id.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Mount <ThumbsRow> in OccupationCard

**Files:**
- Modify: `components/recommendations/OccupationCard.tsx`
- Modify: `components/recommendations/RecommendationsClient.tsx`
- Modify: `components/recommendations/ThreePathsView.tsx` (or wherever OccupationCard is rendered)

- [ ] **Step 1: Inspect existing OccupationCard**

```powershell
type components\recommendations\OccupationCard.tsx
```

- [ ] **Step 2: Add props for thumbs to OccupationCard**

Add new props `recommendationId: string` and `initialThumb: -1 | 1 | null`. Render `<ThumbsRow>` at the bottom-left of the card:

```typescript
import { ThumbsRow } from "@/components/feedback/ThumbsRow";

// In the props type, add:
// recommendationId: string;
// initialThumb: -1 | 1 | null;

// In the render, at the bottom of the card body:
<div className="mt-4 flex justify-between items-end">
  <ThumbsRow
    surface="recommendations"
    targetType="recommendation_occupation"
    targetId={`${recommendationId}:${occupation.id}`}
    initialValue={initialThumb}
    metadata={{ recommendation_id: recommendationId }}
  />
  {/* existing right-side content (e.g., "view details" button) stays */}
</div>
```

- [ ] **Step 3: Pass props through from RecommendationsClient**

In `RecommendationsClient.tsx`, the `data` state already has `recommendation_id` and `thumbs` from Task 13. Update the component tree so each `<OccupationCard>` gets:

```typescript
<OccupationCard
  occupation={...}
  /* existing props */
  recommendationId={data.recommendation_id}
  initialThumb={data.thumbs[`${data.recommendation_id}:${occupation.id}`] ?? null}
/>
```

Update the `ApiResponse` type in RecommendationsClient to include the new fields:

```typescript
type ApiResponse = {
  rankings: Ranking[];
  paths: Paths;
  prose: Record<string, string>;
  cached: boolean;
  generated_at?: string;
  recommendation_id: string;     // ← new
  thumbs: Record<string, -1 | 1>; // ← new
  error?: string;
};
```

- [ ] **Step 4: If ThreePathsView (or another intermediate component) renders OccupationCard, thread the new props through**

Locate the rendering point and pass `recommendationId` + `thumbsMap` down. The intermediate component can take `thumbsMap` and derive per-card `initialThumb` itself.

- [ ] **Step 5: tsc + build**

```powershell
npx tsc --noEmit
npm run build
```
Expected: both clean.

- [ ] **Step 6: Manual browser smoke test**

```powershell
npm run dev
```

Visit http://localhost:3000/recommendations. After recommendations load, verify thumbs appear under each occupation card and clicking persists across reload.

- [ ] **Step 7: Commit**

```powershell
git add components/recommendations/OccupationCard.tsx components/recommendations/RecommendationsClient.tsx components/recommendations/ThreePathsView.tsx
git commit -m "feat(ui): mount <ThumbsRow> on per-occupation recommendation cards

ThumbsRow uses composite target_id (\${recommendation_id}:\${occupation_id})
so thumbs are about this specific recommendation, not the abstract
occupation. Initial values flow from /api/recommendations response;
no extra roundtrip on mount.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Mount <ThumbsRow> on interview-wrap + SSR hydration

**Files:**
- Modify: `app/(app)/interview/[sessionId]/page.tsx`
- Modify: `components/interview/WrapUpScreen.tsx`

- [ ] **Step 1: Read both files**

```powershell
type app\(app)\interview\[sessionId]\page.tsx
type components\interview\WrapUpScreen.tsx
```

- [ ] **Step 2: Add SSR hydration to the page**

In the server component for `/interview/[sessionId]`:

```typescript
import { getUserFeedbackForTargets } from "@/lib/db/feedback";

// Inside the async function, after resolving userId + sessionId:
const thumbsMap = await getUserFeedbackForTargets(userId, [
  { type: "interview_session", id: sessionId },
]);
const initialInterviewThumb =
  thumbsMap.get(`interview_session:${sessionId}`) ?? null;

// Pass to WrapUpScreen:
<WrapUpScreen
  session={session}
  initialThumb={initialInterviewThumb}
/>
```

- [ ] **Step 3: Add ThumbsRow to WrapUpScreen**

In `WrapUpScreen.tsx`:

```typescript
import { ThumbsRow } from "@/components/feedback/ThumbsRow";

// Add to props:
type Props = {
  session: InterviewSession;
  initialThumb: -1 | 1 | null;
};

// At the bottom of the feedback section (after improvements/next-focus):
<div className="mt-6">
  <ThumbsRow
    surface="interview"
    targetType="interview_session"
    targetId={session.id}
    initialValue={initialThumb}
  />
</div>
```

- [ ] **Step 4: tsc + build**

```powershell
npx tsc --noEmit
npm run build
```
Expected: both clean.

- [ ] **Step 5: Manual smoke test**

Complete an interview session (or open an existing completed one); verify thumbs render in the wrap-up screen and persist across reload.

- [ ] **Step 6: Commit**

```powershell
git add app/(app)/interview/[sessionId]/page.tsx components/interview/WrapUpScreen.tsx
git commit -m "feat(ui): mount <ThumbsRow> on interview wrap-up screen

SSR hydration via getUserFeedbackForTargets in the page server
component — interview-wrap data is server-rendered anyway, so the
SSR helper avoids a client roundtrip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: <NpsPrompt> client component

**Files:**
- Create: `components/feedback/NpsPrompt.tsx`

- [ ] **Step 1: Create the component**

```typescript
// components/feedback/NpsPrompt.tsx
"use client";

import { useState, useTransition } from "react";
import { he } from "@/lib/i18n/he";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { XIcon } from "lucide-react";

type Props = {
  trigger: "pdf_download" | "plan_generated" | "interview_completed";
};

export function NpsPrompt({ trigger }: Props) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  function submit() {
    if (score === null) return;
    startTransition(async () => {
      try {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "nps",
            nps_score: score,
            nps_trigger: trigger,
            comment_he: comment.trim() || null,
          }),
        });
        setHidden(true);
      } catch {
        // Silent fail; let the user retry next page load.
      }
    });
  }

  function dismiss() {
    setHidden(true);
    void fetch("/api/feedback/nps-dismiss", { method: "POST" });
  }

  return (
    <Card className="relative p-6 mb-6 border-primary/30">
      <button
        type="button"
        onClick={dismiss}
        aria-label={he.feedback.nps.dismissLabel}
        className="absolute top-3 end-3 inline-flex h-11 w-11 items-center justify-center rounded-md
                   text-muted-foreground hover:text-foreground
                   focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <XIcon className="h-5 w-5" />
      </button>

      <h3 className="text-lg font-semibold mb-2">{he.feedback.nps.title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{he.feedback.nps.subtitle}</p>

      <div
        role="radiogroup"
        aria-label={he.feedback.nps.scaleLabel}
        className="grid grid-cols-6 gap-2 sm:grid-cols-11 mb-4"
      >
        {Array.from({ length: 11 }, (_, i) => i).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            onClick={() => setScore(n)}
            disabled={pending}
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-md text-sm font-medium",
              "border transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              score === n
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent border-input"
            )}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="flex justify-between text-xs text-muted-foreground mb-4">
        <span>{he.feedback.nps.scaleMin}</span>
        <span>{he.feedback.nps.scaleMax}</span>
      </div>

      {score !== null && (
        <div className="space-y-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            placeholder={he.feedback.nps.commentPlaceholder}
            className="min-h-[80px]"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={dismiss} disabled={pending}>
              {he.feedback.nps.skipButton}
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? he.feedback.nps.submitting : he.feedback.nps.submitButton}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add components/feedback/NpsPrompt.tsx
git commit -m "feat(ui): <NpsPrompt> inline NPS prompt card

ARIA radiogroup pattern (role='radiogroup' + role='radio' + aria-checked).
Grid layout wraps to 2 rows on mobile (grid-cols-6 → sm:grid-cols-11).
Comment textarea slides in after score selection (motion-safe).
Dismiss button (XIcon) sits in top-end (RTL-safe logical property).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Mount <NpsPrompt> on three pages

**Files:**
- Modify: `app/(app)/recommendations/page.tsx`
- Modify: `app/(app)/plan/page.tsx`
- Modify: `app/(app)/interview/[sessionId]/page.tsx`

- [ ] **Step 1: Add NPS prompt to recommendations page**

In `app/(app)/recommendations/page.tsx`:

```typescript
import { getNpsEligibility } from "@/lib/db/nps";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { NpsPrompt } from "@/components/feedback/NpsPrompt";

export default async function RecommendationsPage() {
  const occupations = await loadAllOccupations();
  const userId = await getOrCreateAnonymousUserId();
  const eligibility = await getNpsEligibility(userId);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {eligibility.show && eligibility.trigger && (
        <NpsPrompt trigger={eligibility.trigger} />
      )}
      <header className="mb-6 space-y-1">
        {/* existing header */}
      </header>
      <RecommendationsClient occupations={occupations} />
    </div>
  );
}
```

- [ ] **Step 2: Same pattern for plan and interview pages**

Apply the same `getNpsEligibility(userId)` + conditional `<NpsPrompt>` render to:
- `app/(app)/plan/page.tsx`
- `app/(app)/interview/[sessionId]/page.tsx`

- [ ] **Step 3: tsc + build**

```powershell
npx tsc --noEmit
npm run build
```
Expected: both clean.

- [ ] **Step 4: Commit**

```powershell
git add app/(app)/recommendations/page.tsx app/(app)/plan/page.tsx app/(app)/interview/[sessionId]/page.tsx
git commit -m "feat(ui): render <NpsPrompt> on three value-delivery pages

Eligibility checked server-side via getNpsEligibility(userId). Prompt
renders iff eligibility.show (nps_eligibility_first_at IS NOT NULL
AND submitted_at IS NULL AND dismissed_at IS NULL).

PDF download → next page load shows the prompt (PDF response doesn't
trigger re-render). Plan + interview pages render the prompt on the
same screen because those flows naturally re-render after their
trigger event.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Event wiring — chat (conversation_started)

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Read current chat route**

```powershell
type app\api\chat\route.ts
```

Find where the conversation/message is loaded and where the first user-message persistence happens.

- [ ] **Step 2: Capture message_count before persistence**

Add inside the route, just before the call that loads conversation:

```typescript
import { track } from "@/lib/analytics";

// After loading the conversation row (which has message_count):
const wasFirstMessage = conversation.message_count === 0;

// ... existing logic ...

// After the streamLlmTurn call (or after the assistant-finish persistence):
if (wasFirstMessage) {
  track("conversation_started", { surface: "chat" });
}
```

- [ ] **Step 3: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```powershell
git add app/api/chat/route.ts
git commit -m "feat(analytics): emit conversation_started on first chat message

Captures message_count === 0 from the conversation row BEFORE the
user message is persisted (the increment happens inside streamLlmTurn).
Emits exactly once per conversation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Event wiring — assessment + CV

**Files:**
- Modify: `app/api/assessment/submit/route.ts`
- Modify: `app/api/cv/confirm/route.ts`

- [ ] **Step 1: Add assessment_completed**

In `app/api/assessment/submit/route.ts`, after the successful insert:

```typescript
import { track } from "@/lib/analytics";

// After insert succeeds:
track("assessment_completed", { type: body.type });
```

- [ ] **Step 2: Add cv_uploaded**

In `app/api/cv/confirm/route.ts`, after `mergeCvSkillsIntoLatestProfile` succeeds:

```typescript
import { track, skillCountBucket } from "@/lib/analytics";
import { inferArchetype } from "@/lib/cv/archetype";

// After successful merge:
const archetype = inferArchetype(confirmedSkills);  // confirmedSkills is the array passed in
track("cv_uploaded", {
  skill_count_bucket: skillCountBucket(confirmedSkills.length),
  archetype,
});
```

- [ ] **Step 3: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```powershell
git add app/api/assessment/submit/route.ts app/api/cv/confirm/route.ts
git commit -m "feat(analytics): emit assessment_completed + cv_uploaded events

assessment_completed: type is the assessment kind (riasec/big5/values/
constraints) — low cardinality, finite enum.

cv_uploaded: skill_count_bucket reduces 0..N to 4 buckets; archetype
comes from the existing inferArchetype helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: Event wiring — recommendations_generated

**Files:**
- Modify: `app/api/recommendations/route.ts`

- [ ] **Step 1: Add the event emission**

In `app/api/recommendations/route.ts`, after the recommendations data is ready (both cache-hit and fresh paths). The `ranking` object has `weights_used` from which we derive `dimension_count`:

```typescript
import { track } from "@/lib/analytics";

// Common helper near top of file:
function dimensionCount(weightsUsed: Record<string, number>): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return Object.keys(weightsUsed).length as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

// In both cache-hit and fresh paths, after the ranking is determined:
track("recommendations_generated", {
  cache_hit: cached !== null,
  dimension_count: dimensionCount(ranking.weights_used),
});
```

- [ ] **Step 2: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add app/api/recommendations/route.ts
git commit -m "feat(analytics): emit recommendations_generated event

cache_hit: boolean — tells us whether the cache layer is paying off.
dimension_count: 0..6 — how many of the 6 matching dimensions had
data. Low number → user hasn't completed many assessments → matcher
is operating on sparse signal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: Event wiring — report_downloaded + NPS eligibility

**Files:**
- Modify: `app/api/report/pdf/route.ts`

- [ ] **Step 1: Add atomic is_first + event emission + NPS eligibility**

In `app/api/report/pdf/route.ts`, after PDF render succeeds (and BEFORE returning the response, since `after()` runs after the response anyway):

```typescript
import { track } from "@/lib/analytics";
import { markNpsEligibilityIfFirst } from "@/lib/db/nps";

// After successful PDF render, before constructing the Response:
const { data: affectedRows, error: updateErr } = await supabase
  .from("users")
  .update({ first_report_downloaded_at: new Date().toISOString() })
  .eq("id", userId)
  .is("first_report_downloaded_at", null)
  .select("id");

const isFirst = !updateErr && (affectedRows?.length ?? 0) === 1;
track("report_downloaded", { is_first: isFirst });

if (isFirst) {
  await markNpsEligibilityIfFirst(userId, "pdf_download");
}
```

- [ ] **Step 2: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add app/api/report/pdf/route.ts
git commit -m "feat(analytics): report_downloaded + NPS eligibility on PDF download

Atomic is_first detection via guarded UPDATE returning affected rows:
two concurrent downloads from the same user race against Postgres,
not in app code. Only the first one sees affected.length === 1.

On first download, also marks NPS eligibility with trigger=pdf_download
(first-trigger-wins, so this is no-op if user has already completed
interview or plan).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: Event wiring — plan_generated + NPS eligibility

**Files:**
- Modify: `app/api/plan/generate/route.ts`

- [ ] **Step 1: Add the event emission + NPS eligibility**

In `app/api/plan/generate/route.ts`, after the plan + tasks insert succeeds:

```typescript
import { track } from "@/lib/analytics";
import { markNpsEligibilityIfFirst } from "@/lib/db/nps";

// After plan + tasks insert succeeds:
track("plan_generated", { archetype: plan.archetype });
await markNpsEligibilityIfFirst(userId, "plan_generated");
```

- [ ] **Step 2: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add app/api/plan/generate/route.ts
git commit -m "feat(analytics): plan_generated event + NPS eligibility marker

Marks NPS eligibility (first-trigger-wins) so users who skip PDF
but generate a plan still see the NPS prompt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 23: Refactor toggleTaskDone — preserve ownership + transition-only emit

**Files:**
- Modify: `lib/db/plans.ts`
- Modify: `app/api/plan/tasks/[id]/toggle/route.ts`
- Create: `tests/integration/plan-task-transition.test.ts`

- [ ] **Step 1: Write the integration test FIRST**

```typescript
// tests/integration/plan-task-transition.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toggleTaskDone, ForbiddenError } from "@/lib/db/plans";
import { createServiceClient } from "@/lib/supabase/service";

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  npsBucket: (s: number) => (s <= 6 ? "detractor" : s <= 8 ? "passive" : "promoter"),
  questionCountBucket: vi.fn(),
  skillCountBucket: vi.fn(),
}));
import { track } from "@/lib/analytics";

async function setupOwnedTask(): Promise<{ userId: string; taskId: string }> {
  const s = createServiceClient();
  const { data: u } = await s.from("users").insert({ is_anonymous: true }).select("id").single();
  const { data: r } = await s.from("recommendations").insert({ user_id: u!.id, profile_hash: "test", rankings: [], paths: {}, prose: {} }).select("id").single();
  const { data: p } = await s.from("plans").insert({ user_id: u!.id, recommendation_id: r!.id, archetype: "apply" }).select("id").single();
  const { data: t } = await s.from("plan_tasks").insert({ plan_id: p!.id, day: 5, title_he: "test", description_he: "test", category: "action", estimated_minutes: 30, done: false }).select("id").single();
  return { userId: u!.id, taskId: t!.id };
}

beforeEach(() => vi.clearAllMocks());

describe("toggleTaskDone", () => {
  it("false→true emits plan_task_completed with category+week", async () => {
    const { userId, taskId } = await setupOwnedTask();
    await toggleTaskDone(userId, taskId, true);
    expect(track).toHaveBeenCalledWith("plan_task_completed", {
      category: "action",
      week: 1, // day 5 → week 1
    });
  });

  it("true→true is a no-op (no event)", async () => {
    const { userId, taskId } = await setupOwnedTask();
    await toggleTaskDone(userId, taskId, true);
    (track as ReturnType<typeof vi.fn>).mockClear();
    await toggleTaskDone(userId, taskId, true);
    expect(track).not.toHaveBeenCalled();
  });

  it("true→false un-toggles, no event", async () => {
    const { userId, taskId } = await setupOwnedTask();
    await toggleTaskDone(userId, taskId, true);
    (track as ReturnType<typeof vi.fn>).mockClear();
    await toggleTaskDone(userId, taskId, false);
    expect(track).not.toHaveBeenCalled();
  });

  it("cross-user mutation throws ForbiddenError", async () => {
    const { taskId } = await setupOwnedTask();
    const s = createServiceClient();
    const { data: otherUser } = await s.from("users").insert({ is_anonymous: true }).select("id").single();
    await expect(toggleTaskDone(otherUser!.id, taskId, true)).rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run test (expect FAIL — function signature wrong)**

Run: `npx vitest run tests/integration/plan-task-transition.test.ts`
Expected: FAIL — current `toggleTaskDone` signature/behavior doesn't match.

- [ ] **Step 3: Refactor lib/db/plans.ts**

Inspect current `toggleTaskDone` in `lib/db/plans.ts`. Replace it with:

```typescript
// lib/db/plans.ts
import { track, type PlanTaskCategory } from "@/lib/analytics";

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function toggleTaskDone(
  userId: string,
  taskId: string,
  done: boolean
): Promise<void> {
  const supabase = createServiceClient();

  // Ownership check via plans.user_id JOIN — preserves Phase 5b RLS pattern
  const { data: owned } = await supabase
    .from("plan_tasks")
    .select("id, plans!inner(user_id)")
    .eq("id", taskId)
    .eq("plans.user_id", userId)
    .maybeSingle();
  if (!owned) throw new ForbiddenError();

  if (done) {
    // Guarded UPDATE — only fires event if state actually transitioned
    const { data } = await supabase
      .from("plan_tasks")
      .update({ done: true, done_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("done", false)
      .select("category, day")
      .maybeSingle();
    if (data) {
      track("plan_task_completed", {
        category: data.category as PlanTaskCategory,
        week: Math.ceil(data.day / 7) as 1 | 2 | 3 | 4 | 5,
      });
    }
  } else {
    await supabase
      .from("plan_tasks")
      .update({ done: false, done_at: null })
      .eq("id", taskId)
      .eq("done", true);
  }
}
```

- [ ] **Step 4: Update the toggle route to use new signature**

In `app/api/plan/tasks/[id]/toggle/route.ts`, ensure it calls `toggleTaskDone(userId, taskId, done)` and handles `ForbiddenError` with a 403:

```typescript
import { toggleTaskDone, ForbiddenError } from "@/lib/db/plans";

// In the POST handler:
try {
  await toggleTaskDone(userId, taskId, done);
  return NextResponse.json({ ok: true });
} catch (err) {
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  throw err;
}
```

- [ ] **Step 5: Run test again**

Run: `npx vitest run tests/integration/plan-task-transition.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 6: tsc + full vitest run**

```powershell
npx tsc --noEmit
npm test
```
Expected: 0 tsc errors; all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add lib/db/plans.ts app/api/plan/tasks/[id]/toggle/route.ts tests/integration/plan-task-transition.test.ts
git commit -m "refactor(plans): toggleTaskDone — ownership check + transition-only event

Guarded UPDATE with RETURNING (WHERE done = false) ensures
plan_task_completed event fires only on state transition false→true,
not on re-toggles. Ownership preserved via plans.user_id JOIN.

ForbiddenError class added so the route can map to 403.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 24: Event wiring — interview_started + interview_completed (in completeInterviewSession)

**Files:**
- Modify: `lib/db/interview.ts`
- Modify: `app/api/interview/route.ts`
- Create: `tests/unit/db/interview-transition.test.ts`

- [ ] **Step 1: Add interview_started in /api/interview**

In `app/api/interview/route.ts`, after the interview_sessions INSERT succeeds:

```typescript
import { track } from "@/lib/analytics";

// After successful session insert:
track("interview_started", { persona: session.persona });
```

- [ ] **Step 2: Write the transition test**

```typescript
// tests/unit/db/interview-transition.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  npsBucket: vi.fn(),
  questionCountBucket: (n: number) => (n <= 4 ? "1-4" : n <= 8 ? "5-8" : "9+"),
  skillCountBucket: vi.fn(),
}));
vi.mock("@/lib/db/nps", () => ({ markNpsEligibilityIfFirst: vi.fn() }));

const updateChain = {
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({ update: () => updateChain }),
  }),
}));

import { completeInterviewSession } from "@/lib/db/interview";
import { track } from "@/lib/analytics";
import { markNpsEligibilityIfFirst } from "@/lib/db/nps";

beforeEach(() => vi.clearAllMocks());

describe("completeInterviewSession — transition-only emit", () => {
  it("emits interview_completed when row was transitioned", async () => {
    updateChain.maybeSingle.mockResolvedValue({
      data: { user_id: "u-1", persona: "hr", question_count: 7, forced_wrap: false },
      error: null,
    });
    await completeInterviewSession("s-1", {
      summary_he: "x", strengths_he: "x", improvements_he: "x",
      next_practice_focus_he: "x", per_question: [], forcedWrap: false,
    } as never);
    expect(track).toHaveBeenCalledWith("interview_completed", {
      persona: "hr",
      forced_wrap: false,
      question_count_bucket: "5-8",
    });
    expect(markNpsEligibilityIfFirst).toHaveBeenCalledWith("u-1", "interview_completed");
  });

  it("no event when re-called on already-completed session", async () => {
    updateChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    await completeInterviewSession("s-1", {
      summary_he: "x", strengths_he: "x", improvements_he: "x",
      next_practice_focus_he: "x", per_question: [], forcedWrap: false,
    } as never);
    expect(track).not.toHaveBeenCalled();
    expect(markNpsEligibilityIfFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test (expect FAIL — function shape doesn't match)**

Run: `npx vitest run tests/unit/db/interview-transition.test.ts`
Expected: FAIL.

- [ ] **Step 4: Refactor completeInterviewSession in lib/db/interview.ts**

```typescript
// lib/db/interview.ts — completeInterviewSession updated
import { track, questionCountBucket, type InterviewPersona } from "@/lib/analytics";
import { markNpsEligibilityIfFirst } from "@/lib/db/nps";

export async function completeInterviewSession(
  sessionId: string,
  payload: {
    summary_he: string;
    strengths_he: string;
    improvements_he: string;
    next_practice_focus_he: string;
    per_question: unknown;
    forcedWrap?: boolean;
  }
): Promise<void> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("interview_sessions")
    .update({
      completed_at: new Date().toISOString(),
      feedback_summary_he: payload.summary_he,
      feedback_strengths_he: payload.strengths_he,
      feedback_improvements_he: payload.improvements_he,
      feedback_next_practice_focus_he: payload.next_practice_focus_he,
      feedback_per_question: payload.per_question,
      forced_wrap: payload.forcedWrap ?? false,
    })
    .eq("id", sessionId)
    .is("completed_at", null)
    .select("user_id, persona, question_count, forced_wrap")
    .maybeSingle();

  if (error) throw new Error(`completeInterviewSession: ${error.message}`);

  if (data) {
    track("interview_completed", {
      persona: data.persona as InterviewPersona,
      forced_wrap: data.forced_wrap ?? false,
      question_count_bucket: questionCountBucket(data.question_count),
    });
    await markNpsEligibilityIfFirst(data.user_id, "interview_completed");
  }
}
```

- [ ] **Step 5: Run test again**

Run: `npx vitest run tests/unit/db/interview-transition.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 6: tsc + full test suite**

```powershell
npx tsc --noEmit
npm test
```
Expected: 0 errors; all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add lib/db/interview.ts app/api/interview/route.ts tests/unit/db/interview-transition.test.ts
git commit -m "feat(analytics): interview_started + transition-only interview_completed

interview_started: emitted from /api/interview after session INSERT.

interview_completed: moved INSIDE completeInterviewSession() (was on
the route) so it fires once regardless of normal/repair/force-wrap
path. Guarded UPDATE WHERE completed_at IS NULL with RETURNING
guarantees no double-emit on re-call.

Also marks NPS eligibility (first-trigger-wins).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 25: Extend scripts/verify-all-surfaces.mjs

**Files:**
- Modify: `scripts/verify-all-surfaces.mjs`

- [ ] **Step 1: Read the existing script**

```powershell
type scripts\verify-all-surfaces.mjs
```

Understand: how surfaces are added, how axe is invoked, how viewports are iterated.

- [ ] **Step 2: Add thumbs interaction check after recommendations load**

In the recommendations surface section, after the page loads and recommendations are visible, add:

```javascript
// Verify <ThumbsRow> renders next to each occupation card
const thumbButtons = await page.getByRole("button", { name: /תגובה (חיובית|שלילית)/ }).count();
if (thumbButtons < 2) {
  throw new Error(`recommendations: expected thumbs buttons, found ${thumbButtons}`);
}

// Optional: click one and verify aria-pressed flips
const firstUp = page.getByRole("button", { name: /תגובה חיובית/ }).first();
await firstUp.click();
await page.waitForLoadState("networkidle");
const pressed = await firstUp.getAttribute("aria-pressed");
if (pressed !== "true") throw new Error("thumbs up did not toggle aria-pressed");
```

- [ ] **Step 3: Add NPS prompt check (when eligibility is forced)**

Add a separate sub-surface for forced-NPS:

```javascript
// New surface: recommendations with forced NPS eligibility
// Force eligibility via service-role SQL fixture before navigation:
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
await supa.from("users").update({
  nps_eligibility_first_at: new Date().toISOString(),
  nps_trigger_first: "pdf_download",
}).eq("id", testUserId);

// Then navigate /recommendations and verify the prompt mounts
await page.goto(`${BASE_URL}/recommendations`);
const radios = await page.getByRole("radio").count();
if (radios !== 11) throw new Error(`NPS: expected 11 radio buttons, found ${radios}`);
```

- [ ] **Step 4: Add admin export check**

```javascript
// New surface: GET /api/admin/feedback/export
const adminRes = await page.request.get(`${BASE_URL}/api/admin/feedback/export`, {
  headers: { Authorization: `Bearer ${process.env.ADMIN_EXPORT_TOKEN}` },
});
if (adminRes.status() !== 200) throw new Error(`admin export: status ${adminRes.status()}`);
const csv = await adminRes.text();
if (!csv.startsWith("id,user_id,surface,")) throw new Error("admin export: bad CSV header");

// 401 without auth
const noAuthRes = await page.request.get(`${BASE_URL}/api/admin/feedback/export`);
if (noAuthRes.status() !== 401) throw new Error(`admin export no-auth: expected 401, got ${noAuthRes.status()}`);
```

- [ ] **Step 5: Run the sweep**

```powershell
node scripts/verify-all-surfaces.mjs
```
Expected: all surfaces pass, 0 critical/serious axe violations.

- [ ] **Step 6: Commit**

```powershell
git add scripts/verify-all-surfaces.mjs
git commit -m "test(e2e): extend verify-all-surfaces with thumbs + NPS + admin export

Adds: thumbs interaction on recommendations (verify mount + aria-pressed
toggle), NPS prompt rendering (force eligibility via SQL fixture, verify
11 radio buttons), admin export endpoint (Bearer auth + CSV header
check + 401 without token).

All checks run across 375/768/1280 viewports; axe-core continues to
verify 0 critical/serious violations across all surfaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 26: Final gates + CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run all gates**

```powershell
npx tsc --noEmit
npm test
npm run build
node scripts/verify-all-surfaces.mjs
```
Expected: all 4 green.

- [ ] **Step 2: Manual browser smoke checklist**

Open `npm run dev`, then in browser:

- [ ] Thumb up an occupation on /recommendations → reload → vote persists
- [ ] Thumb up an interview wrap-up → reload → vote persists
- [ ] Generate a plan → /plan shows NPS prompt → submit score 9 → prompt disappears
- [ ] Reload /plan → prompt does NOT reappear
- [ ] Open Supabase Studio → confirm `feedback` rows for both surfaces + NPS

- [ ] **Step 3: Pull a test CSV export**

```powershell
$env:ADMIN_EXPORT_TOKEN = "<token from .env.local>"
curl -H "Authorization: Bearer $env:ADMIN_EXPORT_TOKEN" `
     "http://localhost:3000/api/admin/feedback/export" `
     -o feedback-test.csv
```
Verify: CSV has rows from your test session, Hebrew renders correctly when opened in a UTF-8-aware editor (NOT Excel default — Excel mangles Hebrew without BOM).

- [ ] **Step 4: Append Phase 6b section to CLAUDE.md**

In `CLAUDE.md`, after the Phase 6c section, add:

```markdown
## Phase 6b architecture (feedback + analytics)

Two telemetry layers: rich per-user analysis in Supabase (`feedback` table + joins), aggregate counters in Vercel Analytics (typed `lib/analytics.ts` allowlist, no user_id, no free text).

- **`feedback` table** (single source of truth): one row per thumb or NPS submission. Discriminator via `surface` enum + `thumbs_value` / `nps_score` columns with `feedback_exactly_one_signal` CHECK. Partial unique indexes enforce "one current thumb per (user, target)" and "one NPS per user." `metadata` JSONB is the additive escape hatch.
- **Thumbs surfaces**: recommendations (composite `target_id = ${recommendation_id}:${occupation_id}` — thumb is about THIS prose, not the abstract occupation) and interview-wrap. Chat thumbs deferred to Phase 6b.5 (requires `streamText({ messageMetadata })` protocol change to ride persisted DB id through the stream).
- **NPS one-shot per user**, triggered by first of {PDF download, plan generated, interview completed}. State machine in `users` columns: `nps_eligibility_first_at`, `nps_submitted_at`, `nps_dismissed_at`, `nps_trigger_first`. Prompt renders iff `eligibility.show` (all server-side check).
- **`lib/analytics.ts`** uses `after()` from `next/server` for fire-and-forget delivery (NOT `waitUntil()` — `after()` is the Next 15.1+ framework-native primitive). `EventName` union + `EventPropsMap` per-event prop type enforce no-PII at compile time.
- **Atomic-transition pattern** used across 5 events for correctness: `is_first` for report download, NPS eligibility, NPS dismissal, interview completion, plan task transition. Always guarded UPDATE with RETURNING in one statement — no race window, no double-emit.
- **Admin CSV export**: `GET /api/admin/feedback/export` Bearer-token via `timingSafeEqual` on UTF-8 byte buffers. Capped at 10k rows. CSV escape includes formula-injection guard (`=`, `+`, `-`, `@`, tab, CR prefixed with `'`). `x-content-type-options: nosniff`.

Architectural rule: any new mutation route that produces an analytics event MUST call `track()` from `lib/analytics.ts`, NOT `@vercel/analytics/server` directly. The wrapper is the single PII gate. Any new feedback-row mutation MUST go through `POST /api/feedback` with the discriminated-union Zod schema; never write directly from other routes.
```

- [ ] **Step 5: Commit + create PR**

```powershell
git add CLAUDE.md
git commit -m "docs(claude.md): document Phase 6b architecture

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

# Create feature branch + push
git checkout -b feat/phase-6b-feedback-and-analytics
git push -u origin feat/phase-6b-feedback-and-analytics

# Open PR
gh pr create --title "feat(6b): feedback + analytics infrastructure" --body "$(cat <<'EOF'
## Summary
- Adds Supabase `feedback` table as source of truth for thumbs + NPS rows
- Mounts `<ThumbsRow>` on recommendations (per-occupation prose) and interview-wrap; chat thumbs deferred to 6b.5
- One-shot `<NpsPrompt>` triggered by first value-delivery moment (PDF / plan / interview)
- Typed `lib/analytics.ts` wrapper around Vercel Analytics — no user_id, no free text, compile-time enforcement
- Admin CSV export at `GET /api/admin/feedback/export` (Bearer token)
- Event-wiring across 8 existing routes using guarded-UPDATE-with-RETURNING for atomic transitions
- Defers `account_saved` event (no reliable promotion signal) and chat thumbs (requires AI SDK protocol change)

## Test plan
- [x] `npx tsc --noEmit` clean
- [x] `npm test` green (all new + all existing)
- [x] `npm run build` clean
- [x] `node scripts/verify-all-surfaces.mjs` — 0 critical/serious axe violations across 3 viewports
- [x] Manual: thumbs persist across reload on recs + interview-wrap
- [x] Manual: NPS prompt appears after first plan/PDF/interview, disappears on submit, does NOT re-appear
- [x] Manual: CSV export returns valid Hebrew-safe CSV behind Bearer auth
- [ ] After merge: verify `feedback_submitted` event visible in Vercel Analytics within 1 min of test action (deployed only)
- [ ] After merge: set `ADMIN_EXPORT_TOKEN` in Vercel project env vars

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Verify PR opened**

PR URL should be printed. Open in browser, verify CI runs and goes green.

---

## Self-review checklist (run before declaring plan complete)

- [ ] Every task has TDD steps (write failing test, run failing, implement, run passing, commit)
- [ ] Every file path is exact (no `<placeholder>`)
- [ ] Every code block is complete (no `// ...rest`)
- [ ] Spec coverage:
  - [x] §1 Goal — Tasks 1-26 cover all four sub-goals
  - [x] §2 Architecture decisions — locked in code across multiple tasks
  - [x] §3 File structure — matches Tasks 1-25
  - [x] §4 Schema — Task 2
  - [x] §5 Analytics wrapper + taxonomy — Task 4
  - [x] §6 Thumbs UI — Tasks 12 + 14 + 15
  - [x] §7 NPS prompt — Tasks 16 + 17
  - [x] §8 Feedback route — Tasks 8 + 9
  - [x] §9 Admin export — Task 10
  - [x] §10 /api/recommendations response shape — Task 13
  - [x] §11 Event wiring — Tasks 18, 19, 20, 21, 22, 23, 24
  - [x] §12 i18n — Task 7
  - [x] §13 Testing — Tasks 4, 6, 8, 9, 10, 23, 24, 25
  - [x] §14 Definition of done — Task 26 gates
  - [x] §15 Out of scope — chat thumbs not in any task; CLAUDE.md update in Task 26 explains
  - [x] §16 Risks — preserved in spec, not blocking implementation
