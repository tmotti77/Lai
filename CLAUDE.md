# CareerOS — Project Context for Claude Code

> This file is loaded into every Claude Code session in this repo. Keep it short, factual, and current. For full plans see `docs/superpowers/plans/`.

## What this is

CareerOS is a Hebrew-first AI career-guidance agent for Israeli post-army / pre-studies / student users. Working name; rebrandable. The product takes a user from "I have no idea what to do" to a personalized 3-paths PDF report and 30-day action plan, via a conversational assessment.

The IP is the matching engine (deterministic TypeScript, weighted scoring per spec §9), not the LLM. Claude is used to drive the conversation, extract structured profile data, and write Hebrew prose around the deterministic match results.

Spec lives in conversation history (Hebrew, ~31 sections). Don't recreate it; ask if needed.

## Stack (locked, intentional)

- Next.js 16 (App Router, RSC) — single TypeScript app
- Tailwind v4 + shadcn/ui (Radix primitives) — RTL-first
- Supabase: Postgres + pgvector + Auth + Storage (via `@supabase/ssr`)
- Anthropic Claude (model ID via `ANTHROPIC_MODEL` env var, never hard-coded)
- Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) with prompt caching enabled
- `@react-pdf/renderer` for PDF reports (Heebo font)
- Vitest for unit/integration; Playwright for E2E (Phase 6+)
- Vercel hosting; Sentry for errors (Phase 6+)

Earlier sketches considered Next.js + Python FastAPI + OpenAI + Vercel/Render/Neon. We deliberately collapsed to the single-Next-app stack for MVP velocity. See `docs/superpowers/plans/2026-05-10-career-os-00-master-roadmap.md` §1 for the rationale. Don't re-litigate without a strong reason.

## Provisioned infra

- **Supabase project**: `career-os` (`wqswamtcppjmkwykukjp`) in `eu-central-1` (Frankfurt — closest to Israel)
- **Supabase org**: `tmotti777's Org` (`jcdyrlxxtntblgpkexve`)
- **Vercel team**: `mos-projects-a3126879` (`team_Ml2POSOLEKjsLzBAjfBhWp06`) — no CareerOS project yet, will create on first deploy
- **GitHub repo**: `tmotti77/Lai`

## Plans

- `docs/superpowers/plans/2026-05-10-career-os-00-master-roadmap.md` — 7-phase roadmap, decisions, KPIs, risks
- `docs/superpowers/plans/2026-05-10-career-os-01-foundation.md` — Phase 1 (foundation, merged)
- `docs/superpowers/plans/2026-05-10-career-os-02-conversation-engine.md` — Phase 2 (chat engine + safety, merged)
- `docs/superpowers/plans/2026-05-10-career-os-03a-formal-assessments.md` — Phase 3a (formal assessments, merged)
- `docs/superpowers/plans/2026-05-11-career-os-03b-cv-skill-extraction.md` — Phase 3b ("המראה" — streaming CV → skills, current)
- Phases 4–7 plans: see `docs/superpowers/plans/`. Phase 3 was split into 3a (formal assessments) and 3b (CV upload + skill extraction).

## Phase 2 architecture (engine core + safety)

The chat is now stage-aware with a 6-stage state machine: `onboarding → interests → skills → values → constraints → wrap → complete`.

- **Stage state lives on `conversations.stage`**. Default `onboarding`.
- **Stage transitions via Anthropic tool-use.** Claude has access to a `set_stage(next_stage, reason)` tool defined in `lib/ai/tools.ts`. When Claude judges the current stage complete, it calls the tool — server-side `execute` updates the DB and triggers async profile extraction. The tool call doesn't appear in user-visible text. **Known issue (Phase 2 Task 14 finding)**: Claude often won't call the tool spontaneously; the prompt's tool-call directive may need strengthening, OR AI SDK v6 may need `stopWhen: stepCountIs(N)` on `streamText` for tool-execute to fire reliably.
- **Per-stage system prompts**: `lib/ai/prompts/stages/*.ts`. `assembleSystemPrompt(stage)` in `lib/ai/prompts/system.ts` composes the base prompt + stage overlay. The composed prompt is what gets `cache_control: ephemeral`. With ~2000 input tokens we now cross Sonnet 4.6's cache threshold; **caches write but reads are showing NULL — investigate before next user testing**.
- **Profile extraction**: separate `generateObject` call at stage boundaries (`lib/ai/extraction.ts`) using the `ProfileSchema` zod schema. Extracts interests / skills / values / constraints depending on stage. Result merged into `career_profile.data` JSONB via the `merge_career_profile` RPC. Runs async after the stream finishes; failures are logged but don't block the user.
- **Two-layer safety detector** in `lib/ai/safety/`. Runs on EVERY user turn before any LLM call:
  1. `regex.ts` — Hebrew + English crisis/distress patterns. Cheap, runs always. **This is the legal floor.**
  2. `classifier.ts` — Anthropic LLM classifier. Runs when regex hits "distress" (may upgrade to "crisis") or message is ≥80 chars without a regex hit (catches missed phrasings).
  3. `index.ts` — `checkUserMessage` combines both. On any hit, the chat route short-circuits: persists user msg + the predefined `he.safety.distressFallback` response (both flagged `safety_flag='distress'/'crisis'`), returns a manually-constructed SSE stream. **No Anthropic call is made.**
- **`career_profile` table** is hybrid: structured top-level columns (`user_id`, `conversation_id`, `current_stage`, `extraction_count`, `last_extracted_at`) + JSONB `data` for the evolving profile shape. The `merge_career_profile` RPC does atomic upsert + deep-merge.
- **Cache observability**: every assistant turn logs `inputTokens`, `outputTokens`, `cacheRead`, `cacheWrite` to the server console + persists `cache_read_tokens` / `cache_write_tokens` columns. Use these to diagnose caching behavior.

**Architectural rule, do not bypass**: `checkUserMessage` MUST run on every user turn before any `streamText` call. If you're touching `app/api/chat/route.ts`, the safety pre-check is the first thing the route does after parsing the body. This is a *legal* protection, not just a quality one.

## Phase 3a architecture (formal assessments)

Four formal assessment surfaces live under `/assessment`: RIASEC (30 items), Big5 (20 items, IPIP-NEO short form with reverse-keyed acquiescence control), values picker (pick 5 of 12 + rank 3), and a constraints form. The hub at `/assessment` shows per-type completion status; each assessment has its own deep-link page at `/assessment/{riasec,big5,values,constraints}`.

- **Items live in code** (`lib/assessment/<type>/items.ts`), not DB. Each items file exports an `_ITEMS_VERSION` integer; every persisted submission stores its `items_version`. If items get reworded, historical scores remain interpretable against the version that was active at submission time.
- **Scoring is pure deterministic TypeScript** in `lib/assessment/<type>/score.ts` — same architectural rule as the matching engine. RIASEC: per-type sum normalized 0..100 + Holland code (top 3 letters, ties broken by `RIASEC_TYPES` declaration order: R, I, A, S, E, C). Big5: reverse-key inversion (`6 - raw` for items flagged `reverseKeyed`), then per-trait normalize. Values: `validateValuesSubmission` enforces picked.length===5, ranked.length===3, ranked⊆picked, no duplicates. Constraints: zod schema with field bounds (`time_per_week_hours: 0..60`, `training_budget_nis: 0..200_000`, etc.).
- **`assessments` table**: one row per submission (history-preserving). Latest-per-type retrieved via `ORDER BY taken_at DESC` then dedupe-in-memory. `getProfile()` in `lib/db/profile.ts` JOINs the latest row per type into a `formal` key on the returned profile.
- **DB layer creates its own service-role client.** `lib/db/assessments.ts` calls `createServiceClient()` internally — same pattern as `lib/db/queries.ts` from Phase 2. Routes pass only the resolved `userId`, not a Supabase client. **The RLS policy only matches `auth.uid()`; the cookie-based anon-key client cannot insert assessments for anonymous users.** This is a real constraint — if you write a new caller, use the service-role pattern.
- **Submit endpoint**: one unified `POST /api/assessment/submit` with a zod `discriminatedUnion("type", [...])`. Per-type completeness pre-check (riasec/big5 must have all expected item ids) runs **before** opening a DB connection — bad client requests fail-fast with 400.
- **Items v1 quality flag**: the Hebrew items in `lib/assessment/<type>/items.ts` are best-effort and need a Hebrew-speaking psychologist's review before public launch. Tracked as a Phase 7 launch-checklist item, not a blocker for Phase 4 matching engine work.

## Phase 4 architecture (occupations DB + matching engine)

The matching engine is the IP. It takes a user's profile (chat-extracted from Phase 2 + formal assessments from Phase 3a) and produces a deterministic ranked list of occupations + a 3-paths recommendation (safe / growth / wildcard) + Hebrew prose explanations. Surface: `/recommendations` page; engine: `lib/matching/engine.ts`.

- **Two-layer architecture, never blurred**: scoring layer is pure TypeScript (`lib/matching/score/{interests,skills,values,big5,constraints,market}.ts`); prose layer is a single LLM call (`lib/ai/prompts/explanations.ts`) that reads scores and writes Hebrew. **The LLM never produces a number.** Don't merge them.
- **Weights**: 25/20/15/15/15/10 (interests / skills / values / big5 / constraints / market) — master roadmap §9. Sum = 100.
- **Re-normalization for missing dimensions**: each dimension scorer returns `null` when the user has no signal for it. The combiner (`lib/matching/engine.ts`) drops null dimensions and re-normalizes the remaining weights so they still sum to 100. **Never default a missing dimension to 50** — that biases every match toward neutral. A chat-only user gets weights re-normalized over 4 dimensions; a fully-assessed user gets all 6.
- **Catalog**: `content/occupations/*.json` (20 hand-curated v1, schema-validated by `scripts/validate-occupations.ts`) + `content/skills/taxonomy.json` (60 skills). Seeded into DB by `npm run seed:occupations` which also bumps `catalog_version`.
- **Cache**: `recommendations` table keyed on `profile_hash = sha1({profile, catalogVersion})`. Profile change OR catalog change → new hash → recompute. Same hash + ≤7 days old → reuse, no LLM call.
- **3-paths heuristic** (`lib/matching/paths.ts`): single-pass evaluation in declaration order (safe → growth → wildcard), no occupation reuses across paths. `safe` requires `constraints≥75 + training≤6mo + high demand`. `growth` requires `interests≥70 + 6-18mo training + medium-high demand`. `wildcard` requires `total_score≥60`. Slots that find no qualifying occupation return `null` and the UI shows "no clear N-path option" rather than forcing a bad fit.
- **Skill matching is fuzzy**: chat-extracted skills are free-form Hebrew labels, not taxonomy ids. `lib/matching/score/skills.ts` matches via lowercase substring containment. Phase 3b (CV upload) will add LLM-based extraction-to-taxonomy.
- **Catalog quality flag**: 20 occupations v1 are best-effort (`data_source: "public_knowledge_v1_2026-05"`). Need expert review before public launch — tracked in Phase 7. Phase 4.5 expands the catalog toward the master roadmap's target of 100.
- **Prompt cache** in `explanations.ts`: uses the explicit `messages` array form with `providerOptions.anthropic.cacheControl` on the `role: "system"` message. **Don't use `system: "..."` shorthand on `generateObject`** — top-level `providerOptions` puts the breakpoint on the user message (which changes every call), making the cache write-only.

## Phase 5a architecture (PDF report)

The PDF report is the user-facing artifact. Triggered from `/recommendations` via the Download button → `GET /api/report/pdf` → reads the cached `recommendations` row + occupations + user's `career_profile`, renders a 3-page Hebrew RTL PDF via `@react-pdf/renderer`, streams as attachment.

- **No new LLM call.** Reuses `recommendations.prose` from Phase 4. PDF render is pure-Node, ~500ms, $0.
- **No `reports` table.** The PDF is a derivation of the cache, not persisted. Re-download = re-render from latest `recommendations` row.
- **Font is `public/fonts/Heebo-VF.ttf`** — the variable-weight TTF from Google Fonts. Registered three times in `lib/pdf/fonts.ts` under different `fontWeight` values; fontkit picks the correct axis instance. Single file ships Hebrew + Latin so mixed-language text renders entirely in Heebo (no Helvetica fallback).
- **RTL strategy**: `direction: "rtl"` at Page level in `lib/pdf/styles.ts` + `textAlign: "right"` on text. `scoreValue` uses `textAlign: "left"` deliberately — numeric values read LTR even on an RTL page. Logical margins (`marginEnd`, `marginStart`) work in @react-pdf v4+.
- **Section components** under `lib/pdf/sections/`. Each takes only the data it needs (not the full `ReportData`), so they're independently understandable. Composed by `lib/pdf/ReportDocument.tsx` into 3 pages: cover → profile mirror + 3 paths → top-5 rankings + follow-ups. Disclaimer footer is `<Text fixed>` on every page.
- **Disclaimer in 4 places now complete** (master roadmap §6 risk mitigation): chat header banner (Phase 1) + T&C page (Phase 1) + system prompt (Phase 2) + report cover and footer (Phase 5a). Phase 7 launch checklist gates on this.
- **Spike-then-cleanup pattern** for risky tech: Task 1 ran an RTL spike with `npm run pdf:spike` to validate Hebrew rendering before building the full report. The spike artifacts (`scripts/pdf-spike.ts`, `lib/pdf/spike.tsx`) were deleted after verification. `spike.pdf` is gitignored in case anyone runs a future spike.
- **Buffer-to-Response cast**: Node `Buffer` is not a Web `BodyInit`. The route casts `new Response(buffer as BodyInit, ...)` — necessary type workaround; runtime behavior is unchanged.

## Phase 5b architecture (30-day plan)

Turns a recommendation into a checkable 30-day action plan. Triggered from `/recommendations` via "צור תוכנית 30 יום" → `/plan` → "Generate" → `POST /api/plan/generate`. Each task is one row in `plan_tasks` so toggles are atomic single-row UPDATEs.

- **Archetype selection is deterministic** (`lib/plan/selectArchetype.ts`): top-1 path slot drives the archetype. Safe → "apply", Growth → "taste_test", Wildcard → "research". The chosen archetype's path occupation is the target the LLM customizes tasks toward.
- **One LLM call per plan** (`lib/plan/compose.ts`): zod 30-task schema (`day`, `title_he`, `description_he`, `category`, `estimated_minutes`). System prompt is prompt-cached (per the explanations.ts pattern). Profile + top-occupation + Hebrew prose feeds the user message.
- **One row per task** (`plan_tasks` table): toggle is `UPDATE plan_tasks SET done = $1 WHERE id = $2`. JSONB array would force read-modify-write of all 30 items per toggle — race-prone, slow.
- **Plans are per-recommendation_id**: regenerating recommendations means regenerating the plan. The route `DELETE`s any old plan for the same recommendation before inserting the new one — keeps "one plan per recommendation" invariant.
- **Authorization**: anonymous-OK. Same pattern as Phase 4/5a. RLS policy is on `plans` rows; `plan_tasks` policy joins through `plans` to check ownership. Service-role client used in `lib/db/plans.ts`.
- **UI grouping**: tasks render in 5 sections (week 1: days 1-7, ..., week 5: days 29-30). Each task row has a custom checkbox (a button with `role="checkbox"` and `aria-pressed`). Optimistic toggle UI with rollback on failure.

## Phase 5c architecture (save report + auth upgrade)

Adds the conversion surface: "שמור דוח" button on `/recommendations` opens a dialog with email magic-link sign-in or Google OAuth. **No new tables, no new auth provider** — reuses Phase 1's Supabase magic-link OTP + the existing `/auth/callback` route which already supports `?next=/recommendations`.

- **Promotion happens automatically** in `lib/anonymous.ts` `getOrCreateAnonymousUserId`: when an `authedUserId` first appears, the existing anonymous `users` row is UPDATEd in place (`auth_id = $1, is_anonymous = false`), preserving every attached conversation / recommendation / plan / assessment. The `co_anon` cookie is deleted, `anonymous_sessions` row removed. **Master roadmap §22 conversion event lands here.**
- **`SaveReportDialog`** is a thin wrapper around the Phase 1 sign-in pattern but in a Dialog. Same magic-link + Google buttons; redirects to `/auth/callback?next=/recommendations` so the user returns to where they left off, now signed in.
- **Visibility logic**: anonymous → show "שמור דוח" button; signed-in → show "✓ שמור בחשבון שלך" badge. Toggle via `supabase.auth.onAuthStateChange` subscription so the UI updates immediately after the callback round-trip.
- **No email-the-PDF feature** in this phase. The magic link IS the email — clicking it lands on `/recommendations` where the user can re-download. "Email me the PDF as attachment" is a Phase 5c.5 polish needing Resend integration.

## Phase 3b architecture (CV upload + skill extraction — "המראה")

Turns a CV upload into a reflective moment: the AI emits a short Hebrew **reflection** that streams character-by-character, while **skill cards** bloom in one-by-one underneath. User taps to dismiss/expand/add, then saves. Confirmed skills replace `career_profile.data.skills` and force-recompute `/api/recommendations`.

- **Three routes, not one**: `useObject` from `@ai-sdk/react` requires JSON POST, so the multipart upload + streaming extraction cannot share an endpoint.
  - `POST /api/cv/upload` — multipart, validates type/size, uploads to Supabase Storage, parses PDF/DOCX → returns `{id}` (fast, ~1s). Pre-writes `extracted_text` to the row.
  - `POST /api/cv/extract` — JSON `{cv_upload_id}`, reads `extracted_text` from DB, calls `streamText` with `Output.object({schema})`, returns AI SDK text stream. Client uses `useObject` to render partial objects as they arrive. Persists `reflection_he` + `extracted_skills` to DB in a `void (async () => { ... await result.output; ... })()` side-effect after returning the stream.
  - `POST /api/cv/confirm` — JSON `{cv_upload_id, skill_ids[]}`, hydrates `name_he` from taxonomy, writes to `career_profile.data.skills`. **First CV confirm only** archives prior chat skills to `data.skills_from_chat` — subsequent re-confirms just replace `.skills`.
- **AI SDK v6 modern API**: `streamText({ output: Output.object({schema}) })` replaces the deprecated `streamObject`. Same per-message `cacheControl` pattern on the system role as Phase 4 explanations — top-level `providerOptions` would mark the user message (which changes every call) as the cache breakpoint.
- **pdf-parse v2 has a class-based API** (`new PDFParse({data: buffer})` + `parser.getText()`), not v1's default-function export. Dynamic `await import("pdf-parse")` inside `lib/cv/parse.ts` since `pdf-parse` is server-only and large.
- **Profile skill shape stores BOTH `id` and `name_he`** (looked up from `content/skills/taxonomy.json` at confirm-time). Phase 4's substring-based skill scorer continues to work unchanged because it reads `name_he`. Phase 4.5 can switch to precise id-based matching without touching Phase 3b.
- **Skills outside taxonomy** are emitted as `"other:<phrase>"` ids by the LLM. User can promote them inline via Hebrew autocomplete over the taxonomy. `"other:..."` entries land in profile too but don't affect Phase 4 matching score (no `name_he` substring lookup hits).
- **Streaming UX**: skill cards animate in with a slide-up + fade keyframe (transform/opacity only, ≤200ms per UI rules). Reflection text appears as it streams (no typewriter library — `useObject` updates the React state on each chunk, React re-renders). Rotating status text ("מזהה כישורים טכניים..." → "מחפש ניסיון ניהולי...") is cosmetic and rotates every 2s — doesn't reflect actual LLM progress.
- **Archetype is deterministic** (`lib/cv/archetype.ts`): dominant category ≥45% → `builder` / `connector` / `analyst` / `leader` / `creator`; otherwise `generalist`. Mapped to Hebrew display names in `he.cv.success.archetypeNames`.
- **Storage bucket `cv-uploads`** is private, path convention `<user_id>/<uuid>.{pdf,docx}`. Reads/writes go through service-role from app server. Lifecycle (30-day auto-delete) is configured via Supabase Dashboard since pure-SQL primitives don't cover it.
- **Resume-on-revisit**: `/cv` reads the latest `cv_uploads` row. If `confirmed_at` is null but extraction exists, page lands the user back in the review state with the prior skills selection. If confirmed, lands in success state with re-upload option.

## Project-specific conventions

- **Hebrew RTL throughout**: `<html dir="rtl" lang="he">`. Use Tailwind `rtl:` variants and logical properties (`ms-*`, `me-*`) instead of `ml-*`/`mr-*` where layouts depend on direction.
- **All user-facing strings in `lib/i18n/he.ts`**. Never hard-code Hebrew in components. Future English would add `lib/i18n/en.ts`; component code reads from a locale-resolved object.
- **No MBTI**, no licensed psychometric tests. Use RIASEC + IPIP-NEO short form (open license) only, paraphrased into our own Hebrew items. The string `"MBTI"` should not appear in `lib/i18n/he.ts` or system prompts.
- **Matching is deterministic TypeScript, not LLM**. `lib/matching/engine.ts` is unit-tested. The LLM is called *after* scoring to write Hebrew prose explaining each match. Never let a matching score come out of Claude — it will be opaque, non-reproducible, and untestable.
- **Anonymous-first funnel**: first-time visitors get a `co_anon` cookie + `public.users` row with `is_anonymous = true`. Auth is required only when saving a report (Phase 5+). Don't gate `/chat` behind sign-in.
- **Prompt caching is mandatory**, not optimization. System prompt + occupation-catalog context cached via `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }`. Verify with `cache_read_tokens > 0` on turn 2 of any conversation.
- **Sensitive-state detection** runs on every user message (`lib/ai/safety.ts`). On a hit, do not continue assessment — respond with the templated handoff in `lib/i18n/he.ts → safety.distressFallback` and log the event.
- **Disclaimer ("not a clinical assessment") visible in 4 places**: chat header banner, report cover, T&C, system prompt. Lawyer-reviewed before public launch.

## Database

Migrations live in `supabase/migrations/<timestamp>_<name>.sql` and are managed by the Supabase CLI. After editing schema:

```powershell
npx supabase migration new <name>   # create file
# edit the file
npx supabase db push                # apply to remote
npm run db:types                    # regenerate lib/db/types.gen.ts
```

Never apply schema changes via the Dashboard SQL Editor — CI and fresh clones won't reproduce them.

## Commands

```powershell
npm run dev          # Next.js dev server
npm test             # Vitest unit/integration
npm run test:watch   # Vitest watch mode
npm run build        # production build
npm run db:types     # regenerate Supabase TS types from linked project
npx tsc --noEmit     # type check (also run in CI)
```

## Out of scope (don't add without explicit go-ahead)

- Mobile app (web responsive only)
- B2B dashboards beyond internal admin
- LinkedIn integration
- Marketplace (consultants/courses)
- Mid-career and 55+ flows
- Stripe / payments
- English UI

## Known gotchas

- `GITHUB_TOKEN` env var in this Claude Code session may force gh CLI to a non-tmotti77 account; commit author identity is correct via local git config, but `gh` operations may behave unexpectedly. Push manually if it matters.
- Supabase free tier auto-pauses inactive projects after 7 days; first request un-pauses (cold start ~2s).
- Vercel default function timeout is 10s on Hobby. Streaming chat works under that, but CV extraction calls (Phase 3) may need streaming or background jobs.
- Hebrew tokens cost ~1.5–2x English in Claude. Budget accordingly. Prompt caching offsets most of this.
