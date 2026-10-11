# Agent Development Guide

> For human developers, see [CLAUDE.md](./CLAUDE.md). This document is specifically for AI agents (Claude, Codex) working on this codebase.

## Stack Reference

- **Runtime**: Node.js v24 (enforced via `engines` in package.json)
- **Framework**: Next.js 16 (App Router, RSC)
- **Language**: TypeScript 5
- **Styling**: Tailwind v4 + shadcn/ui (Radix primitives), RTL-first
- **Database**: Supabase (Postgres + pgvector + Auth + Storage)
- **LLM**: Anthropic Claude via Vercel AI SDK (`ai` + `@ai-sdk/anthropic`)
- **Testing**: Vitest (unit/integration), Playwright (E2E), axe-core (a11y)
- **Linting**: ESLint (Next.js config)
- **Package Manager**: npm (use `npm ci` in CI, `npm install` locally)

## Commands (Always Use These)

```powershell
# Install dependencies
npm ci                # CI/fresh clone
npm install           # adding/updating packages

# Development
npm run dev           # Start dev server (port 3000)

# Quality checks (run BEFORE committing)
npm run lint          # ESLint
npx tsc --noEmit      # Type checking
npm test              # Run tests

# Build
npm run build         # Production build

# Database
npm run db:types      # Regenerate Supabase types after schema changes
```

## Conventions

### File Organization

- **API routes**: `app/api/*/route.ts`
- **Pages**: `app/*/page.tsx`
- **Components**: `components/` (organized by feature)
- **Business logic**: `lib/` (organized by domain)
- **Database**: `lib/db/` (queries, types)
- **Tests**: `tests/unit/`, `tests/integration/`, `tests/e2e/`
- **Migrations**: `supabase/migrations/` (timestamped SQL files)
- **Content**: `content/` (occupations, skills taxonomy)
- **Scripts**: `scripts/` (one-off utilities, not app code)

### Code Style

- **Hebrew strings**: ALWAYS in `lib/i18n/he.ts`, never hard-coded in components
- **RTL**: Use Tailwind `rtl:` variants and logical properties (`ms-*`, `me-*`)
- **Imports**: Use absolute imports via `lib/`, `components/`, etc.
- **Type safety**: No `any` unless absolutely necessary (document why)
- **Error handling**: Always handle API errors, show user-friendly messages
- **Comments**: Comment *why*, not *what*. Remove obvious/redundant comments.

### Architectural Rules (NEVER VIOLATE)

1. **Matching engine is deterministic TypeScript**, never LLM-generated scores
2. **Safety check (`checkUserMessage`) runs on EVERY user message** before LLM calls
3. **Consent enforcement** (`requireConsent`) on every mutation API route
4. **Service-role client** for DB writes in server-side functions (never anon-key for writes)
5. **Prompt caching mandatory** via `providerOptions.anthropic.cacheControl`
6. **SECURITY DEFINER functions** must have explicit `REVOKE EXECUTE` in migrations
7. **Anonymous-first**: don't gate features behind auth unless required (e.g., save report)

### Testing Requirements

- **Unit tests** for pure functions (scoring, validation, parsing)
- **Integration tests** for API routes (mock external services)
- **Test file naming**: `*.test.ts` or `*.test.tsx`
- **Coverage**: aim for ≥80% on critical paths (matching, safety, consent)
- **Test data**: use fixtures, never production data or real API keys

### Database Migrations

- **Never use Dashboard SQL Editor** for schema changes
- **Always create migration**: `npx supabase migration new <name>`
- **Apply to remote**: `npx supabase db push`
- **Regenerate types**: `npm run db:types`
- **RLS policies**: every table must have appropriate policies
- **Service role exceptions**: document why when bypassing RLS

## Code Review Rules

When reviewing code (as Codex or another agent), check these items:

### Critical ❌ (must fix before merge)

- [ ] **No secrets in code** (API keys, tokens, passwords)
- [ ] **No direct push to `main`** (always via PR)
- [ ] **Safety check present** on user-facing LLM routes
- [ ] **Consent enforcement** on mutation routes
- [ ] **Type safety**: no `any` without justification
- [ ] **Tests present** for new logic (functions, routes, components)
- [ ] **Migrations have REVOKE** for SECURITY DEFINER functions
- [ ] **Hebrew strings in i18n**, not hard-coded

### Important ⚠️ (fix or justify)

- [ ] **Deterministic logic** not delegated to LLM (matching, scoring, validation)
- [ ] **Service-role client** used for DB writes, not anon-key
- [ ] **Prompt caching** configured correctly (cache-control on stable parts)
- [ ] **Error handling** comprehensive and user-friendly
- [ ] **RTL-aware styling** (logical properties, `rtl:` variants)
- [ ] **Accessibility** (semantic HTML, ARIA when needed, keyboard nav)
- [ ] **No prop drilling** (use context or state management for deep props)

### Style 💅 (nice to have)

- [ ] **Comments explain why**, not what
- [ ] **Function length** reasonable (prefer <50 lines)
- [ ] **DRY**: no copy-paste code (extract shared logic)
- [ ] **Naming**: clear, descriptive, consistent with codebase conventions
- [ ] **File size**: consider splitting files >500 lines

### PR Size Guidelines

- **Target**: 100-400 lines changed (excluding generated/config files)
- **Max**: 800 lines (larger PRs need justification)
- **Split large changes**: separate refactor, feature, tests into multiple PRs when possible

### Review Process (for Codex or Claude Code)

When reviewing PRs (OpenAI Codex via `@codex review` or Claude Code via `claude-review.yml`):

1. **Read the plan** (`docs/plans/<issue>.md`) to understand intent
2. **Check plan critique** (should be committed before implementation)
3. **Verify tests first** (TDD: tests should be written before/with implementation)
4. **Review implementation** against checklist above
5. **Check CI passed** (lint, typecheck, tests, build)
6. **Comment on specific lines** for issues (not just summary)
7. **Request changes** if Critical items failed
8. **Approve** only if Critical passed and Important justified

**Note**: OpenAI Codex reads these rules automatically when triggered via `@codex review` comment (configured at chatgpt.com/codex). Claude Code uses them when invoked via `.github/workflows/claude-review.yml`.

## NEVER Do

1. ❌ **Push directly to `main`** (always create PR)
2. ❌ **Commit secrets** (use `.env.local`, never `.env` or code)
3. ❌ **Edit these files without approval**:
   - `.env.example` (template, not secrets)
   - `CLAUDE.md`, `AGENTS.md` (meta-documentation)
   - `package.json` `engines` or `scripts` (stable API)
   - Migration files (immutable once applied)
4. ❌ **Bypass safety checks** (don't remove `checkUserMessage`)
5. ❌ **Skip consent enforcement** (don't remove `requireConsent`)
6. ❌ **Use LLM for deterministic logic** (matching scores, validation)
7. ❌ **Hard-code Hebrew text** (always use `lib/i18n/he.ts`)
8. ❌ **Apply schema changes via Dashboard** (migrations only)
9. ❌ **Create PRs >800 lines** without justification
10. ❌ **Merge PRs without CI green** (lint, typecheck, tests must pass)

## Reliability & Error Handling

### For Autonomous Runs (Claude Agent)

When running autonomous commands (e.g., `claude -p --max-turns 20`):

1. **Wrap with timeout**: `timeout 1h claude -p --max-turns 20`
2. **Write status file**: `runs/<run-id>/status.json` with `{ "status": "done|failed|timeout", "timestamp": "...", "message": "..." }`
3. **Write log file**: `runs/<run-id>/log.txt` with stdout/stderr
4. **Push WIP commits**: after each major step (test file, implementation, fix)
5. **End with comment**: always post a summary comment on the issue/PR

### For Code Review (Codex)

When running `codex exec review`:

1. **Wrap with timeout**: `timeout 30m codex exec review`
2. **Write status**: `runs/<run-id>/status.json` with outcome
3. **Write feedback**: `runs/<run-id>/review.md` with detailed feedback
4. **Post to PR**: comment with summary + link to detailed review
5. **Exit code**: 0 for approve, 1 for request changes

### Error Recovery

- **Network failures**: retry up to 3 times with exponential backoff (2s, 4s, 8s)
- **LLM failures**: log error, use fallback (template response for safety, error message for features)
- **DB failures**: log error, return 500 with generic message (don't leak schema details)
- **Build failures**: log full output, exit non-zero (CI will catch)

## Context & Background

See [CLAUDE.md](./CLAUDE.md) for full project context, phase architecture, and decision rationale. Key points:

- **Product**: Hebrew-first AI career guidance (post-army / student users)
- **IP**: Deterministic matching engine (TypeScript), not LLM
- **Stack decision**: Single Next.js app (no separate backend) for MVP velocity
- **Privacy**: Anonymous-first, GDPR-compliant consent flow, minimal PII
- **Launch**: Phase 7 (pending as of 2026-05-20)

## Questions?

For project-specific questions, check:
1. [CLAUDE.md](./CLAUDE.md) — full project context
2. [docs/superpowers/plans/](./docs/superpowers/plans/) — phase plans and specs
3. Existing code — follow established patterns
4. Ask the developer (Moti) via issue comment
