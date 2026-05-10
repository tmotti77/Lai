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
- `docs/superpowers/plans/2026-05-10-career-os-01-foundation.md` — Phase 1 bite-sized tasks (current)
- Phases 2–7: write each plan when its phase begins (don't pre-write speculatively)

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
