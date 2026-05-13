# CareerOS — Phase 6a Design: Interview Simulator

**Status:** Approved 2026-05-13. Ready for implementation plan.
**Phase:** 6a (of split Phase 6 = 6a interview / 6b feedback+analytics / 6c polish+observability)
**Out of scope here:** salary-negotiation persona (parked for 6a.5 — different flow shape), feedback/analytics infra (6b), Sentry wiring (6c).

---

## 1. Goal

A new `/interview` surface where a user picks a persona + target role and practices through a realistic Hebrew interview, getting structured feedback at the end. Powered by the same `streamText` engine as `/chat` (extracted into a shared helper) but with its own prompts, tables, and no stage machine.

The product job: make practice feel **real**, not coached. Realistic interviewer behavior throughout (one question, no praise, stay in role), structured critique only at the end. This decides whether the simulation is valuable or feels like training wheels.

## 2. Architecture decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Engine relationship to `/chat` | **Extract shared engine helper, build /interview on top** | /chat earned hardening over PRs #16–#19 (safety pre-check, system-message-via-`system:` param, cache-control placement, stage tool wiring). Reuse the *mechanism* not the *content*. Stage machine + extraction are chat-only and don't belong in interview. |
| 2 | Personas in 6a | **3 — HR, Technical, First-job** | Three share the same Q&A structure (different overlays of the same base). Salary-neg is structurally different (negotiation role-play, not Q&A) — parked for 6a.5 with its own design. |
| 3 | Feedback timing | **End-of-session only, via `wrap_up` tool** | Realism. Real interviewers don't coach mid-interview. Holding feedback for one structured moment matches interviewing.io / Pramp / industry pattern. Persisted to `interview_sessions.feedback_summary_he` + `.feedback_per_question` jsonb. |
| 4 | Target role selection | **Pre-fill from top-1 recommendation, dropdown of top-5 to override** | One-click into a tailored practice for the common path (user has run recs). Free-text fallback if no recs yet. |
| 5 | Revisit behavior | **Always start fresh; history list shows past sessions** | Each session = a discrete practice attempt. History list (max 5) below the picker. Clicking a past session opens a read-only transcript + feedback view. Mirrors how a user thinks about practice. |
| 6 | Data model | **New `interview_sessions` + `interview_messages` tables** | Mirrors `conversations`/`messages` shape rather than piggybacking with a `type` column. Cleaner RLS, persona/target_role/limit live where they belong, no branching across the codebase. |
| 7 | Anonymous-first | **Yes** | Matches every other surface. No sign-in gate. |
| 8 | Persona type | **TEXT with CHECK constraint, not Postgres enum** | Matches `messages.role` pattern. Easier migrations if we add 6a.5 salary-neg. |
| 9 | `max_questions` default | **8** | Real interviews are 8–12. Eight keeps completion rate high while still feeling like a substantive practice. DB default; easy to tune later. |
| 10 | First question | **Model emits automatically** (no user "start" message) | Feels like a real interviewer who opens the conversation. Server treats `__start__` sentinel as the kickoff trigger; safety pre-check is skipped for the sentinel. |
| 11 | Cache target | **Entire system message (base + persona overlay), per-session stable** | System message contains only per-session-stable content (persona, `target_role_he`). Per-turn data (`question_count`, `max_questions`) is injected via a short per-turn preamble in the user message, NOT the system message. This keeps the cache breakpoint clean: write on turn 1, read on every turn 2+. Same correctness rule as Phase 4 explanations. |
| 12 | `target_role_he` source | **Server-resolved** | Client sends `target_occupation_id` (if picking from top-5) OR `target_role_he` (if free-text). Never both. Server resolves the canonical `target_role_he` for the row: catalog lookup if occupation_id given, otherwise the free-text string trimmed and length-capped. Avoids client/server divergence and lets us tighten free-text validation in one place. |

## 3. File / module structure

### 3.1 New files

```
lib/ai/engine.ts                      Extracted shared LLM-turn helper
                                      streamLlmTurn({ userId, systemMessage, userMessage, tools?, onFinish })
                                      Owns: safety pre-check, streamText call, cache observability.
                                      Knows nothing about conversations, interviews, stages, extraction.

app/api/interview/route.ts            Start session + send turn (sessionId-in-body)
app/api/interview/wrap/route.ts       Explicit "I'm done" before max_questions hit
app/api/interview/history/route.ts    GET latest 5 sessions for the user

app/(app)/interview/page.tsx          Server component — landing (picker + history). Single picker surface.
app/(app)/interview/[sessionId]/page.tsx  Live interview view OR read-only transcript+feedback

components/interview/
├── InterviewLanding.tsx              Composes PersonaSelector + TargetRolePicker + HistoryList
├── PersonaSelector.tsx               3 persona cards
├── TargetRolePicker.tsx              Top-5 dropdown + free-text fallback
├── InterviewChat.tsx                 Live session: message list + composer + QuestionCounter
├── QuestionCounter.tsx               "שאלה 3 מתוך 8" pill
├── InterviewMessage.tsx              Message bubble
├── WrapUpScreen.tsx                  feedback_summary_he + per_question notes view
└── HistoryList.tsx                   Up to 5 past sessions

lib/interview/
├── personas.ts                       Frozen persona definitions (id, label_he, description_he, system_prompt_overlay) — no interviewer names
├── prompt.ts                         Two exports, enforcing the cache rule by signature:
│                                       • composeSystemPrompt({persona, targetRole, occupationSkills}) — stable per session
│                                       • composeTurnPreamble({questionCount, maxQuestions}) — Mode A or Mode B per §5.3
├── tools.ts                          makeWrapUpTool({sessionId}) — Anthropic tool with server execute()
└── types.ts                          Persona, InterviewSession, InterviewMessage, WrapUpPayload

lib/db/interview.ts                   Service-role queries (mirrors lib/db/cv.ts pattern)

supabase/migrations/2026XXXX_interview.sql

tests/unit/interview/personas.test.ts
tests/unit/interview/prompt.test.ts
tests/unit/interview/tools.test.ts          (wrap_up tool execute fn — mocked DB)
tests/integration/interview-flow.test.ts    (drives a session via streamText to wrap_up)
scripts/e2e-test-interview.ts                Ad-hoc e2e runner mirroring scripts/e2e-test-chat.ts
```

### 3.2 Modified files

```
app/api/chat/route.ts                 Refactored to call lib/ai/engine.ts.
                                      Loses ~80 lines (safety pre-check + streamText boilerplate + persistence
                                      glue moves into engine), keeps chat-specific bits (stage tool, extraction).

lib/i18n/he.ts                        New he.interview.* block (landing copy, persona names/descriptions,
                                      counter labels, wrap_up CTA labels, error messages).

CLAUDE.md                             "Phase 6a architecture (interview simulator)" section appended.
```

### 3.3 No changes to

- `lib/ai/safety/*` — reused as-is via the engine helper
- `lib/anonymous.ts` — reused for user resolution
- `conversations` / `messages` tables — interview lives in its own tables

## 4. Data model

```sql
create table interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  persona text not null check (persona in ('hr','technical','first_job')),
  target_occupation_id text,           -- nullable; null = free-text role
  target_role_he text not null,        -- denormalized display name (catalog name OR free-text)
  question_count int not null default 0,
  max_questions int not null default 8,
  completed_at timestamptz,
  feedback_summary_he text,
  feedback_per_question jsonb,         -- [{ question_number, note_he }]
  feedback_strengths_he jsonb,         -- string[]
  feedback_improvements_he jsonb,      -- string[]
  feedback_next_practice_focus_he text,-- single actionable next thing to practice
  forced_wrap boolean not null default false,  -- true if server force-completed (model failed to call wrap_up)
  created_at timestamptz not null default now()
);

create index interview_sessions_user_idx on interview_sessions (user_id, created_at desc);

alter table interview_sessions enable row level security;

create policy "interview_sessions_select_own" on interview_sessions
  for select using (
    user_id in (select id from users where auth_id = auth.uid())
  );
-- INSERT/UPDATE via service role only

create table interview_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references interview_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  safety_flag text,                    -- 'distress' | 'crisis' | null
  cache_read_tokens int,
  cache_write_tokens int,
  created_at timestamptz not null default now()
);

create index interview_messages_session_idx on interview_messages (session_id, created_at);

alter table interview_messages enable row level security;

create policy "interview_messages_select_via_session" on interview_messages
  for select using (
    session_id in (
      select id from interview_sessions
      where user_id in (select id from users where auth_id = auth.uid())
    )
  );
```

After migration: `npm run db:types` to regenerate `lib/db/types.gen.ts`.

## 5. LLM prompts

### 5.1 System message (cached, per-session stable)

```
אתה מראיין מנוסה בישראל. תפקידך לקיים ראיון עבודה מציאותי בעברית
עבור משתמש המתאמן לקראת ראיון אמיתי לתפקיד {target_role_he}.

כללים קריטיים:
1. שאל שאלה אחת בכל הודעה — לעולם לא יותר מאחת.
2. תישאר באופי. אתה מראיין, לא מאמן. אל תיתן משוב, אל תסביר למה
   שאלת, אל תעזור לנסח. רק שאל ותקשיב.
3. הקשב באמת — שאלת המשך טבעית בהתאם לתשובה אם זה מתאים,
   או מעבר לנושא הבא.
4. אחרי שמכסת השאלות הסתיימה (תקבל את המספר בכל הודעה),
   חובה לקרוא לכלי `wrap_up` עם משוב מובנה.
5. אל תקרא לכלי `wrap_up` לפני שאלה 5. אל תחכה מעבר למכסה.
6. אל תאשר את התשובה ("מצוין!", "תשובה נהדרת"). מראיין אמיתי לא מתפעל.
   אישור קצר ("הבנתי", "תודה") ומעבר לשאלה הבאה.
7. עברית ניטרלית מגדרית בלבד: "את/ה", "ספר/י", "התמודד/ת", "תאר/י".
   לעולם אל תניח מגדר של המרואיין/ת.

פרטי הראיון:
- סוג ראיון: {persona_label_he}
- תפקיד יעד: {target_role_he}

{persona_overlay}
```

**No per-turn variables in the system message.** `question_count` and `max_questions` are passed via a short server-side preamble prepended to the user message each turn (see §5.4). This is the cache-correctness rule: if any per-turn data lives in the system message, the cache breakpoint never reads.

### 5.2 Persona overlays

No persona names are used in the LLM input or surfaced in the UI. The interviewer self-identifies by role only ("שלום, אני המראיינ/ת מטעם {target_role_he}…"). Avoids name-mismatch awkwardness (a "דניאל" interviewing a female user) and removes one axis of bias.

**HR (`persona = 'hr'`):**
- Question style: behavioral, STAR-friendly ("ספר/י לי על מקרה שבו…"), culture-fit probes ("איך את/ה מתמודד/ת עם…")
- Sample bank of 12 behavioral seed questions in the overlay; model picks/adapts but isn't forced to a script
- Tone: warm but professional

**Technical (`persona = 'technical'`):**
- Question style: domain probes tailored to `target_occupation` — if `target_occupation_id` is non-null, the prompt injects the occupation's `skills` array verbatim and instructs the model to ask about 2-3 of them. If null, generic technical-interviewer mode.
- Includes one "walk me through how you'd approach X" problem
- Tone: precise, no small talk

**First-job (`persona = 'first_job'`):**
- Question style: motivation, learning style, "what draws you to this field", "tell me about a project (any project) you enjoyed". Explicitly acknowledges the user may have no work experience without lowering the substantive bar.
- Tone: warmer than HR, but not condescending. No "easy" questions just because they're junior.

All three overlays end with a fixed reminder: *"חובה: כשתגיע למכסת השאלות, קרא לכלי wrap_up. אל תמשיך לשאול."*

### 5.3 Per-turn user-message preamble

Every user turn (including `__start__`) is wrapped server-side before being sent to the model. The preamble has **two modes** driven by the current `question_count`:

**Mode A — asking mode** (when `question_count < max_questions`):

```
[שאלה {question_count + 1} מתוך {max_questions}]

{actual user message OR "" for __start__}
```

**Mode B — wrap-up mode** (when `question_count >= max_questions`):

```
[המשתמש סיים לענות על השאלה האחרונה. הראיון הסתיים. עליך לקרוא לכלי wrap_up עכשיו עם המשוב המובנה. אל תשאל שאלה נוספת.]

{actual user message — the user's answer to Q{max_questions}}
```

The switch flips after the user submits their answer to Q{max_questions}. That answer is persisted, `question_count` is now at the cap, and the NEXT request to the model uses Mode B — so the model never sees "שאלה 9 מתוך 8". The model is expected to respond by calling `wrap_up`; if it doesn't, the runaway escalation in §7 kicks in.

This is the only place `question_count` and `max_questions` appear in the LLM input. Keeps the cached system message stable; the cheap per-turn preamble is part of the user message that varies each turn anyway.

### 5.4 `wrap_up` tool

```ts
// lib/interview/tools.ts
import { tool } from "ai";
import { z } from "zod";

export function makeWrapUpTool(sessionId: string, currentQuestionCount: number) {
  return tool({
    description: "Call this when the interview is complete (after max_questions, or earlier if the interview reached a natural end ≥ question 5). Provide structured Hebrew feedback. This is the ONLY way to end the interview.",
    inputSchema: z.object({
      summary_he: z.string().min(20).describe("2-4 sentences of overall feedback in Hebrew"),
      strengths_he: z.array(z.string()).min(1).max(4),
      improvements_he: z.array(z.string()).min(1).max(4),
      next_practice_focus_he: z.string().min(10).describe("ONE concrete thing the user should practice next. One sentence. Actionable."),
      per_question: z.array(z.object({
        question_number: z.number().int().min(1),
        note_he: z.string(),
      })).max(10),
    }),
    execute: async (input) => {
      // Server-side timing guard: reject early wrap_up. Schema validates shape; execute validates timing.
      if (currentQuestionCount < 5) {
        return {
          wrapped: false,
          error: "too_early",
          retry_message: "המשך בראיון. אל תקרא ל-wrap_up לפני שאלה 5.",
        };
      }
      await completeInterviewSession(sessionId, {
        feedback_summary_he: input.summary_he,
        feedback_strengths_he: input.strengths_he,
        feedback_improvements_he: input.improvements_he,
        feedback_next_practice_focus_he: input.next_practice_focus_he,
        feedback_per_question: input.per_question,
      });
      return { wrapped: true };
    },
  });
}
```

Same architectural pattern as Phase 2's `set_stage`: server-side `execute` keeps the side effect off the client. `stopWhen: stepCountIs(2)` on `streamText` so the second step where the tool actually executes can run. Schema validates shape; `execute` validates timing.

## 6. Data flow (canonical user journey)

```
1. User navigates to /interview
   ├─ Server fetches: top-5 recs (if any) + last 5 sessions
   └─ Renders InterviewLanding (PersonaSelector + TargetRolePicker + HistoryList)

2. User picks "Technical" + selects top-1 role "מהנדס/ת תוכנה"
   ├─ POST /api/interview { action: 'start', persona, target_occupation_id }
   │    (free-text path: { action: 'start', persona, target_role_he } — never both)
   ├─ Server resolves canonical target_role_he: catalog lookup if occupation_id given, else trim+cap free-text
   ├─ Server creates interview_sessions row (target_occupation_id nullable, target_role_he always set)
   └─ Returns { sessionId }, client router.push(`/interview/${sessionId}`)

3. /interview/[sessionId] (live)
   ├─ Server loads session + messages (empty)
   ├─ Renders InterviewChat
   └─ Client immediately POSTs the __start__ sentinel

4. POST /api/interview { action: 'turn', sessionId, message: '__start__' }
   ├─ Server: safety pre-check SKIPPED for __start__
   ├─ Composes prompt with question_count=0
   ├─ streamText with wrap_up tool, system message cached
   ├─ Streams first question
   └─ onFinish: persists assistant turn, increments question_count → 1

5. User answers — POST /api/interview { action: 'turn', sessionId, message: '...' }
   ├─ Safety pre-check on user msg → if hit: short-circuit (persist user + safety fallback, both flagged)
   ├─ Composes prompt with question_count=1
   ├─ Streams next question
   └─ onFinish: persists user + assistant, increments question_count → 2

6. Loop until question 8 (or model decides to wrap ≥ question 5)
   ├─ Model calls wrap_up tool
   ├─ Server execute() writes feedback fields + completed_at
   ├─ Stream emits the tool result; client picks up "wrapped: true"
   └─ Client transitions InterviewChat → WrapUpScreen

7. WrapUpScreen
   ├─ Renders feedback_summary_he + strengths + improvements + per_question notes
   ├─ CTA "סיים" → /interview
   └─ CTA "תרגל שוב" → /interview
```

### 6.1 Sentinel and counter mechanics

- `__start__` is the only message the client sends without user input. Safety pre-check is skipped iff `message === '__start__'`. The sentinel is never persisted — it triggers a stream but only the model's response is written.
- `question_count` increments on every assistant turn that **does not** call `wrap_up`. The counter pill in the UI shows `question_count + 1` of `max_questions` during a turn.

### 6.2 Read-only transcript view

`/interview/[sessionId]` for a session where `completed_at IS NOT NULL`:
- Renders InterviewMessage list (no composer)
- Renders WrapUpScreen below the transcript
- "תרגל שוב" CTA → /interview

## 7. Error handling

| Failure mode | Behavior |
|---|---|
| Safety regex/classifier hit on user turn | Short-circuit. Persist user msg + `he.safety.distressFallback`, both with `safety_flag`. No LLM call. Session stays alive — user can continue or close. |
| Stream interrupted mid-turn (network) | `streamText`'s `onFinish` callback persists the assistant message even if client disconnects. On re-open of the session, history shows what was persisted. (`question_count` is incremented inside `onFinish`, so an interrupted turn that didn't complete server-side never increments the counter.) |
| `wrap_up` tool's `execute()` throws | Logged via `console.error` (Sentry comes in 6c). Tool result returns `{ wrapped: false, error: '...' }`. Client shows generic error in WrapUpScreen with a "retry" button that re-sends the last user turn — model will retry `wrap_up`. |
| User picks free-text role, no occupation match | `target_occupation_id = null`. Technical persona falls back to "general technical interview for {target_role_he}" — no occupation skill injection. HR + First-job are unaffected (they don't use occupation skills). |
| Max questions hit, model didn't call `wrap_up` | **Three-tier escalation, hard floor at the end.** (1) After the user answers Q{max_questions}, the next turn's preamble switches to Mode B (wrap instruction). Model is *expected* to call `wrap_up`. (2) If the model still doesn't call `wrap_up` and asks another question instead, server intercepts at `question_count == max_questions + 1`: discards the model's question (does not persist), runs **a feedback-only repair call** — a `generateObject` invocation against the same `wrap_up` zod schema, no tools, no streaming, the full transcript as user input, a stripped-down system prompt that just says "Produce a wrap_up object for this finished interview." If the repair call succeeds, persist its output and mark `forced_wrap = true` (so we can audit how often this happens). (3) If the repair call ALSO fails (LLM error, validation error, timeout), THEN write a templated `feedback_summary_he = he.interview.fallback.modelFailedToWrap` (single sentence: "סיימת את הראיון. לא הצלחנו לייצר משוב מפורט הפעם — נסה ראיון נוסף"), set `completed_at = now()`, `forced_wrap = true`. Session always ends; user is never stuck. |
| User closes tab during a turn | Server-side onFinish still persists. Tab reopen → session shows up in history as in-progress (or as a stale in-progress with last assistant message but no completion). Not a critical state — `/interview` always opens picker, user is never blocked. |
| DB connection failure on session insert | Standard 500 + error toast on `/interview` picker. Form state preserved client-side so user can retry. |

## 8. Testing strategy

### 8.1 Unit tests

- `tests/unit/interview/personas.test.ts` — assert frozen persona definitions (id values, all 3 present, label_he non-empty, system_prompt_overlay non-empty, no proper-noun first names in overlay text)
- `tests/unit/interview/prompt.test.ts` — `composeSystemPrompt` produces expected string for each persona × (has occupation / no occupation); asserts it contains NO per-turn variables (no "שאלה", no digits matching question counts). `composeTurnPreamble` produces Mode A output for `question_count < max_questions` and Mode B (wrap instruction) when `question_count >= max_questions`. Snapshot-style assertions on specific substrings.
- `tests/unit/interview/tools.test.ts` — `makeWrapUpTool(sessionId).execute(input)` calls the DB layer with the right payload (mocked DB). Asserts validation rejects empty arrays, summary_he < 20 chars, etc.

### 8.2 Integration test

- `tests/integration/interview-flow.test.ts` — uses the real `streamText` (gated on `ANTHROPIC_API_KEY` env presence; skipped in CI without it). Creates a session with `max_questions=8`, sends `__start__` (model emits Q1), sends 8 canned user answers (one per question Q1..Q8), asserts the 9th turn switches the preamble to Mode B and the model calls `wrap_up` (not "שאלה 9"). Asserts `question_count = 8`, `feedback_summary_he` populated, `completed_at IS NOT NULL`, `forced_wrap = false`.

### 8.3 E2E script (ad-hoc, like Phase 3b's)

- `scripts/e2e-test-interview.ts` — runs against a real local Supabase. Same pattern as `scripts/e2e-test-chat.ts`. Useful for manually verifying persona quality.

### 8.4 Manual browser E2E (before PR)

1. Start session, answer 8 questions, verify wrap_up fires and feedback screen appears.
2. Trigger Hebrew safety phrase mid-interview, verify distress fallback persisted, session continues.
3. Close tab on question 4, revisit `/interview`, verify history list shows in-progress session; click it → opens read-only transcript with no composer.
4. Pick free-text role (sign in fresh, no recs), verify session works without occupation skill injection.
5. Try all 3 personas at least once for vibe check.

## 9. Out of scope (deferred)

| Item | Lives in |
|---|---|
| Salary-negotiation persona | 6a.5 (separate flow shape — negotiation role-play, not Q&A) |
| Per-message thumbs feedback inside interview | 6b (cross-cutting feedback infra) |
| NPS prompt after interview wrap | 6b |
| Sentry error reporting | 6c |
| Vercel Analytics events for interview funnel | 6b |
| PDF "interview feedback report" | 6a.5 if asked |
| Voice/TTS interviewer | Phase 7+ |
| Mid-interview "re-do this question" | Never — breaks realism |
| Multi-language (English) | Phase 7+ |

## 10. Known risks + mitigations

| Risk | Mitigation |
|---|---|
| LLM gives praise mid-interview despite prompt rules | Multiple reinforcing prompt rules (rule 2 + rule 6 in base prompt). Per-persona overlay also reminds. E2E manual check before PR. If still failing post-launch, add a regex post-filter that strips praise phrases. |
| Model calls `wrap_up` too early (before Q5) | Explicit rule 5 in base prompt. Server-side timing guard in `execute()` rejects with `{ wrapped: false, error: "too_early" }` and a retry message — model sees the failed tool result, the second step in `streamText` resumes, and the model asks another question instead of ending. |
| Hebrew persona names feel cliché | Names chosen as common Israeli first names; frozen so we can swap if user feedback complains. Easy to change in `lib/interview/personas.ts`. |
| Occupation skill injection produces awkward questions for generic roles | Technical persona prompt explicitly says "use these skills as topic seeds, not as a checklist to grill on". Manual E2E check across 5 different occupations. |
| Long stream (Q8 wrap_up) exceeds Vercel timeout | Default is now 300s on all plans; a full 8-question interview with the user pausing to type stays under that. Verified via Phase 2 chat under load. |
| Anonymous user spam (someone runs 100 interviews) | Same anonymous-first risk as all other surfaces. Not addressed in 6a — Phase 7 launch hardening will add rate limits across the board. |
| Engine refactor regresses /chat | Refactor lands as Task 1-2 of 6a with the existing chat tests as the regression gate. No interview code lands until /chat is green. |

## 11. Verification plan

After implementation:

1. **Unit:** all `tests/unit/interview/*` pass (`npm test`).
2. **Integration:** `tests/integration/interview-flow.test.ts` passes against real Anthropic API (with key set).
3. **Engine refactor:** `tests/unit/chat/*` + `tests/integration/chat*` all still pass after engine extraction.
4. **Type check:** `npx tsc --noEmit` clean.
5. **Lint:** project lint clean.
6. **Build:** `npm run build` succeeds.
7. **Manual E2E:** §8.4 list, all 5 items.
8. **Cache observability:** verify `cache_read_tokens > 0` on turn 2+ of an interview via `scripts/e2e-test-interview.ts` output.

## 12. Definition of Done

- [ ] `lib/ai/engine.ts` extracted; `/chat` refactored to use it; all chat tests still pass
- [ ] `interview_sessions` + `interview_messages` migration applied; types regenerated
- [ ] `/interview` landing renders picker + history list
- [ ] User can start a session (all 3 personas × occupation/free-text role)
- [ ] First question streams automatically when session opens
- [ ] User can complete a session through `wrap_up`; feedback fields populate
- [ ] Read-only transcript view works for completed sessions
- [ ] Safety pre-check works (same flag/persistence pattern as /chat)
- [ ] Hebrew strings live in `lib/i18n/he.ts` (no hardcoded Hebrew in components)
- [ ] CLAUDE.md "Phase 6a architecture" section appended
- [ ] PR title: *"Phase 6a: interview simulator (3 personas, end-of-session feedback)"*
- [ ] lint + tsc + tests + build all green; CI passes; manual E2E checklist passes
