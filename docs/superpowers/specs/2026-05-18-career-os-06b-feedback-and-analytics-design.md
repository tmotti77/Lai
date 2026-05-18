# CareerOS — Phase 6b Design: Feedback + Analytics

**Status:** Approved 2026-05-18. Ready for implementation plan.
**Phase:** 6b (of split Phase 6 = 6a interview / **6b feedback + analytics** / 6c polish + observability)
**Predecessors:** Phase 6a (merged), Phase 6c (merged 2026-05-18 as `74eecb3`).
**Out of scope here:** UI redesigns, new psychometric tests, advanced funnel analytics (per-user replay, cohort builder).

---

## 1. Goal

Add the quality-signal and aggregate-funnel telemetry that the product currently lacks:

1. **Per-message thumbs feedback** on two AI-generated surfaces: **recommendations** (per-occupation prose) and **interview wrap-up feedback**. Chat thumbs are explicitly **deferred to Phase 6b.5** — see §2 decision #14 for the rationale (current `MessageList` receives client-generated AI SDK `UIMessage[]` ids, not persisted `messages.id` — wiring those through requires a streaming-protocol change that's out of scope here).
2. **One-shot NPS prompt** triggered by the first value-delivery moment per user (PDF download / plan generated / interview completed), persisting `nps_eligibility_first_at` server-side.
3. **`feedback` table** in Supabase: single source of truth for thumbs + NPS rows. Token-gated CSV export endpoint for weekly admin review.
4. **Vercel Analytics events** for the master-roadmap §22 funnel + product-quality signals. Wrapped in `lib/analytics.ts` with a typed allowlist; **never** sends user identifiers, free text, or Hebrew strings.

The cross-cutting privacy constraint: **rich per-user analysis = Supabase joins (full depth, fully under our control); aggregate counters = Vercel Analytics (pseudonymous, no PII)**. Both layers can answer questions about the same user; only Supabase ever sees the user's words.

---

## 2. Architecture decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Analytics provider | **Vercel Analytics + Supabase, no PostHog** | Hebrew CV / interview / NPS content is sensitive. Keep free text in Supabase (we control RLS, retention, breach risk). Vercel Analytics gets only aggregate counters. PostHog is more capable for product analytics but unjustified extra integration + privacy surface for Phase 6b. |
| 2 | What lands in Vercel Analytics | **Allowlist of ~10 event names with strictly-typed primitive props** | Single narrow gate enforces no-PII rule via TypeScript, not code review. No `user_id` (not even hashed) — per-user funnel cuts live in Supabase. |
| 3 | Background-emission primitive | **`after()` from `next/server`** (not `waitUntil()` from `@vercel/functions`) | `after()` is the framework-native primitive in Next.js 15.1+. Integrated with the request lifecycle, runs after response sent, works in Server Components / Route Handlers / Server Actions consistently. |
| 4 | Feedback storage shape | **Single `feedback` table with discriminator column** (`surface` enum + `thumbs_value` / `nps_score` columns, exactly-one-signal CHECK constraint) | Most queries are "everything this user told us" — single table avoids UNION. CHECK constraints make exclusivity a DB-level invariant. `metadata` JSONB is the additive escape hatch for surface-specific context. |
| 5 | Thumbs uniqueness | **Partial unique index `WHERE thumbs_value IS NOT NULL`** on `(user_id, surface, target_type, target_id)`; un-vote = DELETE; flip = UPDATE | One current vote per (user, target). NPS append-only with its own partial unique index `WHERE nps_score IS NOT NULL` for idempotent double-submit handling. |
| 6 | NPS eligibility trigger | **First of {PDF download, plan generated, interview completed}** marks `nps_eligibility_first_at` atomically via guarded UPDATE; first-trigger wins | Wider trigger than PDF-only — captures users who complete interview/plan without downloading PDF. One-shot per user gated by `nps_submitted_at IS NULL AND nps_dismissed_at IS NULL`. |
| 7 | Per-user identifiers in Vercel Analytics | **None — not even salted hash** | Even pseudonymous IDs become a covert linking key if Vercel data ever exports / leaks. Per-user funnel = Supabase joins on existing tables. Vercel = pure aggregate counters. |
| 8 | Generic track endpoint | **Do not build one** | Server-side `track()` called directly from the API route that produces the event. A client-facing `/api/analytics/track` is a PII firehose risk and unnecessary — `<Analytics />` autotracks pageviews. |
| 9 | Admin export shape | **`GET /api/admin/feedback/export?since=...&surface=...` with Bearer-token auth, capped CSV response (10k rows), no UI** | Boring + sufficient for Phase 6b weekly review. Future admin UI is a separate phase. `crypto.timingSafeEqual` on buffer (not string-length) for token comparison. CSV formula-injection escape. `x-content-type-options: nosniff`. |
| 10 | Target ownership validation | **For `interview_session`: verify the row belongs to the user before INSERT/UPDATE. For `recommendation_occupation`: skip (composite catalog string, see #13)** | Prevents thumbs-pollution attacks on quality metrics. First-party-table targets get cheap ownership check; content-derived IDs are validated only by the enum CHECK + length. `message` target_type defined but unused in Phase 6b — see #14. |
| 11 | Analytics-emission idempotency | **Guarded UPDATE with RETURNING; event fires only when row actually transitions state** | Applies to `is_first` for report download, NPS eligibility, NPS dismissal, interview completion, plan task transition. No race window, no double-emit. PostgreSQL atomic by construction. |
| 12 | `account_saved` event | **Drop for Phase 6b** | `exchangeCodeForSession` doesn't tell us whether an anon→auth promotion occurred. Emitting on every sign-in produces wrong data. §22 "save report (auth)" metric is still derivable via SQL on `users.is_anonymous` flip. Add the event later when `lib/anonymous.ts` exposes promotion result. |
| 13 | Recommendation thumb target_id semantics | **Composite `${recommendation_id}:${occupation_id}`**; one thumb per (user, recommendation_id, occupation_id), NOT per (user, occupation_id) globally | Recommendation prose CHANGES across regens (different `profile_hash`, different scores, different Hebrew prose). User's intent is "I liked THIS prose," not "I like data-analyst as an occupation forever." `recommendation_id` MUST be added to `/api/recommendations` response payload so the client knows it. |
| 14 | Chat thumbs in Phase 6b | **Deferred to Phase 6b.5** | Current `MessageList` receives client-generated AI SDK `UIMessage[].id`, not persisted `messages.id`. Wiring requires `streamText({ messageMetadata })` to ride persisted ID back through the stream, plus a `Map<ai-sdk-id, db-id>` on the client. That protocol change is meaningful surface — defer to 6b.5. The `'message'` target_type is included in the schema enum so the schema doesn't need migration when 6b.5 lands, but no chat UI mounts `<ThumbsRow>` in 6b. |

---

## 3. File / module structure

### 3.1 New files

```
lib/analytics.ts                                     Typed track() wrapper, EventName/EventPropsMap, after()
lib/db/feedback.ts                                   getUserFeedbackForTargets() for SSR hydration
lib/db/nps.ts                                        getNpsEligibility(userId), markNpsEligibilityIfFirst()
components/feedback/ThumbsRow.tsx                    Client component (recs + interview; chat deferred to 6b.5)
components/feedback/NpsPrompt.tsx                    Client component (recommendations / plan / interview)

app/api/feedback/route.ts                            POST: thumbs + NPS submit (discriminated union body)
app/api/feedback/nps-dismiss/route.ts                POST: marks nps_dismissed_at
app/api/admin/feedback/export/route.ts               GET: Bearer-token CSV export

supabase/migrations/20260518000000_phase_6b_feedback.sql
                                                     feedback table + RLS + users.nps_* columns + users.first_report_downloaded_at

tests/unit/analytics.test.ts                         npsBucket boundaries + noop in test env
tests/unit/feedback/schema.test.ts                   Zod discriminated-union acceptance/rejection
tests/unit/feedback/csv-escape.test.ts               Formula injection + quoting + embedded newlines
tests/unit/db/interview-transition.test.ts           Guarded-UPDATE emits once, not on re-call

tests/integration/feedback-route.test.ts             POST /api/feedback E2E (insert/update/delete/no-op/consent/target)
tests/integration/admin-export-route.test.ts         Auth + filter validation + CSV correctness
tests/integration/nps-eligibility.test.ts            Atomic across concurrent calls; first wins
tests/integration/plan-task-transition.test.ts       false→true emits; true→true no-op; cross-user 403
```

### 3.2 Modified files (event wiring + UI insertions)

```
app/layout.tsx                                       Add <Analytics /> from @vercel/analytics/next
lib/i18n/he.ts                                       New `feedback.*` namespace (thumbs labels, NPS strings)

components/recommendations/OccupationCard.tsx        Mount <ThumbsRow> bottom-left of each top-5 card (composite target_id includes recommendation_id from API response)
components/interview/WrapUpScreen.tsx                Mount <ThumbsRow> at bottom of wrap-up feedback
app/(app)/recommendations/page.tsx                   SSR-render <NpsPrompt> when eligibility.show
app/(app)/plan/page.tsx                              Same
app/(app)/interview/[sessionId]/page.tsx             Same
components/recommendations/RecommendationsClient.tsx Read thumbs initial state from API response (NOT separate SSR query)

app/api/chat/route.ts                                Emit conversation_started on first user message
app/api/recommendations/route.ts                     Add recommendation_id + thumbs map to response payload (see §10)
package.json / package-lock.json                     Add @vercel/analytics dependency
README.md                                            Document ADMIN_EXPORT_TOKEN env var alongside existing Vercel env vars
app/api/assessment/submit/route.ts                   Emit assessment_completed
app/api/cv/confirm/route.ts                          Emit cv_uploaded (call inferArchetype)
app/api/recommendations/route.ts                     Emit recommendations_generated
app/api/report/pdf/route.ts                          Atomic is_first + emit report_downloaded + markNpsEligibilityIfFirst
app/api/plan/generate/route.ts                       Emit plan_generated + markNpsEligibilityIfFirst
app/api/plan/tasks/[id]/toggle/route.ts              Guarded UPDATE returning category/day; emit plan_task_completed on transition
app/api/interview/route.ts                           Emit interview_started
lib/db/interview.ts                                  completeInterviewSession: guarded UPDATE returning persona/question_count/forced_wrap; emit interview_completed + markNpsEligibilityIfFirst on transition
lib/db/plans.ts                                      toggleTaskDone(userId, taskId, done): preserve ownership check; guarded UPDATE returning category/day on transition

scripts/verify-all-surfaces.mjs                      Add thumbs/NPS interaction tests; new admin-export surface
.env.example                                         ADMIN_EXPORT_TOKEN placeholder + comment
```

### 3.3 Not modified (intentionally)

- `lib/env.ts` — `ADMIN_EXPORT_TOKEN` is not required in dev/build; missing → 401 from admin route only
- `lib/anonymous.ts` — promotion path NOT modified for `account_saved` (deferred)
- `components/chat/MessageList.tsx` — chat thumbs deferred to Phase 6b.5 (see §2 decision #14)
- `app/(app)/chat/page.tsx` — same reason
- Matching engine, AI prompts, assessment scoring — no behavioral changes
- AI SDK streaming protocol — Phase 6b.5 will add `messageMetadata` carrying persisted DB ids for chat thumbs; not touched in 6b

---

## 4. Database schema (final)

```sql
-- supabase/migrations/20260518000000_phase_6b_feedback.sql

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
  add column nps_eligibility_first_at timestamptz,
  add column nps_submitted_at         timestamptz,
  add column nps_dismissed_at         timestamptz,
  add column nps_trigger_first        text check (
    nps_trigger_first is null or nps_trigger_first in (
      'pdf_download', 'plan_generated', 'interview_completed'
    )
  ),
  add column first_report_downloaded_at timestamptz;
```

NPS prompt shows iff:
```sql
nps_eligibility_first_at IS NOT NULL
  AND nps_submitted_at IS NULL
  AND nps_dismissed_at IS NULL
```

---

## 5. `lib/analytics.ts` — wrapper + event taxonomy

```typescript
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
// account_saved deferred to a later phase.

type SkillCountBucket = "0-5" | "6-10" | "11-20" | "20+";
type CvArchetype = "builder" | "connector" | "analyst" | "leader" | "creator" | "generalist";
type PlanArchetype = "apply" | "taste_test" | "research";
type PlanTaskCategory = "action" | "research" | "network" | "reflection";
type InterviewPersona = "hr" | "technical" | "first_job";
type NpsTrigger = "pdf_download" | "plan_generated" | "interview_completed";
type NpsBucket = "detractor" | "passive" | "promoter";

type EventPropsMap = {
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
    question_count_bucket: "1-4" | "5-8" | "9+";
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
```

§22 metric coverage:

| §22 metric | Event | Where emitted |
|---|---|---|
| visitor → first chat message | `conversation_started` | `app/api/chat/route.ts` — when `conversation.message_count === 0` captured before append |
| complete formal assessment | `assessment_completed` | `app/api/assessment/submit/route.ts` |
| view recommendations | (pageview, auto via `<Analytics />`) | n/a |
| download report (PDF) | `report_downloaded` | `app/api/report/pdf/route.ts` after atomic `first_report_downloaded_at` UPDATE |
| save report (auth) | (derived via SQL on `users.is_anonymous`) | n/a (event deferred) |
| return within 7 days | (derived in Supabase from `users.created_at` vs latest activity) | n/a |
| complete plan task | `plan_task_completed` | `lib/db/plans.ts` — guarded transition false→true only |

---

## 6. Thumbs UI (`<ThumbsRow>`)

Reusable client component mounted at two sites with `(surface, target_type, target_id)`-shaped props plus optional `metadata`. `initialValue` hydration strategy differs per surface — see below.

UX semantics: click same vote = un-vote (DELETE); click opposite = flip (UPDATE); first click = INSERT. Optimistic UI with silent rollback on network failure; Sentry+console logging on error but no toast.

Visual: filled icon (`fill-current`) when selected, outline when not — selected state distinct without relying on color (WCAG 1.4.1). 44px touch targets (`h-11 w-11` button, `h-5 w-5` icon). `aria-pressed` for screen-reader toggle semantics. RTL-safe via logical properties.

Insertion points:

| Surface | File | target_type | target_id | Hydration |
|---|---|---|---|---|
| Recommendations | `components/recommendations/OccupationCard.tsx` | `recommendation_occupation` | `${recommendation_id}:${occupation_id}` | Initial values returned inline by `/api/recommendations` response (see §10) — no separate query. RecommendationsClient passes the per-card `initialValue` from `data.thumbs[id]`. |
| Interview wrap | `components/interview/WrapUpScreen.tsx` | `interview_session` | `interview_sessions.id` | SSR via `getUserFeedbackForTargets(userId, [{type: 'interview_session', id: sessionId}])` in the server component for `/interview/[sessionId]/page.tsx` since interview-wrap data is already server-rendered. One `Map`-returning helper in `lib/db/feedback.ts`. |

**Why two hydration patterns:** because the two surfaces have different data-loading shapes. Recommendations fetch client-side via `useEffect`; the cheapest "initial thumbs state" comes inline with that fetch's response. Interview wrap is server-rendered with session data already available; the SSR helper avoids a second client roundtrip.

**Chat thumbs deferred to 6b.5 — see §2 decision #14.**

---

## 7. NPS prompt (`<NpsPrompt>`)

Inline `<Card>` banner (not modal), rendered at the top of `/recommendations`, `/plan`, `/interview` when `getNpsEligibility(userId).show === true`.

Layout: title + subtitle + 11 numbered buttons (`grid-cols-6 gap-2 sm:grid-cols-11` — wraps to 2 rows on small screens) + min/max scale labels + dismiss button (top-end logical corner). After score selection, comment Textarea + submit button slide in (`motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200` — instant under prefers-reduced-motion).

ARIA: `role="radiogroup"` on container, `role="radio"` + `aria-checked` per button. Tab+space works for selection; arrow-key navigation is a future polish item.

Backend trigger logic (atomic):

```typescript
// lib/db/nps.ts
export async function markNpsEligibilityIfFirst(
  userId: string,
  trigger: NpsTrigger
): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("users")
    .update({
      nps_eligibility_first_at: new Date().toISOString(),
      nps_trigger_first: trigger,
    })
    .eq("id", userId)
    .is("nps_eligibility_first_at", null);
  // First-trigger wins. Subsequent calls match zero rows — no-op.
}
```

**PDF download edge case:** Eligibility is set server-side by the PDF route; the prompt appears on the *next* page load of `/recommendations` (the browser doesn't reload after a `Content-Disposition: attachment` response). This is accepted — users typically return to compare paths. Plan and interview triggers naturally re-render their page, so the prompt appears on the same screen.

Submission:
1. `POST /api/feedback` with `{kind: "nps", nps_score, nps_trigger, comment_he}`
2. Unique-index violation (`23505`) returns idempotent `{ok, already: true}` — silent client-side
3. After successful insert, `users.nps_submitted_at` set; prompt stops appearing

Dismissal:
1. `POST /api/feedback/nps-dismiss`
2. Sets `users.nps_dismissed_at`
3. 403 on `NoConsentError` (edge case if consent revoked between page load and dismissal); else 204

---

## 8. `POST /api/feedback` route

Discriminated-union Zod body (`kind: "thumb" | "nps"`). Consent-gated via `requireConsent(userId)`. Service-role Supabase client.

```typescript
// app/api/feedback/route.ts
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

const FeedbackBody = z.discriminatedUnion("kind", [ThumbBody, NpsBody]);
```

Thumb flow:

1. Validate target ownership:
   - `interview_session`: query `interview_sessions` for `id = target_id AND user_id = userId` — 404 on miss
   - `recommendation_occupation`: split `target_id` on `:` → `[recommendation_id, occupation_id]`; verify `recommendations.id = recommendation_id AND user_id = userId`; verify `occupation_id` is in the catalog string set — 404 on miss
   - `message`: target_type is defined in the enum but no UI emits this in Phase 6b; route accepts it but the chat thumb feature is unwired. Implementation should still validate `messages.id` ownership when called, since Phase 6b.5 wiring is the only consumer
2. SELECT current vote for `(user_id, surface, target_type, target_id) WHERE thumbs_value IS NOT NULL`.
3. If `existing.thumbs_value === incoming.thumbs_value`: no-op short-circuit, return `{ok, unchanged: true}`. No DB write. No event.
4. Else if `incoming === null`: DELETE the existing row. Emit `feedback_submitted` with `value: "removed"`.
5. Else if existing row: UPDATE. Else: INSERT. Emit `feedback_submitted` with `value: "up"` or `"down"`.

(SELECT-then-INSERT-or-UPDATE chosen over Supabase `.upsert()` because partial unique indexes are not visible to PostgREST's ON CONFLICT inference. Three roundtrips worst case; fine for click-rate traffic.)

NPS flow:

1. INSERT into `feedback`. On `23505` (unique violation from `feedback_one_nps_per_user_idx`): return `{ok, already: true}` — idempotent.
2. UPDATE `users.nps_submitted_at` where currently NULL (atomic).
3. Emit `feedback_submitted` with `kind: "nps"`, `trigger`, `bucket: npsBucket(nps_score)`.

DB-write-before-analytics-event ordering throughout: Vercel Analytics events are a subset of Supabase rows. If Vercel write fails, Supabase still has the truth.

---

## 9. Admin CSV export (`GET /api/admin/feedback/export`)

```typescript
// app/api/admin/feedback/export/route.ts
import { createServiceClient } from "@/lib/supabase/service";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
```

Auth: `Authorization: Bearer <ADMIN_EXPORT_TOKEN>`. Token comparison uses `crypto.timingSafeEqual` on UTF-8 byte buffers (NOT string `.length` — non-ASCII tokens have different byte vs char counts).

Query params:
- `since` — ISO 8601 datetime; validated via `new Date(s).getTime() !== NaN`; 400 on invalid
- `surface` — one of `chat | recommendations | interview | nps`; 400 on invalid

Response: capped CSV (max 10k rows; not streamed). Headers:
- `content-type: text/csv; charset=utf-8`
- `content-disposition: attachment; filename="feedback-<date>.csv"`
- `cache-control: no-store`
- `x-content-type-options: nosniff`

CSV escaping defends against formula injection: values starting with `=`, `+`, `-`, `@`, `\t`, `\r` get a leading apostrophe before standard CSV quoting.

`ADMIN_EXPORT_TOKEN` documented in `.env.example` and Vercel deployment notes but NOT required in `lib/env.ts` — missing env returns 401 from the route only; dev/build continues working.

Usage:
```bash
curl -H "Authorization: Bearer $ADMIN_EXPORT_TOKEN" \
     "https://career-os.app/api/admin/feedback/export?since=2026-05-11T00:00:00Z" \
     > feedback.csv
```

---

## 10. `/api/recommendations` response shape change

Add two fields to the existing response shape so the client can render thumbs without an extra fetch:

```typescript
// app/api/recommendations/route.ts response (Phase 6b additions in bold)
{
  rankings: [...],
  paths: {...},
  prose: {...},
  cached: boolean,
  generated_at: string,
  // ↓ Phase 6b additions
  recommendation_id: string,                   // the recommendations.id row used (cached or fresh)
  thumbs: Record<string, -1 | 1>,              // map of "${recommendation_id}:${occupation_id}" → user's current vote, omitting unvoted
}
```

`thumbs` populated via a single query inside `/api/recommendations/route.ts`:

```typescript
const { data: thumbsRows } = await supabase
  .from("feedback")
  .select("target_id, thumbs_value")
  .eq("user_id", userId)
  .eq("surface", "recommendations")
  .eq("target_type", "recommendation_occupation")
  .like("target_id", `${recommendationId}:%`)
  .not("thumbs_value", "is", null);
const thumbs = Object.fromEntries(
  (thumbsRows ?? []).map((r) => [r.target_id, r.thumbs_value])
);
```

`RecommendationsClient` reads `data.thumbs[target_id]` per occupation card and passes as `initialValue` to `<ThumbsRow>`. No second roundtrip.

## 11. Event-wiring details

**Atomic `is_first` for `report_downloaded`:**
```typescript
const { data, error } = await supabase
  .from("users")
  .update({ first_report_downloaded_at: new Date().toISOString() })
  .eq("id", userId)
  .is("first_report_downloaded_at", null)
  .select("id");
const isFirst = !error && (data?.length ?? 0) === 1;
track("report_downloaded", { is_first: isFirst });
if (isFirst) await markNpsEligibilityIfFirst(userId, "pdf_download");
```

**Idempotent `interview_completed` (inside `completeInterviewSession`):**
```typescript
const { data } = await supabase
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

if (data) {
  track("interview_completed", {
    persona: data.persona,
    forced_wrap: data.forced_wrap ?? false,
    question_count_bucket: questionCountBucket(data.question_count),
  });
  await markNpsEligibilityIfFirst(data.user_id, "interview_completed");
}
```

**Transition-only `plan_task_completed` (in `lib/db/plans.ts → toggleTaskDone`):**
```typescript
export async function toggleTaskDone(
  userId: string,
  taskId: string,
  done: boolean
): Promise<void> {
  const supabase = createServiceClient();
  
  // Ownership check via plans.user_id JOIN — preserved from existing Phase 5b RLS pattern
  const { data: owned } = await supabase
    .from("plan_tasks")
    .select("id, plans!inner(user_id)")
    .eq("id", taskId)
    .eq("plans.user_id", userId)
    .maybeSingle();
  if (!owned) throw new ForbiddenError();
  
  if (done) {
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

Common pattern across all event-wired routes: guarded UPDATE with RETURNING; event fires only when the row actually transitioned state. No race window, no double-emit, no inconsistent state — PostgreSQL atomic by construction.

---

## 12. i18n (`lib/i18n/he.ts`)

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

Hebrew strings are v1 — same caveat as Phase 3a assessment items: a Hebrew copywriter / UX review pass before public launch is a Phase 7 launch-checklist item.

---

## 13. Testing strategy

**Layer 1 — Unit (Vitest, no DB, no fetch):**
- `npsBucket(score)` boundaries: 0, 6, 7, 8, 9, 10. Invalid (-1, 11) are rejected by Zod at the route layer, not the helper.
- Feedback Zod discriminated-union: valid/invalid bodies per `kind`
- CSV escape helper: formula injection, quoting, embedded newlines, null handling
- Guarded-UPDATE-emit semantics (mocked Supabase): emits on transition, no-op on re-call

**Layer 2 — Integration (Vitest + Supabase test fixtures):**
- POST /api/feedback: thumb insert / update / delete / no-op-when-identical / consent 403 / target 404
- POST /api/feedback NPS: once-per-user enforcement; 23505 → 200 `{ok, already: true}`
- GET /api/admin/feedback/export: auth required (401 without token); filter validation (400 on bad ISO date or invalid surface); CSV correctness
- `markNpsEligibilityIfFirst`: atomic across concurrent calls — first trigger wins, second is no-op
- `toggleTaskDone`: false→true emits with correct props; true→true no-op; false→false no-op; cross-user attempt returns 403

**Layer 3 — E2E + a11y (Playwright + axe-core, extend `scripts/verify-all-surfaces.mjs`):**
- Add thumbs interaction tests on recommendations / interview-wrap (`getByRole("button", { pressed: true })`)
- Add NPS prompt rendering (force eligibility via service-role SQL fixture, reload, verify radiogroup mounts, fill score, submit)
- Add admin-export surface (Bearer header — never `?token=` query)
- Verify all new components: 0 critical/serious axe violations across 375 / 768 / 1280 viewports

**Mocking discipline (different rules per test layer):**

- **Route / integration tests mock `@/lib/analytics`.** This isolates the route's decision logic — "did this route decide to emit the correct event at the correct time?" — from `after()`, `@vercel/analytics/server`, and the wrapper's internals. Mocking the wrapper does NOT exercise the layers beneath it; that's deliberate. The route's job is to call `track()` correctly; the wrapper's job is to deliver the event correctly. These are different units of work and get different tests.
- **DB-backed integration tests use the real test database, not mocked Supabase.** The bugs we're guarding against in Phase 6b — partial unique indexes, guarded UPDATEs with RETURNING, ownership-check JOINs, unique constraint behavior, atomic eligibility marking — only manifest against PostgreSQL. A mocked Supabase chain can lie about constraint violations or fake "affected rows" return values. The integration tests are the source of truth for these invariants.
- **`lib/analytics.ts` is unit-tested separately with `@vercel/analytics/server` mocked.** That's where `track()`'s use of `after()`, error-swallowing, test-env noop, and `npsBucket()` boundaries are verified.
- **Unit tests for "guarded UPDATE emits once" with mocked Supabase are optional, not the source of truth.** Keep that invariant load-bearing in the integration test against the real test DB. The unit test can be a sketch of intent; the integration test is the actual proof.

---

## 14. Definition of done

| Gate | Verified via |
|---|---|
| `npx tsc --noEmit` clean | CI |
| `npm test` green (all new + all existing) | CI |
| `npm run build` green | CI |
| `node scripts/verify-all-surfaces.mjs` — 0 critical/serious a11y violations | Local + CI |
| Thumbs persist across reload on recs / interview-wrap | Local browser |
| NPS prompt fires after first report download on next `/recommendations` load | Local browser |
| NPS prompt does NOT re-appear after submit or dismiss | Local browser |
| CSV export returns valid Hebrew-safe CSV with formula-injection guard, behind Bearer auth | Local + production smoke |
| `feedback_submitted` event visible in Vercel Analytics within 1 min of test thumb | Deployed |
| `ADMIN_EXPORT_TOKEN` in `.env.example` + Vercel env note in deployment docs | Spec file |

---

## 15. Out of scope (intentional)

- **Chat thumbs** — deferred to Phase 6b.5. `MessageList` currently receives AI SDK `UIMessage[]` with client-generated `m.id`, not persisted `messages.id`. Wiring requires `streamText({ messageMetadata })` to ride the persisted DB id back through the stream + a client-side `Map<ai-sdk-id, db-id>`. The `'message'` target_type is reserved in the schema enum so the migration doesn't need re-running. Phase 6b.5 sketch:
  1. `lib/ai/engine.ts` `onAssistantFinish` callback receives the persisted row id; engine emits it via `streamText({ messageMetadata: { persisted_id } })`
  2. Client `useChat({ onMessageMetadata })` populates a `Map<ai-sdk-id, db-id>` lookup
  3. `MessageList` reads from that map; `<ThumbsRow>` mounts only on messages where `db-id` exists (the assistant turn has finished persisting)
- `account_saved` analytics event (deferred until `lib/anonymous.ts` exposes promotion-result)
- Admin UI page (Supabase Studio + CSV export are sufficient for Phase 6b weekly review)
- Per-user funnel cuts in Vercel Analytics (lives in Supabase joins instead)
- Browser-side Sentry SDK (deferred from Phase 6c; can come in 6c.5 when traffic baseline exists)
- Cross-browser visual regression (verify-all-surfaces runs Chromium only)
- Plan-task-description thumbs (low signal per click; plan-task completion analytics carry the quality signal)
- Email-the-CSV-digest cron (manual export is fine for Phase 6b cadence)
- Hebrew NPS copy review by native Hebrew copywriter (Phase 7 launch-checklist item)

---

## 16. Risks / mitigations

| Risk | Mitigation |
|---|---|
| Vercel Analytics free tier event cap exceeded post-launch | Custom events count against the project's plan limit (see Vercel Analytics pricing docs); if exceeded, throttle non-§22 events first (`recommendations_generated`, `plan_task_completed`) or upgrade plan. Pre-launch traffic is low; revisit in Phase 7. |
| NPS-prompt fatigue on repeat visitors | One-shot per user enforced by `users.nps_submitted_at` + `nps_dismissed_at` columns. Cannot re-appear without manual SQL reset. |
| Cross-site exfiltration of admin CSV via stolen token | Token-only is appropriate for Phase 6b; rotate on suspicion. Future: bind to IP allowlist or Vercel-internal auth. |
| Hebrew NPS items not psychometrically validated | Phase 7 launch checklist gates on Hebrew copy review (same status as assessment items v1). |
| `nps_trigger_first` column drift between schema and code | One migration, one set of route handlers — keep enum strings synchronized via TypeScript types referenced from the same `lib/analytics.ts` `NpsTrigger` type alias. |
