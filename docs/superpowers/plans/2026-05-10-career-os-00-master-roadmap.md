# CareerOS — Master Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase plan task-by-task. This master document is the *map*; bite-sized tasks live in the per-phase plans.

**Goal:** Ship a Hebrew-first career-guidance AI agent (working name: **CareerOS**) that takes an Israeli post-army / pre-studies / student user from "I have no idea what to do" to a personalized 3-paths PDF report and 30-day action plan, in 10–14 weeks of solo development.

**Architecture:** Single Next.js 16 (App Router) app on Vercel. Supabase for Postgres+pgvector+Auth+Storage. Anthropic Claude Sonnet 4.6 for all LLM work, with prompt caching wired in from day 1. Matching engine is deterministic TypeScript (the IP); the LLM generates conversational *explanation* only. PDF reports rendered via `@react-pdf/renderer` with Hebrew RTL fonts.

**Tech Stack:**
- Next.js 16, TypeScript, Tailwind CSS, shadcn/ui (Radix primitives)
- Supabase (Postgres + pgvector + Auth + Storage)
- `@anthropic-ai/sdk` (Claude Sonnet 4.6 + prompt caching)
- `@react-pdf/renderer` for PDF
- `pdf-parse` + `mammoth` for CV text extraction
- Vitest for unit/integration tests, Playwright for E2E (Phase 6)
- Vercel hosting + Vercel Analytics + Sentry for errors
- Hebrew RTL throughout, Heebo Google Font

---

## 1. Decisions baked into this plan

> **Stack decision log (intentional change from earlier discussions):** an earlier sketch of this product leaned toward **Next.js frontend + Python FastAPI backend + OpenAI + Vercel/Render/Neon**. This plan deliberately collapses that to **single Next.js app + Supabase + Anthropic Claude + Vercel**. Reasons: (1) one codebase, one deploy, one auth system halves Phase 1 scope; (2) Supabase bundles Postgres + pgvector + Auth + Storage, eliminating three separate vendors; (3) Anthropic prompt caching is materially cheaper than equivalent OpenAI patterns at the LLM volume this product needs, and Hebrew quality is comparable; (4) Vercel deploys a Next.js app in zero-config. The trade we're accepting is vendor consolidation risk — if Supabase or Anthropic become unviable, the migration is non-trivial. We accept that risk for MVP velocity. If you want the FastAPI/OpenAI variant instead, this plan is **not** the right starting point — say so before Phase 1 starts.

These were chosen during planning. Flag any you want to change *before* starting Phase 1:

| Decision | Choice | Why |
|---|---|---|
| Product working name | **CareerOS** | Shortest, keeps "OS" framing (§29 alt: "מערכת הפעלה אישית לקריירה"). Easy to rebrand later. |
| Stack | Next.js 16 + Supabase + Vercel + Claude | User-confirmed |
| MVP scope | Full §17.3 (11 features) | User-confirmed |
| Language | Hebrew only at launch | User-confirmed |
| Monetization | None at MVP (free) | User-confirmed |
| LLM | Anthropic Claude Sonnet 4.6 | Best Hebrew quality; native prompt caching; Anthropic's ToS allow this use |
| LLM cost control | Prompt caching enabled day 1 | ~6x cost reduction on system+occupations context |
| Matching engine | Deterministic TypeScript | §9 requires explainable scoring; LLM scoring is opaque and unstable |
| Auth | Supabase Auth (email magic link + Google) | Built-in, Hebrew error messages possible, no extra vendor |
| Anonymous start | Yes — first 5 chat turns without sign-up | Funnel-critical (don't gate the wow moment) |
| PDF | `@react-pdf/renderer` server-side | Stable, good Hebrew font support via custom font registration |
| CV extraction | `pdf-parse` (PDF) + `mammoth` (DOCX) → LLM structured extract | Cheap text extraction first, LLM only for structuring |
| Self-employment module (§30) | **Phase 7 (post-MVP)** | Significant scope; fits better as a v1.1 differentiator |
| Testing | Vitest + Playwright | Vitest is Vercel/Next.js-native; Playwright for cross-browser E2E |
| Deploy strategy | Preview-per-PR + production on `main` | Vercel default |
| Dev workflow | TDD where deterministic (matching engine, scoring); integration tests for AI surfaces | LLMs can't be unit-tested classically; matching can |

**Out of scope for this whole plan (Phases 1–7):**
- Mobile app (web responsive only)
- B2B dashboards (admin dashboard ships in Phase 6 but for *internal* admin only)
- LinkedIn integration
- Marketplace (consultants/courses)
- Mid-career and 55+ flows (§4.2, §4.3)
- Payment / Stripe
- English UI

---

## 2. Architectural decisions worth documenting

### 2.1 Why deterministic matching, not LLM matching
§9 specifies a weighted formula (25/20/15/15/15/10). LLM scoring would:
- Give different scores on identical input (non-reproducible).
- Make it impossible to debug "why did role X get rank 3?".
- Make A/B-testing weight changes meaningless.

Therefore: `lib/matching/engine.ts` is pure TypeScript with full unit-test coverage. The LLM is called *after* scoring to write Hebrew prose that explains *why* (§9 last paragraph). This separation is the most important architectural call in the project.

### 2.2 Profile extraction strategy
After each conversation *stage* (not each message — too expensive), call Claude with a structured-output prompt to extract:
```ts
{
  interests: { riasec: { R: number, I: number, A: number, S: number, E: number, C: number } },
  big_five_lite: { openness: number, conscientiousness: number, extraversion: number, agreeableness: number, neuroticism: number },
  skills: Array<{ skill_id: string, evidence: string, confidence: number }>,
  values: string[],
  constraints: { budget?: string, location?: string, timeAvailable?: string, riskTolerance?: 'low'|'med'|'high' }
}
```
Stages: (1) onboarding-finished, (2) chat-complete, (3) CV-uploaded, (4) RIASEC-completed, (5) Big5-completed, (6) values-completed. Stage transitions trigger one extraction call each. Result merged into `career_profile` row.

### 2.3 Anonymous-first funnel
Funnel reality: requiring auth before the user sees value kills 60–80% of conversion. Solution:
- First load creates an `anonymous_session` cookie + a `users` row with `is_anonymous = true`.
- User can chat for ~5 turns before any sign-up wall.
- Sign-up is required to *save the report* — we use this as the conversion event.
- On sign-up, the anonymous session is upgraded (UPDATE same row, set email/auth_id).

This is essential for §22 metrics ("% completed assessment") — we need anonymous users in the funnel or we won't have enough data.

### 2.4 Prompt-caching architecture
Anthropic prompt caching gives ~90% cost reduction on cached input tokens, with a 5-minute TTL. Strategy:
- System prompt (~2k tokens) cached.
- Occupation summary catalog (~5k tokens) cached.
- User profile + conversation history NOT cached (changes each turn).

In code: `lib/ai/client.ts` wraps the Anthropic SDK and always sends system+catalog as a `cache_control: { type: 'ephemeral' }` block. This costs us 25% extra on first call and 90% off on every subsequent call within 5 minutes — a huge net win for a chat session that averages 15+ turns.

### 2.5 Hebrew RTL strategy
- `<html dir="rtl" lang="he">` at root.
- Tailwind `rtl:` variants where layouts need flipping.
- `logical properties` (`ms-`/`me-` instead of `ml-`/`mr-`) wherever possible.
- Heebo font from Google Fonts via `next/font/google` (also embedded into PDF via `@react-pdf/font`).
- All user-facing strings in `lib/i18n/he.ts` (single Hebrew dictionary; future English would add `lib/i18n/en.ts`).

### 2.6 Privacy & compliance from day 1
- `consents` table with `purpose`, `version`, `accepted_at`, `revoked_at`.
- Hard-delete endpoint (`DELETE /api/me`) cascades through all tables.
- Sensitive-state detection: regex pre-check + Claude classifier on every user message. On hit → switch to a safe-handoff response template, do not continue assessment, log the event.
- "Not a clinical assessment" disclaimer banner: persistent in chat header, on report cover page, in T&C, in system prompt.
- No training on user data — explicit `Anthropic-Beta: prompt-caching-2024-07-31` only; no `--data-feedback` opt-in.

---

## 3. File structure (target end-state)

```
lai-lai/                                     # repo root
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx                         # landing
│   │   ├── privacy/page.tsx
│   │   └── terms/page.tsx
│   ├── (auth)/
│   │   ├── sign-in/page.tsx
│   │   └── auth/callback/route.ts
│   ├── (app)/
│   │   ├── layout.tsx                       # auth-required shell
│   │   ├── chat/page.tsx                    # main conversation
│   │   ├── chat/[id]/page.tsx
│   │   ├── assessment/
│   │   │   ├── riasec/page.tsx
│   │   │   ├── big5/page.tsx
│   │   │   └── values/page.tsx
│   │   ├── cv/page.tsx                      # CV upload + analysis
│   │   ├── recommendations/page.tsx         # 3 paths view
│   │   ├── report/[id]/page.tsx
│   │   ├── interview/page.tsx               # simulator
│   │   └── plan/page.tsx                    # 30-day plan
│   ├── api/
│   │   ├── chat/route.ts                    # streaming Claude
│   │   ├── chat/extract/route.ts            # profile extraction
│   │   ├── cv/upload/route.ts
│   │   ├── cv/extract/route.ts
│   │   ├── assessment/score/route.ts        # RIASEC + Big5 scoring
│   │   ├── recommendations/route.ts         # match + 3 paths
│   │   ├── report/[id]/pdf/route.ts         # PDF stream
│   │   ├── interview/route.ts
│   │   ├── feedback/route.ts
│   │   └── me/route.ts                      # GET profile, DELETE all
│   ├── layout.tsx                           # RTL root, fonts
│   └── globals.css
├── components/
│   ├── ui/                                  # shadcn primitives
│   ├── chat/
│   │   ├── ChatShell.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── InputBar.tsx
│   │   ├── DisclaimerBanner.tsx
│   │   └── StageProgress.tsx
│   ├── assessment/
│   │   ├── RIASECQuiz.tsx
│   │   ├── Big5Quiz.tsx
│   │   ├── ValuesPicker.tsx
│   │   └── ConstraintsForm.tsx
│   ├── cv/
│   │   ├── CVUploader.tsx
│   │   └── ExtractedSkillsView.tsx
│   ├── recommendations/
│   │   ├── PathCard.tsx
│   │   ├── ThreePathsView.tsx
│   │   └── ScoreBreakdown.tsx
│   ├── plan/
│   │   ├── ThirtyDayPlan.tsx
│   │   └── TaskRow.tsx
│   └── interview/
│       ├── InterviewShell.tsx
│       └── ModeSelector.tsx
├── lib/
│   ├── ai/
│   │   ├── client.ts                        # Anthropic + caching wrapper
│   │   ├── stream.ts                        # SSE / RSC streaming helpers
│   │   ├── prompts/
│   │   │   ├── system.ts                    # main agent system prompt (Hebrew)
│   │   │   ├── extraction.ts                # structured profile extraction
│   │   │   ├── interview.ts                 # interviewer personas
│   │   │   ├── plan.ts                      # 30-day plan generation
│   │   │   ├── cv.ts                        # CV → structured skills
│   │   │   ├── explanations.ts              # match-result prose
│   │   │   └── guardrails.ts                # sensitive-state classifier
│   │   └── safety.ts                        # regex pre-check + LLM classifier
│   ├── matching/
│   │   ├── engine.ts                        # the IP — deterministic scoring
│   │   ├── weights.ts                       # 25/20/15/15/15/10
│   │   ├── paths.ts                         # 3-paths bucketing (safe/growth/wildcard)
│   │   └── types.ts
│   ├── assessment/
│   │   ├── riasec/items.ts                  # Hebrew items (paraphrased, not licensed test)
│   │   ├── riasec/score.ts
│   │   ├── big5/items.ts                    # IPIP-NEO short form items
│   │   ├── big5/score.ts
│   │   └── values/options.ts
│   ├── cv/
│   │   ├── extract-text.ts                  # pdf-parse + mammoth
│   │   └── extract-structured.ts            # LLM call → SkillsExtraction
│   ├── pdf/
│   │   ├── ReportDocument.tsx               # @react-pdf component
│   │   ├── fonts.ts                         # Heebo registration
│   │   └── render.ts
│   ├── plan/
│   │   ├── templates.ts                     # 30-day archetypes
│   │   └── compose.ts                       # archetype + LLM customization
│   ├── supabase/
│   │   ├── server.ts                        # createServerClient (@supabase/ssr)
│   │   ├── client.ts                        # browser client
│   │   ├── middleware.ts                    # session refresh
│   │   └── service.ts                       # service-role client (server-only)
│   ├── db/
│   │   ├── queries.ts
│   │   └── types.gen.ts                     # generated from Supabase
│   ├── consent.ts
│   ├── anonymous.ts                         # anon session helpers
│   ├── i18n/
│   │   └── he.ts                            # all Hebrew strings
│   ├── analytics.ts                         # Vercel Analytics + custom events
│   └── env.ts                               # zod-validated env vars
├── content/
│   ├── occupations/                         # 100 hand-curated JSON files
│   │   ├── _schema.json
│   │   ├── product-manager.json
│   │   ├── qa-automation.json
│   │   └── ... (98 more)
│   ├── skills/
│   │   └── taxonomy.json                    # ~200 skills, Hebrew names
│   └── disclaimers.json                     # all legal/safety copy
├── tests/
│   ├── unit/
│   │   ├── matching/
│   │   │   ├── engine.test.ts
│   │   │   ├── paths.test.ts
│   │   │   └── weights.test.ts
│   │   ├── assessment/
│   │   │   ├── riasec-score.test.ts
│   │   │   └── big5-score.test.ts
│   │   ├── consent.test.ts
│   │   └── safety.test.ts
│   ├── integration/
│   │   ├── chat-flow.test.ts
│   │   ├── cv-upload.test.ts
│   │   └── report-generation.test.ts
│   └── e2e/
│       └── happy-path.spec.ts               # Playwright
├── scripts/
│   ├── seed-occupations.ts                  # loads content/occupations/*.json into DB
│   ├── validate-occupations.ts              # JSON-schema check
│   └── generate-supabase-types.ts
├── supabase/
│   └── migrations/
│       ├── 0001_init.sql                    # users, consents, anonymous_sessions
│       ├── 0002_conversations.sql           # conversations, messages
│       ├── 0003_career_profile.sql          # extracted profile per user
│       ├── 0004_assessments.sql             # riasec, big5, values, constraints
│       ├── 0005_occupations.sql             # occupations + skills taxonomy
│       ├── 0006_recommendations.sql         # generated recs + match scores
│       ├── 0007_reports.sql                 # generated PDFs + plans
│       ├── 0008_feedback.sql                # per-feature feedback
│       └── 0009_audit.sql                   # PII access log
├── public/
│   ├── fonts/                               # Heebo .ttf for PDF
│   └── og-image.png
├── .env.example
├── .gitignore
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── vitest.config.ts
├── playwright.config.ts
├── components.json                          # shadcn config
└── README.md
```

---

## 4. Phase plan (7 phases)

Time estimates assume one full-time builder. Halve for two.

### Phase 1 — Foundation (week 1–2, ~10 days)
**Goal:** repo runs, deploys, has auth + DB + a working but minimal Hebrew chat that talks to Claude.
**Plan file:** `2026-05-10-career-os-01-foundation.md` (bite-sized, ready to execute today).
**Outputs:**
- Next.js 16 app with Tailwind + shadcn/ui + RTL
- Supabase project linked, 4 migrations applied (users, consents, conversations, messages)
- Email magic-link + Google auth working
- Anonymous-session cookie working (chat without sign-up)
- `lib/ai/client.ts` with prompt caching
- `app/api/chat/route.ts` streams Claude responses with system prompt
- `app/(app)/chat/page.tsx` Hebrew chat UI with disclaimer banner
- Vitest set up, first tests for `lib/consent.ts` and `lib/matching/weights.ts` (tested empty engine)
- GitHub Actions: typecheck + test on PR
- Vercel preview deploys working

### Phase 2 — Conversation Engine + Profile Extraction (week 3–4)
**Goal:** the agent runs a full Hebrew assessment dialog and extracts structured profile.
**Plan file (to be written):** `2026-05-10-career-os-02-conversation-engine.md`
**Outputs:**
- Stage-aware system prompt (onboarding → interests → skills → values → constraints → wrap)
- Profile extraction LLM call after each stage transition
- `career_profile` table populated per user
- "What I heard from you" mid-conversation mirror screen (§10.5)
- Sensitive-state detection (`lib/ai/safety.ts`) running on every user turn
- Tone selector (§12: 5 tone presets)
- "Tachles mode" / "Support mode" toggle (§11.7, §11.8)
- Resume conversation across sessions

### Phase 3 — Formal Assessments + CV (week 5–6)
**Goal:** RIASEC questionnaire, Big5-lite questionnaire, values picker, constraints form, CV upload + skills extraction.
**Plan file (to be written):** `2026-05-10-career-os-03-formal-assessments.md`
**Outputs:**
- 30-item Hebrew RIASEC quiz (paraphrased public-domain items, *not* a licensed test)
- 20-item IPIP-NEO short form Big5 quiz, Hebrew
- Values picker UI (12 values from §8.4)
- Constraints form (§8.5)
- `assessments` table populated; deterministic scoring in `lib/assessment/`
- CV upload to Supabase Storage with size/type guards
- Text extraction (`pdf-parse` for PDF, `mammoth` for DOCX)
- LLM call to extract skills against taxonomy
- "Extracted skills — confirm/edit" UI

### Phase 4 — Occupations DB + Matching Engine (week 7–8)
**Goal:** 100 quality Israeli-market occupations seeded, matching engine returns ranked top-N with explainable breakdown.
**Plan file (to be written):** `2026-05-10-career-os-04-occupations-and-matching.md`
**Outputs:**
- `content/occupations/_schema.json` JSON Schema
- `scripts/validate-occupations.ts` enforces schema in CI
- 100 hand-curated occupation JSON files (Hebrew titles, salary ranges, demand, AI-risk, training time, prerequisites, skills, RIASEC affinity)
- ~200-skill Hebrew taxonomy in `content/skills/taxonomy.json`
- `scripts/seed-occupations.ts` loads JSON → DB
- `lib/matching/engine.ts` deterministic scorer with full unit tests (TDD)
- `lib/matching/paths.ts` 3-paths bucketing (safe/growth/wildcard heuristic)
- `lib/ai/prompts/explanations.ts` Hebrew prose generator for each match
- `app/api/recommendations/route.ts` produces 5 roles + 3 paths

**Curation note:** Occupation curation is ~80 hours of focused research — best done in *parallel* with Phase 3 code work, not after. Recommend hiring a career-counseling student or part-time researcher for this. Spec'd in this phase but track separately.

### Phase 5 — Report + 30-Day Plan (week 9–10)
**Goal:** generate the personal report PDF and the 30-day action plan as a checkable task list.
**Plan file (to be written):** `2026-05-10-career-os-05-report-and-plan.md`
**Outputs:**
- `lib/pdf/ReportDocument.tsx` Hebrew RTL PDF with: cover, profile mirror, 3 paths, top-5 roles, less-recommended roles + why, follow-up questions
- Heebo font registered in PDF + UI
- `lib/plan/templates.ts` 30-day archetype templates (research / taste-test / project / network / apply)
- `lib/plan/compose.ts` LLM customization of template by user profile
- `app/(app)/plan/page.tsx` checkable task list
- Email report link to user (Resend or Supabase email)
- "Save report" gates anonymous → registered conversion

### Phase 6 — Interview Sim + Feedback + Polish (week 11–12)
**Goal:** interview simulator works for HR + technical modes, feedback loop captures quality signals, UX polish.
**Plan file (to be written):** `2026-05-10-career-os-06-interview-and-feedback.md`
**Outputs:**
- `app/(app)/interview/page.tsx` mode selector + chat shell
- HR / technical / first-job / salary-negotiation interviewer personas
- Per-message feedback (thumbs + optional text)
- Per-feature NPS prompt
- `feedback` table + admin export
- Empty/loading/error states everywhere
- Mobile responsive QA pass
- Accessibility pass (focus rings, aria-labels, 44px tap targets, contrast)
- Sentry wired for errors
- Vercel Analytics events for §22 product metrics

### Phase 7 — Compliance, Launch Prep, Self-Employment (week 13–14)
**Goal:** legally launchable, observability complete, §30 self-employment module landed as v1.1 differentiator.
**Plan file (to be written):** `2026-05-10-career-os-07-compliance-and-self-employment.md`
**Outputs:**
- Privacy policy page + T&C page (Hebrew, lawyer-reviewed externally)
- GDPR-style data export endpoint
- Hard-delete endpoint with cascading deletes + audit log
- Cookie consent banner
- §30 self-employment module: fit-to-self-employment scoring + business idea generator
- Admin dashboard (internal only): conversations, recommendations, feedback, errors
- Load testing (k6 or Artillery) — does the chat handle 50 concurrent users?
- Production launch checklist
- Beta-tester recruitment (10–20 users from §17.2 audience)

---

## 5. KPIs & success criteria (per §22)

Track from day 1 — wire `lib/analytics.ts` in Phase 1.

| Metric | Target by end of Phase 7 |
|---|---|
| Funnel: visitors → first chat message | ≥ 35% |
| Funnel: first message → assessment complete (all 4 stages) | ≥ 25% |
| Funnel: assessment complete → report viewed | ≥ 90% |
| Funnel: report viewed → user signs up to save | ≥ 50% |
| Funnel: signed up → return within 7 days | ≥ 30% |
| Funnel: signed up → ≥ 1 task in 30-day plan completed | ≥ 25% |
| Quality: "did the agent understand you?" thumbs-up rate | ≥ 80% |
| Quality: "is at least one path new and relevant?" yes rate | ≥ 70% |
| Quality: human-counselor agreement that report is sensible (sample of 30) | ≥ 75% |
| Cost: Claude API spend per *completed* assessment | ≤ $0.50 |
| Cost: total infra (Supabase + Vercel) | ≤ $100/mo at <1k MAU |

---

## 6. Top risks and mitigations

| Risk | Phase it bites | Mitigation |
|---|---|---|
| Generic-feeling recommendations (the death of any career-AI product) | 4 | Quote user phrases verbatim in explanations; require ≥ 2 specific evidence points per recommendation; Phase 6 user-testing gate before launch |
| Occupation DB stale or wrong | 4 | Hire researcher; ship `data_source` + `last_verified_at` fields; quarterly review process documented |
| LLM cost runaway from chatty users | 2, 6 | Prompt caching (Phase 1); per-conversation token cap (auto-summarize after 50 turns); per-user daily cap |
| Sensitive-state false negative (user in distress not detected) | 2 | Two-layer detection (regex + Claude classifier); err on side of false positive; manual review of 100 conversations weekly during beta |
| Privacy/legal classification as "diagnostic tool" | 7 | Disclaimer in 4 places; lawyer review of T&C before launch; external review by a קצין יועץ קריירה (RIA association) |
| Hebrew tokenization eating budget | 2 | Measure token use in Phase 1; if averaging > 8k input/turn, add summarization |
| RTL layout regressions in PDF | 5 | Phase 5 spec includes ≥ 5 sample profiles + visual snapshot tests of generated PDFs |
| Vercel function timeout on long extraction | 2, 3 | Stream all LLM responses; for CV extraction, return early and process in background (Vercel Background Functions or Supabase Edge Functions) |
| MBTI accidentally creeps in | 1, 2 | Lint rule banning the string "MBTI" in Hebrew strings file; system prompt forbids it explicitly (§20 rule 5) |
| Solo-builder burnout | 4–7 | Curation work is parallelizable — consider a part-time researcher from week 5 |

---

## 7. Pre-Phase-1 checklist

Do these before opening `2026-05-10-career-os-01-foundation.md`:

- [ ] Decide and lock the legal entity (אני / חברה בע"מ / עוסק פטור) — needed before privacy policy mentions a controller
- [ ] Register the working name `CareerOS` (or chosen final name) — domain + GitHub org + Vercel team
- [ ] Buy domain (`.co.il` recommended for trust with Hebrew users; `.ai` if budget allows)
- [ ] Create Supabase account + new project (free tier OK for Phase 1–4)
- [ ] Create Anthropic account + provision API key with $50–$100 starter credit
- [ ] Create Vercel account + connect to GitHub
- [ ] Create Sentry account (free tier)
- [ ] Decide whether to engage a part-time occupation researcher for Phase 4 (week 7 start)
- [ ] Identify 5 prospective beta users from the §17.2 audience for Phase 6 testing
- [ ] Read and acknowledge §15.2 (sensitive-state detection) — agree this is a hard requirement, not optional

---

## 8. How to use this plan

1. **Today:** open `2026-05-10-career-os-01-foundation.md` and execute. It's bite-sized and TDD where it matters.
2. **End of Phase 1:** before starting Phase 2, ask me to write `2026-05-10-career-os-02-conversation-engine.md` based on what you learned in Phase 1. Don't pre-commit to detail that may change.
3. **At any phase boundary:** review §22 KPIs and §6 risks against reality. Cut scope or re-plan if numbers warrant.
4. **At end of Phase 4:** decide whether to launch a closed beta (recommended) or push to Phase 5+6 first. The honest answer depends on whether the matching feels right yet.

---

## 9. What this plan deliberately does not include

- Detailed bite-sized tasks for Phases 2–7 (those plans are written when we get there — pre-writing them now is speculation that ages badly)
- Cost projections beyond Phase 1 (depends on scale, which depends on Phase 1 results)
- Marketing/growth plan (separate document)
- Investor pitch (separate document)
- Hiring plan (separate document)
- Detailed per-occupation curation (that's research work, not a code plan)

---

**Next:** `2026-05-10-career-os-01-foundation.md` — Phase 1 in bite-sized tasks, ready to execute.
