# CareerOS

סוכן AI להכוונה מקצועית בעברית — מערכת הפעלה לקריירה שלך.

CareerOS is a Hebrew-first AI career guidance agent for Israeli post-army / pre-studies / student users. The product takes a user from "I have no idea what to do" to a personalized 3-paths PDF report and 30-day action plan via a conversational assessment.

## Stack

Next.js 16 · TypeScript · Tailwind v4 · shadcn/ui · Supabase (Postgres + pgvector + Auth + Storage) · Anthropic Claude (via Vercel AI SDK with prompt caching) · Vitest · Vercel hosting

## Local development

```bash
cp .env.example .env.local
# Fill in: SUPABASE_SERVICE_ROLE_KEY (Dashboard → Project Settings → API)
#         ANTHROPIC_API_KEY (console.anthropic.com)
#         ANTHROPIC_MODEL (verify current model ID — see comment in .env.example)
npm install
npm run dev          # http://localhost:3000/chat
npm test             # vitest unit/integration
npm run db:types     # regenerate Supabase types (requires `supabase login` + `supabase link` first)
npx tsc --noEmit     # type check
```

## Database migrations

Migrations live in `supabase/migrations/<timestamp>_<name>.sql` and are git-tracked source of truth. To apply:

```bash
npx supabase login          # one-time
npx supabase link --project-ref wqswamtcppjmkwykukjp
npx supabase db push
```

Never apply schema changes via the Dashboard SQL Editor — CI and fresh clones won't reproduce them.

## Project layout

- `app/` — Next.js App Router routes (chat, sign-in, marketing, API)
- `components/ui/` — shadcn primitives
- `components/chat/` — chat UI (shell, list, input, disclaimer, consent dialog)
- `lib/ai/` — Anthropic client wrapper + prompts
- `lib/supabase/` — server, browser, service-role clients + middleware
- `lib/anonymous.ts` — anonymous-first session helpers
- `lib/consent.ts` — consent recording
- `lib/db/` — query helpers + generated types
- `lib/i18n/he.ts` — all Hebrew strings (single dictionary)
- `tests/` — Vitest unit + integration
- `supabase/migrations/` — git-tracked DB schema

## Plans

Phase 1 (foundation) is in this branch. Subsequent phases are written when their phase begins.

- `docs/superpowers/plans/2026-05-10-career-os-00-master-roadmap.md` — 7-phase roadmap, decisions, KPIs, risks
- `docs/superpowers/plans/2026-05-10-career-os-01-foundation.md` — Phase 1 detailed tasks
- `CLAUDE.md` — project context for AI coding sessions

## Vercel deploy (manual)

1. Connect this GitHub repo at vercel.com → Add New → Project → Import.
2. In Project Settings → Environment Variables, add the 6 server vars (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `NEXT_PUBLIC_SITE_URL`.
3. Add `https://<your-vercel-domain>/auth/callback` to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.
4. Push to `main` (or open a PR) — Vercel deploys automatically.
