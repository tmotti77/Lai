# CareerOS — Phase 4: Occupations DB + Matching Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the matching engine — the IP of the product. Take a user's profile (chat-extracted from Phase 2 + formal assessments from Phase 3a) and produce a deterministic ranked list of occupations, a 3-paths recommendation (safe / growth / wildcard), and Hebrew prose explanations. The user-visible result is the `/recommendations` page; the architectural result is `lib/matching/engine.ts` — pure TypeScript, fully unit-tested, reproducible across runs.

**Architecture:** Two layers. **Layer 1 (deterministic):** `lib/matching/engine.ts` consumes a profile + the occupations catalog and returns numerical scores per occupation broken down by 6 dimensions (interests 25 / skills 20 / values 15 / big5 15 / constraints 15 / market 10 — totals 100 per master roadmap §9). Each dimension is a separately-tested pure function that returns 0–100. The combiner re-normalizes weights when profile dimensions are missing (e.g. user chatted but didn't take Big5 → re-weight over 5 dimensions, not 6). **Layer 2 (LLM prose):** `lib/ai/prompts/explanations.ts` takes the top-N rankings and the user's profile and asks Claude to write Hebrew explanations of *why* each role fits — quoting user phrases verbatim where possible (master roadmap §6 risk mitigation against generic-feeling recs). The LLM never produces a score; it only narrates one. **Caching:** `recommendations` table stores results keyed on a `profile_hash` so a chat turn that adds nothing new doesn't burn LLM tokens.

**Tech Stack:** Builds on Phase 1 (foundation) + Phase 2 (chat + safety) + Phase 3a (formal assessments). Adds: `content/occupations/*.json` (hand-curated catalog), `content/skills/taxonomy.json`, deterministic scoring TS, `tsx` (already present via `next`) for running the seed script. No new external deps for the engine; the prose generator reuses the existing `@ai-sdk/anthropic` + prompt-cached client from Phase 1.

---

## 1. Decisions baked into this plan

| Decision | Choice | Why |
|---|---|---|
| Scoring | **Pure deterministic TypeScript** | Same input → same output. Unit-testable. CLAUDE.md §"Matching is deterministic TypeScript" already enshrines this. The §22 KPI "human-counselor agreement that report is sensible" requires reproducible scoring to A/B test weight tweaks. |
| Weighted formula | **25/20/15/15/15/10** (interests / skills / values / big5 / constraints / market) | Master roadmap §9 spec. Total = 100. |
| Missing dimensions | **Re-normalize weights over present dimensions** | Honest. If user didn't take Big5, we don't fake a score — we re-weight over the 5 we have. Alternative ("default to 50") would bias every result toward "neutral fit." |
| Catalog size at launch | **20 hand-curated occupations**, not 100 | Master roadmap §4.4 calls for 100 over 80 hours of curation. That's research, not engineering. 20 covers the major Israeli post-army segments and proves the engine works. Catalog grows incrementally — Phase 4.5 expands toward 100. |
| Skill taxonomy size | **~60 skills**, not 200 | Same reason — enough to differentiate the 20 occupations meaningfully. Grows alongside the occupation catalog. |
| Catalog storage | **JSON files in `content/occupations/`**, seeded into Postgres on deploy | Source of truth is git-tracked JSON; DB is a queryable cache. Same pattern as quiz items in Phase 3a. |
| Skill matching | **Fuzzy Hebrew substring against taxonomy** for chat-extracted free-form skills | LLM-mapped skill extraction is Phase 3b (CV upload). For Phase 4, free-form skill labels from chat extraction get matched to `taxonomy.name_he` substrings. Lossy but acceptable for MVP. |
| 3-paths bucketing | **Heuristic on top of the ranking** (not pure top-3) | Master roadmap §22 KPI: "is at least one path new and relevant". Pure top-3 would just give 3 nearby roles. Bucketing picks one safe (low-risk fit), one growth (high score with stretch), one wildcard (medium score with high upside) so the user sees a range. |
| LLM prose | **Generated AFTER scoring**, reads the breakdown | LLM never produces a number. It reads scores + profile + occupation summary and writes Hebrew prose explaining *why*. Quotes user verbatim where possible (§6 generic-rec mitigation). |
| Caching | **`recommendations` table keyed on `profile_hash`** | Stable hash of `{interests, skills, values, big5, constraints, picked-occupations-version}`. If hash matches a recent row (within ~7 days), reuse — don't recompute or pay LLM. If hash changes, recompute. |
| Trigger | **On-demand** when user visits `/recommendations` | Simpler than push-based recompute on every chat turn. Visiting the page → check cache → recompute if needed. |
| Authentication | **Anonymous-OK** | Same anonymous-first principle as Phases 1-3a. The recommendation gates conversion (Phase 5), not the rendering. |
| Profile completeness | **Engine runs on whatever's there** with re-normalized weights | A user who only chatted gets recommendations weighted across the 4 dimensions chat extraction covers (interests/skills/values/constraints). A user who also took RIASEC + Big5 gets all 6 dimensions. |
| Audit fields on every occupation | **`data_source` + `last_verified_at`** | Master roadmap §6 risk mitigation — occupation DB stale or wrong is a top risk. Every JSON has these so we know what to re-verify. |

**Out of scope for this plan (Phase 4.5 / 5 / later):**
- Catalog expansion to 100 occupations (Phase 4.5 — research work, parallel track)
- LLM-based skill-extraction-to-taxonomy mapping (Phase 3b)
- PDF report generation (Phase 5)
- 30-day plan composition (Phase 5)
- "Less-recommended roles + why" section (Phase 5 report)
- Adaptive weights per user demographic (Phase 7+)
- Cross-field constraint validation in the engine ("immediate income + 36 months training" contradicts) — engine returns the lower fit score; UI surfaces the conflict in Phase 5 polish

---

## 2. Architectural notes worth documenting

### 2.1 Why deterministic + LLM-prose split (re-stating the load-bearing decision)
LLM scoring would (a) give different scores on identical input across runs (non-reproducible), (b) make weight A/B testing meaningless, (c) make it impossible to debug "why did role X get rank 3?". The split: numbers come from `lib/matching/score/*.ts` (each a pure function with unit tests); prose comes from `lib/ai/prompts/explanations.ts` (LLM call after scoring, gets the score breakdown as input, narrates it in Hebrew). This is the most important architectural call in the project. Don't undo it.

### 2.2 Re-normalizing weights for missing dimensions
The 25/20/15/15/15/10 weights assume all 6 dimensions are populated. If `profile.big5` is null (user didn't take Big5), the engine drops that dimension and re-normalizes the remaining weights so they still sum to 100. Implementation: 
```ts
const present = dimensions.filter((d) => profile[d.name] != null);
const totalPresentWeight = present.reduce((a, d) => a + d.weight, 0);
// each present dimension gets `weight / totalPresentWeight * 100`
```
Result: a chat-only user (interests, skills, values, constraints — no big5, no market for them yet) gets weights re-normalized across 4 dimensions. This is honest; defaulting missing dimensions to 50 would silently bias every user toward "neutral fit."

### 2.3 Why caching keys on profile_hash, not user_id
A user can come back tomorrow without changing anything — their recommendations should not regenerate (cost, latency). But a user who took an assessment between visits has a meaningfully different profile. `profile_hash` distinguishes these. Hash inputs: `{ interests-from-chat, skills-from-chat, values-from-chat, constraints-from-chat, riasec-scores, big5-scores, values-formal, constraints-formal, occupations-catalog-version }`. Stable hash via `JSON.stringify` after sorted keys + SHA-1.

### 2.4 The 3-paths heuristic
The ranked output gives top-N by total score. The 3 paths are picked from that ranking by these rules, in order:
- **Safe path:** highest-ranked occupation where `constraints` sub-score ≥ 75 (fits the user's constraints tightly) AND `typical_training_months ≤ 6` AND `market.demand_he ∈ {high, very_high}`.
- **Growth path:** highest-ranked occupation NOT chosen as safe, where `interests` sub-score ≥ 70 AND `typical_training_months ∈ [6, 18]` AND `market.demand_he ∈ {medium, high, very_high}`.
- **Wildcard path:** highest-ranked occupation NOT chosen as safe or growth, where `riasec_affinity` matches a non-dominant user type (e.g. Artistic-leaning role for a user whose Holland code is "ICS") AND `total_score ≥ 60`.

Fallbacks: if no occupation matches a path's criteria, that slot returns `null`. UI shows "no clear N-path option for your profile" in that case rather than showing a forced bad fit.

### 2.5 Why occupations live in JSON files, not seeded into the DB by hand
- Source of truth is git-tracked.
- Reviewable as PRs (a part-time researcher edits JSON → opens PR → maintainer reviews).
- `scripts/validate-occupations.ts` enforces the schema in CI.
- `scripts/seed-occupations.ts` upserts JSONs into Postgres — rerunnable, idempotent.
- Schema is `content/occupations/_schema.json` (JSON Schema draft-07).

### 2.6 Skill taxonomy as a separate concept
Skills live in `content/skills/taxonomy.json`. Each occupation references skills by `id` (not free-form text). This decouples occupation curation from skill curation: you can rename or re-categorize a skill without rewriting every occupation that references it.

### 2.7 The `recommendations` table caches the full result, not just the ranking
- `rankings` jsonb — top-N with breakdown (so the UI can render score breakdowns without recomputing)
- `paths` jsonb — chosen safe/growth/wildcard occupation ids
- `prose` jsonb — Hebrew explanations per top-N role (the expensive LLM output we don't want to regenerate)
- `profile_hash` text — cache key
- `generated_at` timestamptz — for staleness checks

Cache lifetime: ~7 days OR until profile_hash changes, whichever is sooner. The 7-day lifetime hedges against catalog updates between visits.

### 2.8 Item-quality vs. catalog-quality
Just like Phase 3a's items v1, the 20 occupation JSONs are "best-effort v1" written from public market knowledge. They need expert validation before public launch (master roadmap §6 risk: "Occupation DB stale or wrong"). Each JSON file has `data_source: "public_knowledge_v1"` and `last_verified_at` set to the seed date — Phase 7's launch checklist gates on a curator-reviewed pass.

---

## 3. File structure (target end-state for Phase 4)

```
content/
├── occupations/                                # NEW directory, hand-curated
│   ├── _schema.json                            # JSON Schema for an occupation row
│   ├── software-developer.json
│   ├── qa-automation.json
│   ├── product-manager.json
│   ├── ux-designer.json
│   ├── data-analyst.json
│   ├── devops-engineer.json
│   ├── nurse.json
│   ├── physiotherapist.json
│   ├── elementary-teacher.json
│   ├── special-ed-teacher.json
│   ├── social-worker.json
│   ├── industrial-engineer.json
│   ├── accountant.json
│   ├── account-executive-saas.json
│   ├── digital-marketer.json
│   ├── graphic-designer.json
│   ├── chef.json
│   ├── electrician.json
│   ├── lab-technician.json
│   └── operations-manager.json
└── skills/                                     # NEW directory
    └── taxonomy.json                           # ~60 skills

scripts/
├── validate-occupations.ts                     # NEW: JSON-schema check, CI-runnable
└── seed-occupations.ts                         # NEW: loads content/* into Postgres

lib/matching/                                   # NEW directory
├── types.ts                                    # MatchingProfile, Occupation, Score, Ranking, Paths
├── weights.ts                                  # WEIGHTS const + DIMENSIONS array
├── score/
│   ├── interests.ts                            # scoreInterests(profile, occupation): 0..100
│   ├── skills.ts
│   ├── values.ts
│   ├── big5.ts
│   ├── constraints.ts
│   └── market.ts
├── engine.ts                                   # rankOccupations(profile, occupations)
├── paths.ts                                    # pickPaths(rankings)
└── hash.ts                                     # profileHash(profile, catalogVersion)

lib/ai/prompts/
└── explanations.ts                             # NEW: LLM Hebrew prose generator

lib/db/
├── occupations.ts                              # NEW: loadAllOccupations, loadById
└── recommendations.ts                          # NEW: getCached, save, invalidate

app/api/recommendations/route.ts                # NEW: POST/GET (idempotent generate)

app/(app)/recommendations/page.tsx              # NEW

components/recommendations/                     # NEW directory
├── PathCard.tsx
├── ThreePathsView.tsx
├── ScoreBreakdown.tsx
└── EmptyProfileState.tsx                       # shown if profile has zero signal

lib/i18n/
└── he.ts                                       # MODIFIED: add recommendations.* section

supabase/migrations/
└── <timestamp>_occupations_and_recommendations.sql

tests/unit/matching/                            # NEW directory
├── score-interests.test.ts
├── score-skills.test.ts
├── score-values.test.ts
├── score-big5.test.ts
├── score-constraints.test.ts
├── score-market.test.ts
├── engine.test.ts                              # combine + re-normalization
├── paths.test.ts                               # 3-paths heuristic
└── hash.test.ts                                # stable hashing

tests/integration/
└── recommendations-flow.test.ts                # NEW: end-to-end with fake profile + 5 fake occupations
```

---

## 4. Pre-flight (do once before Task 1)

- [ ] Confirm Phase 3a is fully on `main` and CI is green (`git log --oneline -3`)
- [ ] Confirm `npm run dev` works and `/assessment` hub loads
- [ ] Confirm Phase 3a's `getProfile()` returns `formal.{riasec,big5,values,constraints}` (verified end-of-Phase-3a)
- [ ] Read `lib/db/profile.ts` once — Phase 4 consumes it
- [ ] Decide: do we want a part-time researcher curating occupations in parallel? (Master roadmap §4 says yes; this plan ships the engine on 20 self-curated occupations meanwhile.)

---

## Task 1: Migration — `occupations`, `skills`, `recommendations`

**Files:**
- Create: `supabase/migrations/<timestamp>_occupations_and_recommendations.sql`

- [ ] **Step 1: Generate migration file**

```powershell
npx supabase migration new occupations_and_recommendations
```

- [ ] **Step 2: Write SQL**

```sql
-- Skills taxonomy
create table public.skills (
  id text primary key,
  name_he text not null,
  category text not null
    check (category in ('technical','soft','analytical','creative','social','managerial','language','physical')),
  related_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Occupations
create table public.occupations (
  id text primary key,
  title_he text not null,
  title_en text not null,
  description_he text not null,
  riasec_affinity jsonb not null,           -- { R, I, A, S, E, C: number 0..1 }
  required_skills jsonb not null,           -- [{ skill_id, importance: 0..1 }]
  desired_skills jsonb not null,            -- same shape
  values_fit text[] not null default '{}',  -- value ids
  big5_fit jsonb,                           -- optional preferred ranges
  constraints jsonb not null,               -- { typical_training_months, ... }
  market jsonb not null,                    -- { demand_he, salary range, ai_risk }
  data_source text not null,
  last_verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index occupations_demand_idx on public.occupations((market->>'demand_he'));

create trigger occupations_set_updated_at
  before update on public.occupations
  for each row execute procedure public.set_updated_at();

-- Catalog version: bumps when seed script reseeds. Recommendations cache
-- includes this in profile_hash so a catalog change invalidates old recs.
create table public.catalog_version (
  id int primary key default 1 check (id = 1),
  version int not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.catalog_version (id, version) values (1, 1);

-- Generated recommendations cache
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  profile_hash text not null,
  rankings jsonb not null,
  paths jsonb not null,
  prose jsonb not null,
  generated_at timestamptz not null default now()
);

create index recommendations_user_generated_idx
  on public.recommendations(user_id, generated_at desc);
create index recommendations_user_hash_idx
  on public.recommendations(user_id, profile_hash);

alter table public.skills enable row level security;
alter table public.occupations enable row level security;
alter table public.catalog_version enable row level security;
alter table public.recommendations enable row level security;

-- Skills + occupations + catalog_version are public-read (everyone sees the catalog).
create policy skills_read_all on public.skills for select using (true);
create policy occupations_read_all on public.occupations for select using (true);
create policy catalog_version_read_all on public.catalog_version for select using (true);

-- Recommendations: per-user. Service role bypasses (used by API route).
create policy recommendations_self on public.recommendations
  for all using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );
```

- [ ] **Step 3: Apply via Supabase MCP** (CLI is not linked in this dev environment)

The migration applies via `mcp__claude_ai_Supabase__apply_migration` with project_id `wqswamtcppjmkwykukjp` and the SQL above.

- [ ] **Step 4: Regenerate types**

Use `mcp__claude_ai_Supabase__generate_typescript_types` and overwrite `lib/db/types.gen.ts`.

- [ ] **Step 5: Verify TS compile**

```powershell
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations lib/db/types.gen.ts
git commit -m "feat(db): add occupations, skills, catalog_version, recommendations tables"
```

---

## Task 2: Skill taxonomy seed file

**Files:**
- Create: `content/skills/taxonomy.json`

- [ ] **Step 1: Write the taxonomy**

```json
{
  "version": 1,
  "skills": [
    { "id": "programming-general", "name_he": "תכנות כללי", "category": "technical", "related_ids": ["javascript", "python"] },
    { "id": "javascript", "name_he": "JavaScript / TypeScript", "category": "technical", "related_ids": ["programming-general", "react"] },
    { "id": "python", "name_he": "Python", "category": "technical", "related_ids": ["programming-general", "data-analysis"] },
    { "id": "react", "name_he": "React / Next.js", "category": "technical", "related_ids": ["javascript"] },
    { "id": "sql", "name_he": "SQL ומסדי נתונים", "category": "technical", "related_ids": ["data-analysis"] },
    { "id": "linux-cli", "name_he": "Linux / שורת פקודה", "category": "technical", "related_ids": ["devops"] },
    { "id": "devops", "name_he": "DevOps / CI-CD", "category": "technical", "related_ids": ["linux-cli", "cloud"] },
    { "id": "cloud", "name_he": "ענן (AWS/GCP/Azure)", "category": "technical", "related_ids": ["devops"] },
    { "id": "data-analysis", "name_he": "ניתוח נתונים", "category": "analytical", "related_ids": ["python", "sql", "statistics"] },
    { "id": "statistics", "name_he": "סטטיסטיקה", "category": "analytical", "related_ids": ["data-analysis"] },
    { "id": "qa-testing", "name_he": "QA ובדיקות תוכנה", "category": "technical", "related_ids": ["test-automation"] },
    { "id": "test-automation", "name_he": "אוטומציה לבדיקות", "category": "technical", "related_ids": ["qa-testing", "javascript"] },
    { "id": "ux-design", "name_he": "עיצוב חוויית משתמש", "category": "creative", "related_ids": ["ui-design"] },
    { "id": "ui-design", "name_he": "עיצוב ממשק משתמש", "category": "creative", "related_ids": ["ux-design", "graphic-design"] },
    { "id": "graphic-design", "name_he": "עיצוב גרפי", "category": "creative", "related_ids": ["ui-design"] },
    { "id": "writing-he", "name_he": "כתיבה בעברית", "category": "creative", "related_ids": ["copywriting"] },
    { "id": "copywriting", "name_he": "קופירייטינג / כתיבה שיווקית", "category": "creative", "related_ids": ["writing-he", "marketing"] },
    { "id": "marketing", "name_he": "שיווק דיגיטלי", "category": "managerial", "related_ids": ["copywriting", "data-analysis"] },
    { "id": "sales", "name_he": "מכירות", "category": "social", "related_ids": ["negotiation", "presentation"] },
    { "id": "negotiation", "name_he": "משא ומתן", "category": "social", "related_ids": ["sales", "communication"] },
    { "id": "communication", "name_he": "תקשורת בין-אישית", "category": "social", "related_ids": ["presentation"] },
    { "id": "presentation", "name_he": "מצגות והצגה בקהל", "category": "social", "related_ids": ["communication"] },
    { "id": "team-leadership", "name_he": "הובלת צוות", "category": "managerial", "related_ids": ["communication", "project-management"] },
    { "id": "project-management", "name_he": "ניהול פרויקטים", "category": "managerial", "related_ids": ["team-leadership", "operations"] },
    { "id": "operations", "name_he": "ניהול תפעול", "category": "managerial", "related_ids": ["project-management"] },
    { "id": "product-management", "name_he": "ניהול מוצר", "category": "managerial", "related_ids": ["ux-design", "data-analysis"] },
    { "id": "customer-service", "name_he": "שירות לקוחות", "category": "social", "related_ids": ["communication"] },
    { "id": "teaching", "name_he": "הוראה", "category": "social", "related_ids": ["communication", "patience"] },
    { "id": "patience", "name_he": "סבלנות עם אנשים", "category": "soft", "related_ids": ["teaching"] },
    { "id": "empathy", "name_he": "אמפתיה", "category": "soft", "related_ids": ["counseling"] },
    { "id": "counseling", "name_he": "ייעוץ והקשבה", "category": "social", "related_ids": ["empathy", "communication"] },
    { "id": "first-aid", "name_he": "עזרה ראשונה ורפואה בסיסית", "category": "technical", "related_ids": [] },
    { "id": "anatomy", "name_he": "אנטומיה ופיזיולוגיה", "category": "analytical", "related_ids": ["first-aid"] },
    { "id": "physical-stamina", "name_he": "כושר גופני וסיבולת", "category": "physical", "related_ids": [] },
    { "id": "manual-dexterity", "name_he": "עבודה עם הידיים", "category": "physical", "related_ids": [] },
    { "id": "tool-use", "name_he": "שימוש בכלי עבודה", "category": "physical", "related_ids": ["manual-dexterity"] },
    { "id": "electrical-systems", "name_he": "מערכות חשמל", "category": "technical", "related_ids": ["tool-use", "safety"] },
    { "id": "safety", "name_he": "תקני בטיחות", "category": "technical", "related_ids": [] },
    { "id": "lab-technique", "name_he": "טכניקת מעבדה", "category": "technical", "related_ids": ["lab-instrumentation"] },
    { "id": "lab-instrumentation", "name_he": "ציוד מעבדה", "category": "technical", "related_ids": ["lab-technique"] },
    { "id": "cooking-technique", "name_he": "טכניקת בישול", "category": "creative", "related_ids": ["food-safety"] },
    { "id": "food-safety", "name_he": "בטיחות מזון", "category": "technical", "related_ids": ["safety"] },
    { "id": "menu-planning", "name_he": "תכנון תפריטים", "category": "creative", "related_ids": ["cooking-technique"] },
    { "id": "english-business", "name_he": "אנגלית עסקית / טכנית", "category": "language", "related_ids": [] },
    { "id": "accounting", "name_he": "הנהלת חשבונות", "category": "analytical", "related_ids": ["spreadsheets", "tax-knowledge"] },
    { "id": "spreadsheets", "name_he": "אקסל / גליונות", "category": "analytical", "related_ids": ["data-analysis"] },
    { "id": "tax-knowledge", "name_he": "ידע במיסוי", "category": "analytical", "related_ids": ["accounting"] },
    { "id": "process-design", "name_he": "תכנון תהליכים", "category": "analytical", "related_ids": ["operations"] },
    { "id": "industrial-engineering", "name_he": "הנדסת תעשייה וניהול", "category": "analytical", "related_ids": ["process-design", "data-analysis"] },
    { "id": "child-development", "name_he": "התפתחות הילד", "category": "analytical", "related_ids": ["teaching", "patience"] },
    { "id": "special-needs", "name_he": "אוכלוסיות עם צרכים מיוחדים", "category": "social", "related_ids": ["empathy", "teaching"] },
    { "id": "social-work-methods", "name_he": "שיטות עבודה סוציאלית", "category": "social", "related_ids": ["counseling", "empathy"] },
    { "id": "growth-marketing", "name_he": "Growth marketing / SEO / SEM", "category": "managerial", "related_ids": ["marketing", "data-analysis"] },
    { "id": "saas-sales", "name_he": "מכירות SaaS / B2B", "category": "social", "related_ids": ["sales", "english-business"] },
    { "id": "writing-en", "name_he": "כתיבה באנגלית", "category": "language", "related_ids": ["english-business"] },
    { "id": "research-skills", "name_he": "מחקר וחקר", "category": "analytical", "related_ids": ["data-analysis"] },
    { "id": "creativity", "name_he": "יצירתיות והפקת רעיונות", "category": "creative", "related_ids": [] },
    { "id": "attention-to-detail", "name_he": "תשומת לב לפרטים", "category": "soft", "related_ids": ["qa-testing"] },
    { "id": "self-direction", "name_he": "עצמאות ויוזמה", "category": "soft", "related_ids": [] },
    { "id": "stress-tolerance", "name_he": "עמידות בלחץ", "category": "soft", "related_ids": [] }
  ]
}
```

That's 60 skills covering tech, healthcare, education, social, business, creative, trades, science.

- [ ] **Step 2: Commit**

```powershell
git add content/skills/taxonomy.json
git commit -m "feat(content): skill taxonomy v1 (~60 skills across 8 categories)"
```

---

## Task 3: Occupation JSON schema + validator

**Files:**
- Create: `content/occupations/_schema.json`
- Create: `scripts/validate-occupations.ts`

- [ ] **Step 1: Write JSON Schema**

`content/occupations/_schema.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Occupation",
  "type": "object",
  "required": [
    "id", "title_he", "title_en", "description_he",
    "riasec_affinity", "required_skills", "desired_skills",
    "values_fit", "constraints", "market",
    "data_source", "last_verified_at"
  ],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "title_he": { "type": "string", "minLength": 2, "maxLength": 80 },
    "title_en": { "type": "string", "minLength": 2, "maxLength": 80 },
    "description_he": { "type": "string", "minLength": 30, "maxLength": 600 },
    "riasec_affinity": {
      "type": "object",
      "required": ["R","I","A","S","E","C"],
      "additionalProperties": false,
      "properties": {
        "R": { "type": "number", "minimum": 0, "maximum": 1 },
        "I": { "type": "number", "minimum": 0, "maximum": 1 },
        "A": { "type": "number", "minimum": 0, "maximum": 1 },
        "S": { "type": "number", "minimum": 0, "maximum": 1 },
        "E": { "type": "number", "minimum": 0, "maximum": 1 },
        "C": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "required_skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["skill_id", "importance"],
        "additionalProperties": false,
        "properties": {
          "skill_id": { "type": "string" },
          "importance": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      }
    },
    "desired_skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["skill_id", "importance"],
        "additionalProperties": false,
        "properties": {
          "skill_id": { "type": "string" },
          "importance": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      }
    },
    "values_fit": {
      "type": "array",
      "items": { "type": "string" },
      "uniqueItems": true
    },
    "big5_fit": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "O": { "type": "number", "minimum": 0, "maximum": 100 },
        "C": { "type": "number", "minimum": 0, "maximum": 100 },
        "E": { "type": "number", "minimum": 0, "maximum": 100 },
        "A": { "type": "number", "minimum": 0, "maximum": 100 },
        "N": { "type": "number", "minimum": 0, "maximum": 100 }
      }
    },
    "constraints": {
      "type": "object",
      "required": [
        "typical_training_months",
        "typical_training_cost_nis",
        "requires_english_level",
        "remote_ok",
        "typical_locations"
      ],
      "additionalProperties": false,
      "properties": {
        "typical_training_months": { "type": "integer", "minimum": 0, "maximum": 84 },
        "typical_training_cost_nis": { "type": "integer", "minimum": 0, "maximum": 500000 },
        "requires_english_level": { "type": "string", "enum": ["none","basic","intermediate","advanced","fluent"] },
        "remote_ok": { "type": "boolean" },
        "typical_locations": {
          "type": "array",
          "items": { "type": "string" },
          "uniqueItems": true
        }
      }
    },
    "market": {
      "type": "object",
      "required": ["demand_he", "typical_salary_nis_min", "typical_salary_nis_max", "ai_risk"],
      "additionalProperties": false,
      "properties": {
        "demand_he": { "type": "string", "enum": ["low","medium","high","very_high"] },
        "typical_salary_nis_min": { "type": "integer", "minimum": 0 },
        "typical_salary_nis_max": { "type": "integer", "minimum": 0 },
        "ai_risk": { "type": "string", "enum": ["low","medium","high"] }
      }
    },
    "data_source": { "type": "string", "minLength": 5 },
    "last_verified_at": { "type": "string", "format": "date" }
  }
}
```

- [ ] **Step 2: Install ajv (the JSON-Schema validator)**

```powershell
npm install --save-dev ajv ajv-formats
```

- [ ] **Step 3: Write validator script**

`scripts/validate-occupations.ts`:
```ts
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_PATH = "content/occupations/_schema.json";
const OCC_DIR = "content/occupations";
const SKILLS_PATH = "content/skills/taxonomy.json";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const validate = ajv.compile(schema);

const taxonomy = JSON.parse(readFileSync(SKILLS_PATH, "utf8"));
const validSkillIds = new Set<string>(taxonomy.skills.map((s: { id: string }) => s.id));

let errorCount = 0;

const files = readdirSync(OCC_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
for (const file of files) {
  const path = join(OCC_DIR, file);
  const occ = JSON.parse(readFileSync(path, "utf8"));

  if (!validate(occ)) {
    errorCount += 1;
    console.error(`❌ ${file}:`);
    for (const err of validate.errors ?? []) {
      console.error(`   ${err.instancePath} ${err.message}`);
    }
    continue;
  }

  // Cross-check that skill_ids reference real taxonomy entries
  const allRefs = [
    ...occ.required_skills.map((s: { skill_id: string }) => s.skill_id),
    ...occ.desired_skills.map((s: { skill_id: string }) => s.skill_id),
  ];
  const unknown = allRefs.filter((id) => !validSkillIds.has(id));
  if (unknown.length > 0) {
    errorCount += 1;
    console.error(`❌ ${file}: unknown skill ids: ${unknown.join(", ")}`);
    continue;
  }

  if (occ.id !== file.replace(/\.json$/, "")) {
    errorCount += 1;
    console.error(`❌ ${file}: id "${occ.id}" doesn't match filename`);
    continue;
  }
}

if (errorCount === 0) {
  console.log(`✅ ${files.length} occupations valid`);
  process.exit(0);
}
console.error(`\n${errorCount} validation error(s)`);
process.exit(1);
```

- [ ] **Step 4: Add npm script**

In `package.json` `scripts`, add:
```json
"validate:occupations": "tsx scripts/validate-occupations.ts"
```

(`tsx` is bundled with `next`; if not, `npm install --save-dev tsx`.)

- [ ] **Step 5: Run with no occupations yet — script should pass with "0 occupations valid"**

```powershell
npm run validate:occupations
```

- [ ] **Step 6: Commit**

```powershell
git add content/occupations/_schema.json scripts/validate-occupations.ts package.json package-lock.json
git commit -m "feat(content): occupation JSON schema and validator script"
```

---

## Task 4: 20 hand-curated occupation JSONs

This task is the bulk of Phase 4's data work. Each JSON file follows the schema. Costs ~30–60 minutes per occupation to research properly. The plan provides **2 fully-worked examples** to set the tone; the implementer fills the remaining 18 from current-market knowledge with `data_source: "public_knowledge_v1_2026-05"`. Phase 7's launch checklist gates on a curator-reviewed pass.

**Files to create:**
- `content/occupations/software-developer.json`
- `content/occupations/qa-automation.json`
- `content/occupations/product-manager.json`
- `content/occupations/ux-designer.json`
- `content/occupations/data-analyst.json`
- `content/occupations/devops-engineer.json`
- `content/occupations/nurse.json`
- `content/occupations/physiotherapist.json`
- `content/occupations/elementary-teacher.json`
- `content/occupations/special-ed-teacher.json`
- `content/occupations/social-worker.json`
- `content/occupations/industrial-engineer.json`
- `content/occupations/accountant.json`
- `content/occupations/account-executive-saas.json`
- `content/occupations/digital-marketer.json`
- `content/occupations/graphic-designer.json`
- `content/occupations/chef.json`
- `content/occupations/electrician.json`
- `content/occupations/lab-technician.json`
- `content/occupations/operations-manager.json`

**Two reference examples (paste-ready):**

`content/occupations/software-developer.json`:
```json
{
  "id": "software-developer",
  "title_he": "מפתח/ת תוכנה",
  "title_en": "Software Developer",
  "description_he": "כתיבת קוד שמייצר מוצרים דיגיטליים — אפליקציות אינטרנט, מובייל, או מערכות עורף. עבודה בצוות עם מנהלי מוצר, מעצבים, ומפתחים אחרים. שילוב חזק של פתרון בעיות ושפת תכנות מסוימת.",
  "riasec_affinity": { "R": 0.30, "I": 0.85, "A": 0.45, "S": 0.30, "E": 0.20, "C": 0.55 },
  "required_skills": [
    { "skill_id": "programming-general", "importance": 1.0 },
    { "skill_id": "javascript", "importance": 0.7 },
    { "skill_id": "sql", "importance": 0.5 },
    { "skill_id": "english-business", "importance": 0.7 },
    { "skill_id": "self-direction", "importance": 0.6 }
  ],
  "desired_skills": [
    { "skill_id": "react", "importance": 0.5 },
    { "skill_id": "python", "importance": 0.4 },
    { "skill_id": "linux-cli", "importance": 0.4 },
    { "skill_id": "communication", "importance": 0.5 }
  ],
  "values_fit": ["learning", "challenge", "money", "creativity", "freedom"],
  "big5_fit": { "O": 70, "C": 65 },
  "constraints": {
    "typical_training_months": 9,
    "typical_training_cost_nis": 50000,
    "requires_english_level": "intermediate",
    "remote_ok": true,
    "typical_locations": ["מרכז", "תל אביב", "שרון", "ירושלים", "חיפה"]
  },
  "market": {
    "demand_he": "very_high",
    "typical_salary_nis_min": 18000,
    "typical_salary_nis_max": 45000,
    "ai_risk": "medium"
  },
  "data_source": "public_knowledge_v1_2026-05",
  "last_verified_at": "2026-05-10"
}
```

`content/occupations/elementary-teacher.json`:
```json
{
  "id": "elementary-teacher",
  "title_he": "מורה בבית ספר יסודי",
  "title_en": "Elementary School Teacher",
  "description_he": "הוראת מקצועות בסיסיים לילדים בכיתות א-ו. תכנון שיעורים, ניהול כיתה, מעקב התפתחותי, וקשר עם הורים. תפקיד עם משמעות חברתית גבוהה ולוח זמנים שמסתדר עם משפחה צעירה.",
  "riasec_affinity": { "R": 0.20, "I": 0.40, "A": 0.55, "S": 0.95, "E": 0.40, "C": 0.55 },
  "required_skills": [
    { "skill_id": "teaching", "importance": 1.0 },
    { "skill_id": "patience", "importance": 0.9 },
    { "skill_id": "communication", "importance": 0.85 },
    { "skill_id": "child-development", "importance": 0.75 },
    { "skill_id": "writing-he", "importance": 0.6 }
  ],
  "desired_skills": [
    { "skill_id": "creativity", "importance": 0.6 },
    { "skill_id": "presentation", "importance": 0.5 },
    { "skill_id": "stress-tolerance", "importance": 0.5 }
  ],
  "values_fit": ["impact", "service", "team", "balance", "stability"],
  "big5_fit": { "A": 70, "C": 65 },
  "constraints": {
    "typical_training_months": 36,
    "typical_training_cost_nis": 30000,
    "requires_english_level": "basic",
    "remote_ok": false,
    "typical_locations": ["מרכז", "צפון", "דרום", "ירושלים", "שרון", "חיפה", "באר שבע"]
  },
  "market": {
    "demand_he": "high",
    "typical_salary_nis_min": 8000,
    "typical_salary_nis_max": 14000,
    "ai_risk": "low"
  },
  "data_source": "public_knowledge_v1_2026-05",
  "last_verified_at": "2026-05-10"
}
```

- [ ] **Step 1: Write all 20 JSON files** (use the schema + the 2 examples above + current Israeli labor market knowledge)

When filling in:
- `riasec_affinity`: each value 0.0–1.0 reflecting how strongly the role fits that RIASEC type. Most roles have 1-2 dominant types (≥0.7) and the rest mid-low.
- `required_skills`: 4–7 skills with `importance` 0.5–1.0
- `desired_skills`: 2–5 with `importance` 0.3–0.6
- `values_fit`: pick 3–5 value ids from `lib/assessment/values/options.ts` (`money, stability, variety, impact, freedom, status, learning, team, balance, creativity, challenge, service`)
- `big5_fit`: only fill traits that genuinely matter for the role (e.g. nurse → high A and C; entrepreneur → high E and O)
- `constraints.typical_training_months`: 0 for "no formal training needed", 36+ for academic degree roles
- `market.demand_he`: be honest. If you don't know, say "medium" rather than guess high.
- `data_source`: always `"public_knowledge_v1_2026-05"`
- `last_verified_at`: `"2026-05-10"`

- [ ] **Step 2: Run validator**

```powershell
npm run validate:occupations
```

Expected: `✅ 20 occupations valid`. If any fail, fix until clean.

- [ ] **Step 3: Commit**

```powershell
git add content/occupations
git commit -m "feat(content): 20 occupation JSONs v1 covering Israeli post-army segments"
```

---

## Task 5: Seed script

**Files:**
- Create: `scripts/seed-occupations.ts`

- [ ] **Step 1: Write the script**

```ts
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types.gen";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient<Database>(url, serviceKey);

const SKILLS_FILE = "content/skills/taxonomy.json";
const OCC_DIR = "content/occupations";

async function seedSkills() {
  const taxonomy = JSON.parse(readFileSync(SKILLS_FILE, "utf8"));
  const rows = taxonomy.skills.map((s: { id: string; name_he: string; category: string; related_ids: string[] }) => ({
    id: s.id,
    name_he: s.name_he,
    category: s.category,
    related_ids: s.related_ids,
  }));
  const { error } = await supabase.from("skills").upsert(rows);
  if (error) throw error;
  console.log(`✅ seeded ${rows.length} skills`);
}

async function seedOccupations() {
  const files = readdirSync(OCC_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  const rows = files.map((file) => {
    const occ = JSON.parse(readFileSync(join(OCC_DIR, file), "utf8"));
    return {
      id: occ.id,
      title_he: occ.title_he,
      title_en: occ.title_en,
      description_he: occ.description_he,
      riasec_affinity: occ.riasec_affinity,
      required_skills: occ.required_skills,
      desired_skills: occ.desired_skills,
      values_fit: occ.values_fit,
      big5_fit: occ.big5_fit ?? null,
      constraints: occ.constraints,
      market: occ.market,
      data_source: occ.data_source,
      last_verified_at: occ.last_verified_at,
    };
  });
  const { error } = await supabase.from("occupations").upsert(rows);
  if (error) throw error;
  console.log(`✅ seeded ${rows.length} occupations`);
}

async function bumpCatalogVersion() {
  const { data, error: readErr } = await supabase
    .from("catalog_version")
    .select("version")
    .eq("id", 1)
    .single();
  if (readErr) throw readErr;
  const next = (data?.version ?? 0) + 1;
  const { error } = await supabase
    .from("catalog_version")
    .update({ version: next, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
  console.log(`✅ catalog_version → ${next}`);
}

async function main() {
  await seedSkills();
  await seedOccupations();
  await bumpCatalogVersion();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json` `scripts`:
```json
"seed:occupations": "tsx scripts/seed-occupations.ts"
```

Note: `dotenv/config` import requires `dotenv` package. If not present, `npm install --save-dev dotenv`.

- [ ] **Step 3: Run the seed**

```powershell
npm run seed:occupations
```

Expected output:
```
✅ seeded 60 skills
✅ seeded 20 occupations
✅ catalog_version → 2
```

- [ ] **Step 4: Verify in Supabase**

Use the Supabase MCP `execute_sql`:
```sql
select count(*) from public.skills;        -- 60
select count(*) from public.occupations;   -- 20
select version from public.catalog_version; -- 2
```

- [ ] **Step 5: Commit**

```powershell
git add scripts/seed-occupations.ts package.json package-lock.json
git commit -m "feat(scripts): seed occupations + skills with catalog_version bump"
```

---

## Task 6: Matching types + weights

**Files:**
- Create: `lib/matching/types.ts`
- Create: `lib/matching/weights.ts`

- [ ] **Step 1: Write `lib/matching/types.ts`**

```ts
export type DimensionName = "interests" | "skills" | "values" | "big5" | "constraints" | "market";

export type RiasecVector = { R: number; I: number; A: number; S: number; E: number; C: number };
export type Big5Vector = { O: number; C: number; E: number; A: number; N: number };

export type MatchingProfile = {
  // Each dimension is null when the user has no signal for it.
  interests: RiasecVector | null;          // 0..100 each
  skills: { id: string; level: number }[] | null;   // level 0..1; ids are taxonomy ids OR free-form labels
  values: { topThree: string[]; alsoPicked: string[] } | null;
  big5: Big5Vector | null;                 // 0..100 each
  constraints: {
    location_he?: string;
    remote_ok?: boolean;
    time_per_week_hours?: number;
    training_budget_nis?: number;
    english_level?: "none" | "basic" | "intermediate" | "advanced" | "fluent";
    risk_tolerance?: number;
    needs_immediate_income?: boolean;
    months_until_income_required?: number;
  } | null;
};

export type Occupation = {
  id: string;
  title_he: string;
  title_en: string;
  description_he: string;
  riasec_affinity: { R: number; I: number; A: number; S: number; E: number; C: number };  // 0..1
  required_skills: { skill_id: string; importance: number }[];
  desired_skills: { skill_id: string; importance: number }[];
  values_fit: string[];
  big5_fit?: Partial<Big5Vector>;          // 0..100 per trait, only present traits matter
  constraints: {
    typical_training_months: number;
    typical_training_cost_nis: number;
    requires_english_level: "none" | "basic" | "intermediate" | "advanced" | "fluent";
    remote_ok: boolean;
    typical_locations: string[];
  };
  market: {
    demand_he: "low" | "medium" | "high" | "very_high";
    typical_salary_nis_min: number;
    typical_salary_nis_max: number;
    ai_risk: "low" | "medium" | "high";
  };
  data_source: string;
  last_verified_at: string;
};

export type ScoreBreakdown = {
  interests: number | null;
  skills: number | null;
  values: number | null;
  big5: number | null;
  constraints: number | null;
  market: number | null;
};

export type Ranking = {
  occupation_id: string;
  total_score: number;                    // 0..100
  breakdown: ScoreBreakdown;
  weights_used: Partial<Record<DimensionName, number>>;  // re-normalized
};

export type Paths = {
  safe: string | null;
  growth: string | null;
  wildcard: string | null;
};

export type RecommendationResult = {
  rankings: Ranking[];                    // top-N, sorted desc by total_score
  paths: Paths;
};
```

- [ ] **Step 2: Write `lib/matching/weights.ts`**

```ts
import type { DimensionName } from "./types";

// Master roadmap §9: 25/20/15/15/15/10. Sum = 100.
export const WEIGHTS: Record<DimensionName, number> = {
  interests: 25,
  skills: 20,
  values: 15,
  big5: 15,
  constraints: 15,
  market: 10,
};

export const DIMENSIONS: DimensionName[] = [
  "interests", "skills", "values", "big5", "constraints", "market",
];
```

- [ ] **Step 3: Verify TS compile**

```powershell
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```powershell
git add lib/matching/types.ts lib/matching/weights.ts
git commit -m "feat(matching): types and weights (25/20/15/15/15/10 per master roadmap §9)"
```

---

## Task 7: Per-dimension scorers — interests + skills (TDD)

**Files:**
- Create: `lib/matching/score/interests.ts`
- Create: `lib/matching/score/skills.ts`
- Create: `tests/unit/matching/score-interests.test.ts`
- Create: `tests/unit/matching/score-skills.test.ts`

- [ ] **Step 1: TDD `score-interests.test.ts`** — paste exactly:

```ts
import { describe, it, expect } from "vitest";
import { scoreInterests } from "@/lib/matching/score/interests";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

const fakeOccupation = (riasec: Occupation["riasec_affinity"]): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: riasec,
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: {
    typical_training_months: 0, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreInterests", () => {
  it("returns null when profile has no RIASEC signal", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOccupation({ R: 1, I: 1, A: 1, S: 1, E: 1, C: 1 });
    expect(scoreInterests(profile, occ)).toBeNull();
  });

  it("returns 100 when user RIASEC perfectly aligns with occupation", () => {
    const profile: MatchingProfile = {
      interests: { R: 0, I: 100, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOccupation({ R: 0, I: 1, A: 0, S: 0, E: 0, C: 0 });
    expect(scoreInterests(profile, occ)).toBe(100);
  });

  it("returns 0 when user RIASEC is opposite to occupation", () => {
    const profile: MatchingProfile = {
      interests: { R: 100, I: 0, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOccupation({ R: 0, I: 1, A: 0, S: 0, E: 0, C: 0 });
    expect(scoreInterests(profile, occ)).toBe(0);
  });

  it("partial alignment returns mid-range", () => {
    const profile: MatchingProfile = {
      interests: { R: 50, I: 80, A: 30, S: 20, E: 10, C: 40 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOccupation({ R: 0.3, I: 0.85, A: 0.45, S: 0.3, E: 0.2, C: 0.55 });
    const score = scoreInterests(profile, occ);
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```powershell
npm test -- score-interests
```

- [ ] **Step 3: Implement `lib/matching/score/interests.ts`**

```ts
import type { MatchingProfile, Occupation } from "../types";

/**
 * Cosine similarity between user's RIASEC vector and occupation's RIASEC affinity,
 * scaled to 0..100. Returns null when user has no RIASEC signal.
 */
export function scoreInterests(profile: MatchingProfile, occupation: Occupation): number | null {
  if (!profile.interests) return null;

  const u = profile.interests;
  const o = occupation.riasec_affinity;

  const dot = u.R * o.R + u.I * o.I + u.A * o.A + u.S * o.S + u.E * o.E + u.C * o.C;
  const uMag = Math.sqrt(u.R*u.R + u.I*u.I + u.A*u.A + u.S*u.S + u.E*u.E + u.C*u.C);
  const oMag = Math.sqrt(o.R*o.R + o.I*o.I + o.A*o.A + o.S*o.S + o.E*o.E + o.C*o.C);

  if (uMag === 0 || oMag === 0) return 0;

  const cosine = dot / (uMag * oMag);  // 0..1 since all values are non-negative
  return Math.round(cosine * 100);
}
```

- [ ] **Step 4: Run, expect PASS 4/4**

- [ ] **Step 5: TDD `score-skills.test.ts`** — paste exactly:

```ts
import { describe, it, expect } from "vitest";
import { scoreSkills } from "@/lib/matching/score/skills";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

const fakeOccupation = (req: Array<[string, number]>, des: Array<[string, number]> = []): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  required_skills: req.map(([id, imp]) => ({ skill_id: id, importance: imp })),
  desired_skills: des.map(([id, imp]) => ({ skill_id: id, importance: imp })),
  values_fit: [],
  constraints: {
    typical_training_months: 0, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreSkills", () => {
  it("returns null when profile has no skills", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOccupation([["javascript", 1.0]]);
    expect(scoreSkills(profile, occ)).toBeNull();
  });

  it("returns 100 when user has all required skills at full level", () => {
    const profile: MatchingProfile = {
      interests: null, big5: null, values: null, constraints: null,
      skills: [
        { id: "javascript", level: 1.0 },
        { id: "sql", level: 1.0 },
      ],
    };
    const occ = fakeOccupation([["javascript", 1.0], ["sql", 0.5]]);
    expect(scoreSkills(profile, occ)).toBe(100);
  });

  it("returns 0 when user has none of the required skills", () => {
    const profile: MatchingProfile = {
      interests: null, big5: null, values: null, constraints: null,
      skills: [{ id: "cooking-technique", level: 1.0 }],
    };
    const occ = fakeOccupation([["javascript", 1.0]]);
    expect(scoreSkills(profile, occ)).toBe(0);
  });

  it("matches by Hebrew label fuzzy substring when ids don't match", () => {
    const profile: MatchingProfile = {
      interests: null, big5: null, values: null, constraints: null,
      skills: [{ id: "JavaScript / TypeScript", level: 1.0 }],  // free-form Hebrew/English label
    };
    const occ = fakeOccupation([["javascript", 1.0]]);
    expect(scoreSkills(profile, occ)).toBeGreaterThanOrEqual(50);
  });

  it("desired skills contribute less than required skills", () => {
    const profileWithRequired: MatchingProfile = {
      interests: null, big5: null, values: null, constraints: null,
      skills: [{ id: "javascript", level: 1.0 }],
    };
    const profileWithDesired: MatchingProfile = {
      interests: null, big5: null, values: null, constraints: null,
      skills: [{ id: "react", level: 1.0 }],
    };
    const occ = fakeOccupation([["javascript", 1.0]], [["react", 1.0]]);
    expect(scoreSkills(profileWithRequired, occ))
      .toBeGreaterThan(scoreSkills(profileWithDesired, occ) ?? 0);
  });
});
```

- [ ] **Step 6: Run, expect FAIL**

- [ ] **Step 7: Implement `lib/matching/score/skills.ts`**

```ts
import type { MatchingProfile, Occupation } from "../types";

const REQUIRED_WEIGHT = 0.7;
const DESIRED_WEIGHT = 0.3;

/**
 * Match user's skills (with `level` 0..1) against occupation's required +
 * desired skills (with `importance` 0..1). User skills can be referenced by
 * canonical id OR free-form Hebrew/English label — we fuzzy-match labels via
 * lowercase substring containment, which handles "JavaScript / TypeScript" →
 * matches occupation skill_id "javascript".
 *
 * Returns 0..100. Null when profile has no skills.
 */
export function scoreSkills(profile: MatchingProfile, occupation: Occupation): number | null {
  if (!profile.skills || profile.skills.length === 0) return null;

  const userSkills = profile.skills.map((s) => ({
    id: s.id.toLowerCase().trim(),
    level: s.level,
  }));

  const requiredScore = matchSet(userSkills, occupation.required_skills);
  const desiredScore = matchSet(userSkills, occupation.desired_skills);

  // Normalize each side to the maximum possible importance contribution
  const reqMax = sumImportance(occupation.required_skills);
  const desMax = sumImportance(occupation.desired_skills);

  const reqRatio = reqMax > 0 ? requiredScore / reqMax : 0;
  const desRatio = desMax > 0 ? desiredScore / desMax : 0;

  // If a role has no desired_skills, weight required at full
  const hasDesired = occupation.desired_skills.length > 0;
  const totalWeight = hasDesired ? REQUIRED_WEIGHT + DESIRED_WEIGHT : 1.0;
  const reqShare = REQUIRED_WEIGHT / totalWeight;
  const desShare = hasDesired ? DESIRED_WEIGHT / totalWeight : 0;

  const combined = reqRatio * reqShare + desRatio * desShare;
  return Math.round(combined * 100);
}

function sumImportance(set: { importance: number }[]): number {
  return set.reduce((acc, s) => acc + s.importance, 0);
}

function matchSet(
  userSkills: { id: string; level: number }[],
  occSkills: { skill_id: string; importance: number }[],
): number {
  let total = 0;
  for (const occSkill of occSkills) {
    const id = occSkill.skill_id.toLowerCase();
    const match = userSkills.find(
      (u) =>
        u.id === id ||
        u.id.includes(id) ||
        id.includes(u.id),
    );
    if (match) total += occSkill.importance * match.level;
  }
  return total;
}
```

- [ ] **Step 8: Run, expect PASS 5/5**

- [ ] **Step 9: Commit**

```powershell
git add lib/matching/score tests/unit/matching
git commit -m "feat(matching): interests (cosine) and skills (weighted-overlap) scorers with TDD"
```

---

## Task 8: Per-dimension scorers — values + big5 (TDD)

**Files:**
- Create: `lib/matching/score/values.ts`
- Create: `lib/matching/score/big5.ts`
- Create: `tests/unit/matching/score-values.test.ts`
- Create: `tests/unit/matching/score-big5.test.ts`

- [ ] **Step 1: TDD `score-values.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { scoreValues } from "@/lib/matching/score/values";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

const occ = (values_fit: string[]): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  required_skills: [], desired_skills: [],
  values_fit,
  constraints: {
    typical_training_months: 0, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreValues", () => {
  it("returns null when no values signal", () => {
    const profile: MatchingProfile = { interests: null, skills: null, big5: null, constraints: null, values: null };
    expect(scoreValues(profile, occ(["money"]))).toBeNull();
  });

  it("returns 100 when occupation fits all 3 ranked values", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, constraints: null,
      values: { topThree: ["money", "freedom", "learning"], alsoPicked: ["challenge", "balance"] },
    };
    expect(scoreValues(profile, occ(["money", "freedom", "learning", "team", "balance"]))).toBe(100);
  });

  it("rank position weights matter — top1 worth more than top3", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, constraints: null,
      values: { topThree: ["money", "freedom", "learning"], alsoPicked: [] },
    };
    const fitsTop1 = occ(["money"]);
    const fitsTop3 = occ(["learning"]);
    expect(scoreValues(profile, fitsTop1)).toBeGreaterThan(scoreValues(profile, fitsTop3) ?? 0);
  });

  it("alsoPicked counts but less than ranked", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, constraints: null,
      values: { topThree: ["money", "freedom", "learning"], alsoPicked: ["challenge"] },
    };
    const onlyAlso = occ(["challenge"]);
    const onlyTop3 = occ(["learning"]);
    expect(scoreValues(profile, onlyTop3)).toBeGreaterThan(scoreValues(profile, onlyAlso) ?? 0);
  });

  it("returns 0 when no overlap", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, constraints: null,
      values: { topThree: ["money", "freedom", "learning"], alsoPicked: [] },
    };
    expect(scoreValues(profile, occ(["service", "team", "stability"]))).toBe(0);
  });
});
```

- [ ] **Step 2: Implement `lib/matching/score/values.ts`**

```ts
import type { MatchingProfile, Occupation } from "../types";

// Rank weights: position 0 > position 1 > position 2; alsoPicked is the floor.
const RANK_WEIGHTS = [3, 2, 1];   // top-three positions
const ALSO_WEIGHT = 0.5;
const MAX_POSSIBLE_TOP3 = 3 + 2 + 1;  // 6

export function scoreValues(profile: MatchingProfile, occupation: Occupation): number | null {
  if (!profile.values) return null;

  const fitSet = new Set(occupation.values_fit);
  let achieved = 0;

  for (let i = 0; i < profile.values.topThree.length && i < 3; i++) {
    const valId = profile.values.topThree[i];
    if (fitSet.has(valId)) achieved += RANK_WEIGHTS[i];
  }
  for (const valId of profile.values.alsoPicked) {
    if (fitSet.has(valId)) achieved += ALSO_WEIGHT;
  }

  // Normalize: best case is hitting top3 + 2 alsoPicked = 6 + 1 = 7. We treat
  // 6/6 (all top3 hit) as 100 and let alsoPicked push above-100, then cap.
  const score = Math.min(100, Math.round((achieved / MAX_POSSIBLE_TOP3) * 100));
  return score;
}
```

- [ ] **Step 3: Run interests/skills/values tests, expect 4 + 5 + 5 = 14 pass**

- [ ] **Step 4: TDD `score-big5.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { scoreBig5 } from "@/lib/matching/score/big5";
import type { MatchingProfile, Occupation, Big5Vector } from "@/lib/matching/types";

const occ = (big5_fit?: Partial<Big5Vector>): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  required_skills: [], desired_skills: [], values_fit: [],
  big5_fit,
  constraints: {
    typical_training_months: 0, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreBig5", () => {
  it("returns null when no big5 signal", () => {
    const profile: MatchingProfile = { interests: null, skills: null, big5: null, constraints: null, values: null };
    expect(scoreBig5(profile, occ({ O: 70 }))).toBeNull();
  });

  it("returns 100 when occupation has no big5_fit (no preference = perfect fit)", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, constraints: null,
      big5: { O: 50, C: 50, E: 50, A: 50, N: 50 },
    };
    expect(scoreBig5(profile, occ(undefined))).toBe(100);
  });

  it("returns 100 when user trait exactly matches occupation preference", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, constraints: null,
      big5: { O: 70, C: 50, E: 50, A: 50, N: 50 },
    };
    expect(scoreBig5(profile, occ({ O: 70 }))).toBe(100);
  });

  it("returns lower score when user trait is far from preference", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, constraints: null,
      big5: { O: 10, C: 50, E: 50, A: 50, N: 50 },
    };
    expect(scoreBig5(profile, occ({ O: 90 }))).toBeLessThan(50);
  });

  it("averages across multiple trait preferences", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, constraints: null,
      big5: { O: 70, C: 70, E: 50, A: 50, N: 50 },
    };
    const single = scoreBig5(profile, occ({ O: 70 }));
    const both = scoreBig5(profile, occ({ O: 70, C: 70 }));
    expect(single).toBe(100);
    expect(both).toBe(100);
  });
});
```

- [ ] **Step 5: Implement `lib/matching/score/big5.ts`**

```ts
import type { MatchingProfile, Occupation, Big5Vector } from "../types";

/**
 * For each Big5 trait the occupation has a preference for, compute |user - preference|
 * and convert to similarity (100 - distance). Average across present preferences.
 *
 * If the occupation has no big5_fit at all, it has no preference — return 100
 * (no constraint = perfect fit). Returns null when user has no big5 signal.
 */
export function scoreBig5(profile: MatchingProfile, occupation: Occupation): number | null {
  if (!profile.big5) return null;
  if (!occupation.big5_fit) return 100;

  const traits: (keyof Big5Vector)[] = ["O", "C", "E", "A", "N"];
  const present = traits.filter((t) => occupation.big5_fit?.[t] !== undefined);
  if (present.length === 0) return 100;

  let totalSim = 0;
  for (const t of present) {
    const userVal = profile.big5[t];
    const occVal = occupation.big5_fit[t]!;
    const distance = Math.abs(userVal - occVal);
    totalSim += 100 - distance;
  }
  return Math.round(totalSim / present.length);
}
```

- [ ] **Step 6: Run all matching tests, expect 4 + 5 + 5 + 5 = 19 pass**

- [ ] **Step 7: Commit**

```powershell
git add lib/matching/score tests/unit/matching
git commit -m "feat(matching): values (rank-weighted) and big5 (proximity) scorers with TDD"
```

---

## Task 9: Per-dimension scorers — constraints + market (TDD)

**Files:**
- Create: `lib/matching/score/constraints.ts`
- Create: `lib/matching/score/market.ts`
- Create: `tests/unit/matching/score-constraints.test.ts`
- Create: `tests/unit/matching/score-market.test.ts`

- [ ] **Step 1: TDD `score-constraints.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { scoreConstraints } from "@/lib/matching/score/constraints";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

const occ = (overrides: Partial<Occupation["constraints"]> = {}, market_overrides: Partial<Occupation["market"]> = {}): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: {
    typical_training_months: 12,
    typical_training_cost_nis: 30000,
    requires_english_level: "intermediate",
    remote_ok: true,
    typical_locations: ["מרכז"],
    ...overrides,
  },
  market: {
    demand_he: "high",
    typical_salary_nis_min: 10000,
    typical_salary_nis_max: 20000,
    ai_risk: "low",
    ...market_overrides,
  },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreConstraints", () => {
  it("returns null when no constraints signal", () => {
    const profile: MatchingProfile = { interests: null, skills: null, big5: null, values: null, constraints: null };
    expect(scoreConstraints(profile, occ())).toBeNull();
  });

  it("returns 100 when all user constraints fit comfortably", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "מרכז", remote_ok: false,
        time_per_week_hours: 20, training_budget_nis: 50000,
        english_level: "advanced",
      },
    };
    expect(scoreConstraints(profile, occ())).toBe(100);
  });

  it("penalizes when training cost exceeds budget", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "מרכז", training_budget_nis: 5000,
        time_per_week_hours: 20, english_level: "advanced",
      },
    };
    expect(scoreConstraints(profile, occ({ typical_training_cost_nis: 50000 }))).toBeLessThan(70);
  });

  it("penalizes when location doesn't match and not remote-ok", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "צפון", remote_ok: false,
        time_per_week_hours: 20, training_budget_nis: 50000,
        english_level: "advanced",
      },
    };
    expect(scoreConstraints(profile, occ({ typical_locations: ["מרכז"], remote_ok: false }))).toBeLessThan(70);
  });

  it("rewards remote when both user and occupation accept it", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "צפון", remote_ok: true,
        time_per_week_hours: 20, training_budget_nis: 50000,
        english_level: "advanced",
      },
    };
    expect(scoreConstraints(profile, occ({ typical_locations: ["מרכז"], remote_ok: true }))).toBeGreaterThanOrEqual(80);
  });

  it("penalizes when occupation requires higher english than user has", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "מרכז", training_budget_nis: 50000,
        time_per_week_hours: 20, english_level: "basic",
      },
    };
    expect(scoreConstraints(profile, occ({ requires_english_level: "fluent" }))).toBeLessThan(70);
  });

  it("penalizes when training months exceed user's months_until_income_required", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "מרכז", training_budget_nis: 50000,
        time_per_week_hours: 20, english_level: "advanced",
        needs_immediate_income: true, months_until_income_required: 3,
      },
    };
    expect(scoreConstraints(profile, occ({ typical_training_months: 12 }))).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Implement `lib/matching/score/constraints.ts`**

```ts
import type { MatchingProfile, Occupation } from "../types";

const ENGLISH_LEVELS = ["none", "basic", "intermediate", "advanced", "fluent"] as const;

/**
 * Penalty-based: start at 100 and subtract for each constraint violation.
 * Returns null when user has no constraints. Bounded 0..100.
 */
export function scoreConstraints(profile: MatchingProfile, occupation: Occupation): number | null {
  if (!profile.constraints) return null;
  const c = profile.constraints;
  const oc = occupation.constraints;

  let penalty = 0;

  // Location: -25 if user's city not in occupation's typical locations and neither side allows remote.
  if (c.location_he && oc.typical_locations.length > 0) {
    const locationFits = oc.typical_locations.includes(c.location_he);
    const bothRemote = c.remote_ok === true && oc.remote_ok === true;
    if (!locationFits && !bothRemote) penalty += 25;
  }

  // Training budget: -20 if cost > budget by 50%+, -10 if 0..50%
  if (c.training_budget_nis !== undefined && oc.typical_training_cost_nis > c.training_budget_nis) {
    const overspend = oc.typical_training_cost_nis - c.training_budget_nis;
    const ratio = overspend / Math.max(1, c.training_budget_nis);
    if (ratio > 0.5) penalty += 30;
    else if (ratio > 0) penalty += 15;
  }

  // English level: -20 if occupation requires higher than user has
  if (c.english_level) {
    const userIdx = ENGLISH_LEVELS.indexOf(c.english_level);
    const reqIdx = ENGLISH_LEVELS.indexOf(oc.requires_english_level);
    if (reqIdx > userIdx) penalty += 20 * (reqIdx - userIdx);
  }

  // Immediate income: heavy penalty when training takes longer than user can wait
  if (c.needs_immediate_income && c.months_until_income_required !== undefined) {
    const slack = c.months_until_income_required - oc.typical_training_months;
    if (slack < 0) {
      const monthsOver = -slack;
      penalty += Math.min(60, monthsOver * 5);
    }
  }

  // Time-per-week: very weak signal — most occupations can be trained part-time.
  // Skip explicit penalty for now; revisit in 4.5 polish.

  const score = Math.max(0, 100 - penalty);
  return Math.round(score);
}
```

- [ ] **Step 3: TDD `score-market.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { scoreMarket } from "@/lib/matching/score/market";
import type { Occupation } from "@/lib/matching/types";

const occ = (overrides: Partial<Occupation["market"]> = {}): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: {
    typical_training_months: 0, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: {
    demand_he: "medium",
    typical_salary_nis_min: 10000,
    typical_salary_nis_max: 20000,
    ai_risk: "low",
    ...overrides,
  },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreMarket", () => {
  it("returns 100 for very_high demand + low AI risk", () => {
    expect(scoreMarket(occ({ demand_he: "very_high", ai_risk: "low" }))).toBe(100);
  });

  it("returns lower for high demand + high AI risk", () => {
    expect(scoreMarket(occ({ demand_he: "high", ai_risk: "high" }))).toBeLessThan(75);
  });

  it("returns lower still for low demand", () => {
    expect(scoreMarket(occ({ demand_he: "low", ai_risk: "low" }))).toBeLessThan(60);
  });

  it("never depends on user profile (it's a property of the occupation)", () => {
    // scoreMarket signature only takes occupation
    const a = scoreMarket(occ({ demand_he: "high", ai_risk: "medium" }));
    const b = scoreMarket(occ({ demand_he: "high", ai_risk: "medium" }));
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 4: Implement `lib/matching/score/market.ts`**

```ts
import type { Occupation } from "../types";

const DEMAND_SCORES = { low: 30, medium: 60, high: 85, very_high: 100 } as const;
const AI_RISK_PENALTY = { low: 0, medium: 15, high: 35 } as const;

/**
 * Pure function of the occupation's market data. Doesn't depend on profile.
 * 70% weight on demand, 30% subtractive penalty from AI risk.
 */
export function scoreMarket(occupation: Occupation): number {
  const demand = DEMAND_SCORES[occupation.market.demand_he];
  const aiPenalty = AI_RISK_PENALTY[occupation.market.ai_risk];
  return Math.max(0, Math.min(100, Math.round(demand - aiPenalty)));
}
```

> **Note:** `scoreMarket` is the only scorer that doesn't take `profile` as an argument. Engine code in Task 10 calls it once per occupation regardless of profile shape, and never returns null.

- [ ] **Step 5: Run all 6 scorer tests, expect 4 + 5 + 5 + 5 + 7 + 4 = 30 pass**

- [ ] **Step 6: Commit**

```powershell
git add lib/matching/score tests/unit/matching
git commit -m "feat(matching): constraints (penalty-based) and market scorers"
```

---

## Task 10: Combine + rank engine (TDD)

**Files:**
- Create: `lib/matching/engine.ts`
- Create: `tests/unit/matching/engine.test.ts`

- [ ] **Step 1: TDD `engine.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { rankOccupations } from "@/lib/matching/engine";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

const fakeOcc = (id: string, riasecI: number, demand: Occupation["market"]["demand_he"] = "high"): Occupation => ({
  id, title_he: id, title_en: id, description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: riasecI, A: 0, S: 0, E: 0, C: 0 },
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: {
    typical_training_months: 6, typical_training_cost_nis: 10000,
    requires_english_level: "intermediate", remote_ok: true, typical_locations: ["מרכז"],
  },
  market: { demand_he: demand, typical_salary_nis_min: 10000, typical_salary_nis_max: 20000, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("rankOccupations", () => {
  it("ranks by total score descending", () => {
    const profile: MatchingProfile = {
      interests: { R: 0, I: 100, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const occs = [fakeOcc("low-i", 0.2), fakeOcc("high-i", 1.0), fakeOcc("mid-i", 0.6)];
    const result = rankOccupations(profile, occs);
    expect(result.map((r) => r.occupation_id)).toEqual(["high-i", "mid-i", "low-i"]);
  });

  it("re-normalizes weights when dimensions are missing", () => {
    const profile: MatchingProfile = {
      interests: { R: 0, I: 100, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOcc("only-i", 1.0);
    const result = rankOccupations(profile, [occ]);
    const r = result[0];
    // Only interests + market are scoreable. Weights re-normalize from 25 + 10 = 35 → 100.
    // interests is 25/35 ≈ 71.4%; market is 10/35 ≈ 28.6%.
    const interestsW = r.weights_used.interests!;
    const marketW = r.weights_used.market!;
    expect(interestsW + marketW).toBeCloseTo(100, 0);
    expect(interestsW).toBeGreaterThan(70);
    expect(interestsW).toBeLessThan(72);
  });

  it("breakdown carries null for missing dimensions", () => {
    const profile: MatchingProfile = {
      interests: { R: 0, I: 100, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const result = rankOccupations(profile, [fakeOcc("a", 0.5)]);
    expect(result[0].breakdown.interests).not.toBeNull();
    expect(result[0].breakdown.skills).toBeNull();
    expect(result[0].breakdown.values).toBeNull();
    expect(result[0].breakdown.big5).toBeNull();
    expect(result[0].breakdown.constraints).toBeNull();
    expect(result[0].breakdown.market).not.toBeNull();
  });

  it("returns empty array on empty occupations input", () => {
    const profile: MatchingProfile = {
      interests: { R: 0, I: 100, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    expect(rankOccupations(profile, [])).toEqual([]);
  });

  it("market alone produces a score even with empty profile", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, big5: null, constraints: null,
    };
    const result = rankOccupations(profile, [fakeOcc("a", 0.5, "very_high")]);
    expect(result[0].total_score).toBe(100);
    expect(result[0].weights_used.market).toBe(100);
  });
});
```

- [ ] **Step 2: Implement `lib/matching/engine.ts`**

```ts
import { WEIGHTS, DIMENSIONS } from "./weights";
import type {
  MatchingProfile,
  Occupation,
  Ranking,
  ScoreBreakdown,
  DimensionName,
} from "./types";
import { scoreInterests } from "./score/interests";
import { scoreSkills } from "./score/skills";
import { scoreValues } from "./score/values";
import { scoreBig5 } from "./score/big5";
import { scoreConstraints } from "./score/constraints";
import { scoreMarket } from "./score/market";

export function rankOccupations(
  profile: MatchingProfile,
  occupations: Occupation[],
): Ranking[] {
  return occupations
    .map((occ) => scoreOne(profile, occ))
    .sort((a, b) => b.total_score - a.total_score);
}

function scoreOne(profile: MatchingProfile, occupation: Occupation): Ranking {
  const breakdown: ScoreBreakdown = {
    interests: scoreInterests(profile, occupation),
    skills: scoreSkills(profile, occupation),
    values: scoreValues(profile, occupation),
    big5: scoreBig5(profile, occupation),
    constraints: scoreConstraints(profile, occupation),
    market: scoreMarket(occupation),  // always non-null
  };

  // Re-normalize weights over present dimensions only
  const present = DIMENSIONS.filter((d) => breakdown[d] !== null);
  const totalWeight = present.reduce((acc, d) => acc + WEIGHTS[d], 0);

  const weights_used: Partial<Record<DimensionName, number>> = {};
  for (const d of present) {
    weights_used[d] = (WEIGHTS[d] / totalWeight) * 100;
  }

  let total = 0;
  for (const d of present) {
    total += (breakdown[d] as number) * (weights_used[d] as number) / 100;
  }

  return {
    occupation_id: occupation.id,
    total_score: Math.round(total),
    breakdown,
    weights_used,
  };
}
```

- [ ] **Step 3: Run, expect 5/5 pass**

- [ ] **Step 4: Commit**

```powershell
git add lib/matching/engine.ts tests/unit/matching/engine.test.ts
git commit -m "feat(matching): rank engine with re-normalized weights for missing dimensions"
```

---

## Task 11: 3-paths bucketing (TDD)

**Files:**
- Create: `lib/matching/paths.ts`
- Create: `tests/unit/matching/paths.test.ts`

- [ ] **Step 1: TDD `paths.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { pickPaths } from "@/lib/matching/paths";
import type { Ranking, Occupation } from "@/lib/matching/types";

const fakeOcc = (overrides: Partial<Occupation> & { id: string }): Occupation => ({
  id: overrides.id, title_he: overrides.id, title_en: overrides.id, description_he: "x".repeat(40),
  riasec_affinity: overrides.riasec_affinity ?? { R: 0.5, I: 0.5, A: 0.5, S: 0.5, E: 0.5, C: 0.5 },
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: overrides.constraints ?? {
    typical_training_months: 6, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: overrides.market ?? { demand_he: "high", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

const rank = (id: string, total: number, breakdown: Partial<Ranking["breakdown"]>): Ranking => ({
  occupation_id: id,
  total_score: total,
  breakdown: { interests: null, skills: null, values: null, big5: null, constraints: null, market: null, ...breakdown },
  weights_used: {},
});

describe("pickPaths", () => {
  it("picks safe = highest with constraints≥75 + short training + high demand", () => {
    const occs = [
      fakeOcc({ id: "long-train", constraints: { typical_training_months: 24, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
      fakeOcc({ id: "short-train", constraints: { typical_training_months: 3, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
    ];
    const rankings = [
      rank("long-train", 80, { constraints: 90, interests: 70 }),
      rank("short-train", 70, { constraints: 85, interests: 70 }),
    ];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBe("short-train");
  });

  it("picks growth = next-best with interests≥70 and 6-18 month training", () => {
    const occs = [
      fakeOcc({ id: "safe-pick", constraints: { typical_training_months: 3, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
      fakeOcc({ id: "growth-pick", constraints: { typical_training_months: 12, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
      fakeOcc({ id: "too-long", constraints: { typical_training_months: 36, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
    ];
    const rankings = [
      rank("safe-pick", 90, { constraints: 90, interests: 80 }),
      rank("growth-pick", 80, { constraints: 60, interests: 80 }),
      rank("too-long", 75, { constraints: 60, interests: 80 }),
    ];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBe("safe-pick");
    expect(paths.growth).toBe("growth-pick");
  });

  it("returns null in slots with no qualifying occupation", () => {
    const occs = [fakeOcc({ id: "x", constraints: { typical_training_months: 36, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] }, market: { demand_he: "low", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" } })];
    const rankings = [rank("x", 40, { interests: 30, constraints: 30 })];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBeNull();
    expect(paths.growth).toBeNull();
    expect(paths.wildcard).toBeNull();
  });

  it("never reuses an occupation across paths", () => {
    const occs = [
      fakeOcc({ id: "a", constraints: { typical_training_months: 3, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
    ];
    const rankings = [rank("a", 95, { interests: 90, constraints: 90 })];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBe("a");
    expect(paths.growth).toBeNull(); // can't reuse "a"
    expect(paths.wildcard).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `lib/matching/paths.ts`**

```ts
import type { Ranking, Occupation, Paths } from "./types";

export function pickPaths(rankings: Ranking[], occupations: Occupation[]): Paths {
  const occMap = new Map(occupations.map((o) => [o.id, o]));
  const used = new Set<string>();

  const findRank = (predicate: (r: Ranking, occ: Occupation) => boolean): string | null => {
    for (const r of rankings) {
      if (used.has(r.occupation_id)) continue;
      const occ = occMap.get(r.occupation_id);
      if (!occ) continue;
      if (predicate(r, occ)) {
        used.add(r.occupation_id);
        return r.occupation_id;
      }
    }
    return null;
  };

  const safe = findRank((r, occ) =>
    (r.breakdown.constraints ?? 0) >= 75 &&
    occ.constraints.typical_training_months <= 6 &&
    (occ.market.demand_he === "high" || occ.market.demand_he === "very_high"),
  );

  const growth = findRank((r, occ) =>
    (r.breakdown.interests ?? 0) >= 70 &&
    occ.constraints.typical_training_months >= 6 &&
    occ.constraints.typical_training_months <= 18 &&
    (occ.market.demand_he === "medium" || occ.market.demand_he === "high" || occ.market.demand_he === "very_high"),
  );

  const wildcard = findRank((r) =>
    r.total_score >= 60,
  );

  return { safe, growth, wildcard };
}
```

- [ ] **Step 3: Run, expect 4/4 pass**

- [ ] **Step 4: Commit**

```powershell
git add lib/matching/paths.ts tests/unit/matching/paths.test.ts
git commit -m "feat(matching): 3-paths bucketing (safe / growth / wildcard) heuristic"
```

---

## Task 12: Profile hash for cache key (TDD)

**Files:**
- Create: `lib/matching/hash.ts`
- Create: `tests/unit/matching/hash.test.ts`

- [ ] **Step 1: TDD `hash.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { profileHash } from "@/lib/matching/hash";
import type { MatchingProfile } from "@/lib/matching/types";

const empty: MatchingProfile = {
  interests: null, skills: null, values: null, big5: null, constraints: null,
};

describe("profileHash", () => {
  it("returns the same hash for the same profile + version", () => {
    const a = profileHash(empty, 1);
    const b = profileHash(empty, 1);
    expect(a).toBe(b);
  });

  it("returns different hashes when catalog version differs", () => {
    expect(profileHash(empty, 1)).not.toBe(profileHash(empty, 2));
  });

  it("returns different hashes when profile content differs", () => {
    const withInterests: MatchingProfile = {
      ...empty,
      interests: { R: 50, I: 50, A: 50, S: 50, E: 50, C: 50 },
    };
    expect(profileHash(empty, 1)).not.toBe(profileHash(withInterests, 1));
  });

  it("is order-independent for fields", () => {
    const p1: MatchingProfile = {
      ...empty,
      values: { topThree: ["a","b","c"], alsoPicked: ["x","y"] },
    };
    const p2: MatchingProfile = {
      values: { topThree: ["a","b","c"], alsoPicked: ["x","y"] },
      interests: null, skills: null, big5: null, constraints: null,
    };
    expect(profileHash(p1, 1)).toBe(profileHash(p2, 1));
  });
});
```

- [ ] **Step 2: Implement `lib/matching/hash.ts`**

```ts
import { createHash } from "node:crypto";
import type { MatchingProfile } from "./types";

export function profileHash(profile: MatchingProfile, catalogVersion: number): string {
  const stable = stableStringify({ profile, catalogVersion });
  return createHash("sha1").update(stable).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
```

- [ ] **Step 3: Run, expect 4/4 pass**

- [ ] **Step 4: Commit**

```powershell
git add lib/matching/hash.ts tests/unit/matching/hash.test.ts
git commit -m "feat(matching): stable profile hash for recommendations cache key"
```

---

## Task 13: DB layer — load occupations + recommendations cache

**Files:**
- Create: `lib/db/occupations.ts`
- Create: `lib/db/recommendations.ts`

- [ ] **Step 1: Write `lib/db/occupations.ts`**

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Occupation } from "@/lib/matching/types";

export async function loadAllOccupations(): Promise<Occupation[]> {
  const svc = createServiceClient();
  const { data, error } = await svc.from("occupations").select("*");
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    title_he: row.title_he,
    title_en: row.title_en,
    description_he: row.description_he,
    riasec_affinity: row.riasec_affinity as Occupation["riasec_affinity"],
    required_skills: row.required_skills as Occupation["required_skills"],
    desired_skills: row.desired_skills as Occupation["desired_skills"],
    values_fit: row.values_fit ?? [],
    big5_fit: (row.big5_fit as Occupation["big5_fit"]) ?? undefined,
    constraints: row.constraints as Occupation["constraints"],
    market: row.market as Occupation["market"],
    data_source: row.data_source,
    last_verified_at: row.last_verified_at,
  }));
}

export async function loadCatalogVersion(): Promise<number> {
  const svc = createServiceClient();
  const { data, error } = await svc.from("catalog_version").select("version").eq("id", 1).single();
  if (error) throw error;
  return data.version;
}
```

- [ ] **Step 2: Write `lib/db/recommendations.ts`**

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { RecommendationResult } from "@/lib/matching/types";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

export type CachedRecommendation = {
  rankings: RecommendationResult["rankings"];
  paths: RecommendationResult["paths"];
  prose: Record<string, string>;  // occupation_id → Hebrew prose
  generatedAt: string;
};

export async function getCached(
  userId: string,
  profileHash: string,
): Promise<CachedRecommendation | null> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("recommendations")
    .select("rankings, paths, prose, generated_at")
    .eq("user_id", userId)
    .eq("profile_hash", profileHash)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const ageMs = Date.now() - new Date(data.generated_at).getTime();
  if (ageMs > CACHE_TTL_MS) return null;

  return {
    rankings: data.rankings as never,
    paths: data.paths as never,
    prose: data.prose as never,
    generatedAt: data.generated_at,
  };
}

export async function saveRecommendation(args: {
  userId: string;
  profileHash: string;
  rankings: RecommendationResult["rankings"];
  paths: RecommendationResult["paths"];
  prose: Record<string, string>;
}): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc.from("recommendations").insert({
    user_id: args.userId,
    profile_hash: args.profileHash,
    rankings: args.rankings as never,
    paths: args.paths as never,
    prose: args.prose as never,
  });
  if (error) throw error;
}
```

- [ ] **Step 3: Verify TS compile**

```powershell
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```powershell
git add lib/db/occupations.ts lib/db/recommendations.ts
git commit -m "feat(db): occupations loader and recommendations cache layer"
```

---

## Task 14: Profile assembler — collect signal from chat + assessments

**Files:**
- Create: `lib/matching/profile.ts`

This module consumes Phase 2's `getProfile` output (which now includes `formal.{riasec,big5,values,constraints}` from Phase 3a) and produces a `MatchingProfile` ready for the engine.

- [ ] **Step 1: Write `lib/matching/profile.ts`**

```ts
import "server-only";
import type { MatchingProfile, RiasecVector, Big5Vector } from "./types";

type RawProfile = {
  data?: {
    interests?: { label_he: string; confidence?: string }[];
    skills?: { label_he: string; confidence?: string }[];
    values?: string[];
    constraints?: Record<string, unknown>;
    summary_he?: string;
  };
  formal?: {
    riasec: { scores: { R: number; I: number; A: number; S: number; E: number; C: number } } | null;
    big5: { scores: { O: number; C: number; E: number; A: number; N: number } } | null;
    values: { scores: { topThree: string[]; alsoPicked: string[] } } | null;
    constraints: { scores: Record<string, unknown> } | null;
  };
} | null;

const CONFIDENCE_TO_LEVEL: Record<string, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

export function buildMatchingProfile(raw: RawProfile): MatchingProfile {
  const profile: MatchingProfile = {
    interests: null,
    skills: null,
    values: null,
    big5: null,
    constraints: null,
  };

  // Interests: prefer formal RIASEC scores; fall back to nothing (chat-only users
  // don't get an interests dimension since chat extraction doesn't produce RIASEC vectors)
  const formalRiasec = raw?.formal?.riasec?.scores;
  if (formalRiasec) {
    profile.interests = formalRiasec as RiasecVector;
  }

  // Big5: only formal
  const formalBig5 = raw?.formal?.big5?.scores;
  if (formalBig5) {
    profile.big5 = formalBig5 as Big5Vector;
  }

  // Values: prefer formal; fall back to chat-extracted
  const formalValues = raw?.formal?.values?.scores;
  if (formalValues) {
    profile.values = formalValues as { topThree: string[]; alsoPicked: string[] };
  } else if (raw?.data?.values && raw.data.values.length > 0) {
    // Chat-extracted values are free strings, not ranked. Use the first 3 as topThree.
    const vals = raw.data.values;
    profile.values = {
      topThree: vals.slice(0, 3),
      alsoPicked: vals.slice(3, 5),
    };
  }

  // Constraints: prefer formal; fall back to chat-extracted (which is free-form)
  const formalConstraints = raw?.formal?.constraints?.scores;
  if (formalConstraints) {
    profile.constraints = formalConstraints as MatchingProfile["constraints"];
  } else if (raw?.data?.constraints) {
    profile.constraints = raw.data.constraints as MatchingProfile["constraints"];
  }

  // Skills: only chat-extracted in Phase 4 (CV upload is Phase 3b)
  if (raw?.data?.skills && raw.data.skills.length > 0) {
    profile.skills = raw.data.skills.map((s) => ({
      id: s.label_he,
      level: CONFIDENCE_TO_LEVEL[s.confidence ?? "medium"] ?? 0.6,
    }));
  }

  return profile;
}
```

- [ ] **Step 2: Verify TS compile**

- [ ] **Step 3: Commit**

```powershell
git add lib/matching/profile.ts
git commit -m "feat(matching): profile assembler — chat-extracted + formal assessments → MatchingProfile"
```

---

## Task 15: Hebrew prose generator (LLM call)

**Files:**
- Create: `lib/ai/prompts/explanations.ts`

- [ ] **Step 1: Write the generator**

```ts
import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { anthropic, MODEL_ID } from "@/lib/ai/client";
import type { Ranking, Occupation, MatchingProfile } from "@/lib/matching/types";

const ProseSchema = z.object({
  explanations: z.array(
    z.object({
      occupation_id: z.string(),
      explanation_he: z.string().min(40).max(900),
    }),
  ),
});

export async function generateExplanations(args: {
  profile: MatchingProfile;
  rankings: Ranking[];
  occupations: Occupation[];
  topN?: number;
}): Promise<Record<string, string>> {
  const top = args.rankings.slice(0, args.topN ?? 5);
  const occMap = new Map(args.occupations.map((o) => [o.id, o]));

  const occContext = top.map((r) => {
    const occ = occMap.get(r.occupation_id);
    return {
      id: r.occupation_id,
      title_he: occ?.title_he,
      description_he: occ?.description_he,
      total_score: r.total_score,
      breakdown: r.breakdown,
    };
  });

  const profileContext = JSON.stringify(args.profile, null, 2);
  const occContextStr = JSON.stringify(occContext, null, 2);

  const result = await generateObject({
    model: anthropic(MODEL_ID),
    schema: ProseSchema,
    system: `אתה כותב הסברים קצרים בעברית למשתמש שקיבל המלצה על מקצוע. אתה מקבל את הפרופיל שלו (תחומי עניין, כישורים, ערכים, אילוצים) ואת הציונים של מקצוע מסוים, וכותב 3-5 משפטים שמסבירים *למה* המקצוע הזה התאים לו ספציפית. אל תכתוב כללי. אל תחזור על שם המקצוע יותר מפעם. אל תהפוך את הציונים למספרים בטקסט. הסבר את הקשר בין הפרופיל למקצוע — מה במקצוע מתאים למה שהמשתמש סיפר על עצמו, ומה החיסרון/אתגר.

מבנה: משפט פתיחה אישי → 1-2 משפטים על מה מתאים → משפט אחד על אתגר/דבר שצריך לקחת בחשבון → אופציונלי משפט פעולה הבא.`,
    prompt: `הפרופיל של המשתמש:\n${profileContext}\n\nהמקצועות (top ${top.length}):\n${occContextStr}\n\nהחזר הסבר אישי לכל מקצוע.`,
    providerOptions: {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
    },
  });

  const out: Record<string, string> = {};
  for (const e of result.object.explanations) {
    out[e.occupation_id] = e.explanation_he;
  }
  return out;
}
```

- [ ] **Step 2: Verify TS compile**

- [ ] **Step 3: Commit**

```powershell
git add lib/ai/prompts/explanations.ts
git commit -m "feat(ai): Hebrew prose generator for top-N occupation explanations"
```

> **Note:** No unit test for this — it's an LLM call. End-to-end smoke test in Task 19 covers it.

---

## Task 16: API route — POST /api/recommendations

**Files:**
- Create: `app/api/recommendations/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getProfile } from "@/lib/db/profile";
import { loadAllOccupations, loadCatalogVersion } from "@/lib/db/occupations";
import { getCached, saveRecommendation } from "@/lib/db/recommendations";
import { buildMatchingProfile } from "@/lib/matching/profile";
import { rankOccupations } from "@/lib/matching/engine";
import { pickPaths } from "@/lib/matching/paths";
import { profileHash } from "@/lib/matching/hash";
import { generateExplanations } from "@/lib/ai/prompts/explanations";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const internalUserId = await getOrCreateAnonymousUserId(user?.id);

    const [profileRaw, occupations, catalogVersion] = await Promise.all([
      // We need a conversation_id; use the most recent one for the user.
      getMostRecentConversationProfile(internalUserId),
      loadAllOccupations(),
      loadCatalogVersion(),
    ]);

    const profile = buildMatchingProfile(profileRaw);
    const hash = profileHash(profile, catalogVersion);

    const cached = await getCached(internalUserId, hash);
    if (cached) {
      return Response.json({
        rankings: cached.rankings,
        paths: cached.paths,
        prose: cached.prose,
        cached: true,
        generated_at: cached.generatedAt,
      });
    }

    const rankings = rankOccupations(profile, occupations);
    const paths = pickPaths(rankings, occupations);

    let prose: Record<string, string> = {};
    if (rankings.length > 0) {
      prose = await generateExplanations({
        profile, rankings, occupations, topN: 5,
      });
    }

    await saveRecommendation({
      userId: internalUserId,
      profileHash: hash,
      rankings: rankings.slice(0, 10),  // persist top-10
      paths,
      prose,
    });

    return Response.json({
      rankings: rankings.slice(0, 10),
      paths,
      prose,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[recommendations] error", { message });
    return Response.json({ error: "recommendations_failed", message }, { status: 500 });
  }
}

async function getMostRecentConversationProfile(userId: string) {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const svc = createServiceClient();
  const { data: convs } = await svc
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const conversationId = convs?.[0]?.id;
  if (!conversationId) {
    // No conversation → no chat-extracted profile, but assessments may still exist
    const { data: cp } = await svc
      .from("career_profile")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const formal = await getProfile(userId, "00000000-0000-0000-0000-000000000000")
      .catch(() => null);
    return cp ? { ...cp, formal: formal?.formal } : { formal: formal?.formal ?? null };
  }
  return getProfile(userId, conversationId);
}
```

- [ ] **Step 2: Verify TS compile + build**

```powershell
npx tsc --noEmit
npm run build
```

Expected: route appears as `ƒ /api/recommendations` in the route table.

- [ ] **Step 3: Commit**

```powershell
git add app/api/recommendations/route.ts
git commit -m "feat(api): POST /api/recommendations with profile-hash cache"
```

---

## Task 17: i18n strings for recommendations

**Files:**
- Modify: `lib/i18n/he.ts`

- [ ] **Step 1: Add `recommendations` section**

After the `assessment` section, add:

```ts
  recommendations: {
    title: "המלצות הקריירה שלך",
    subtitle: "שלושה מסלולים שונים שעולים מהפרופיל שלך. כל אחד עם הסבר אישי, פירוט ציונים, ואתגרים אפשריים.",
    pathLabels: {
      safe: "מסלול בטוח",
      growth: "מסלול צמיחה",
      wildcard: "מסלול ג'וקר",
    },
    pathDescriptions: {
      safe: "מתאים למה שאתה כבר יכול לעשות מהר, עם ביקוש גבוה והשקעה נמוכה.",
      growth: "מתאים אם אתה מוכן ללמוד 6-18 חודשים, עם פוטנציאל גבוה יותר.",
      wildcard: "כיוון פחות מובן מאליו אבל עם פוטנציאל מעניין בשבילך.",
    },
    breakdown: {
      title: "פירוט ההתאמה",
      labels: {
        interests: "תחומי עניין",
        skills: "כישורים",
        values: "ערכים",
        big5: "אופי",
        constraints: "אילוצים",
        market: "שוק העבודה",
      },
      missing: "אין נתונים",
    },
    market: {
      demand: "ביקוש",
      salary: "טווח שכר",
      training: "זמן הכשרה",
      months: "חודשים",
      noTraining: "ללא הכשרה רשמית",
      ai_risk: "סיכון אוטומציה",
    },
    demandLabels: {
      low: "נמוך",
      medium: "בינוני",
      high: "גבוה",
      very_high: "גבוה מאוד",
    },
    aiRiskLabels: {
      low: "נמוך",
      medium: "בינוני",
      high: "גבוה",
    },
    emptyProfile: {
      title: "צריך עוד קצת מידע",
      body: "כדי לתת המלצות שמתאימות לך באמת, השלם לפחות שיחה אחת או שאלון אחד.",
      ctaChat: "התחל שיחה",
      ctaAssess: "מילוי שאלון",
    },
    error: {
      generic: "לא הצלחנו ליצור המלצות כרגע. נסה שוב בעוד רגע.",
    },
    cachedNote: "המלצות שמורות מ-{when}. נרענן אם תוסיף לפרופיל שלך.",
    regenerate: "צור מחדש",
    noPathOption: "אין אפשרות מובהקת במסלול הזה לפי הפרופיל הנוכחי שלך.",
  },
```

- [ ] **Step 2: Verify TS compile**

- [ ] **Step 3: Commit**

```powershell
git add lib/i18n/he.ts
git commit -m "feat(i18n): recommendations Hebrew strings (paths, breakdown, market, errors)"
```

---

## Task 18: UI components

**Files:**
- Create: `components/recommendations/PathCard.tsx`
- Create: `components/recommendations/ScoreBreakdown.tsx`
- Create: `components/recommendations/ThreePathsView.tsx`
- Create: `components/recommendations/EmptyProfileState.tsx`

- [ ] **Step 1: `ScoreBreakdown.tsx`** — paste exactly:

```tsx
import { he } from "@/lib/i18n/he";
import type { ScoreBreakdown as Breakdown } from "@/lib/matching/types";

const ROW_ORDER: (keyof Breakdown)[] = ["interests", "skills", "values", "big5", "constraints", "market"];

export function ScoreBreakdown({ breakdown }: { breakdown: Breakdown }) {
  const labels = he.recommendations.breakdown.labels;
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{he.recommendations.breakdown.title}</div>
      <ul className="space-y-1.5">
        {ROW_ORDER.map((key) => {
          const v = breakdown[key];
          return (
            <li key={key} className="flex items-center gap-3">
              <div className="w-24 shrink-0 text-sm">{labels[key]}</div>
              {v === null ? (
                <span className="text-xs text-muted-foreground">{he.recommendations.breakdown.missing}</span>
              ) : (
                <>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${v}%` }} />
                  </div>
                  <div className="w-10 text-end text-xs tabular-nums" dir="ltr">{v}</div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: `PathCard.tsx`**

```tsx
import { he } from "@/lib/i18n/he";
import { ScoreBreakdown } from "./ScoreBreakdown";
import type { Ranking, Occupation } from "@/lib/matching/types";

export function PathCard({
  pathLabel,
  pathDescription,
  ranking,
  occupation,
  prose,
}: {
  pathLabel: string;
  pathDescription: string;
  ranking: Ranking;
  occupation: Occupation;
  prose?: string;
}) {
  const market = he.recommendations.market;
  const demandLabels = he.recommendations.demandLabels;
  const aiRiskLabels = he.recommendations.aiRiskLabels;
  const trainingMonths = occupation.constraints.typical_training_months;

  return (
    <article className="flex h-full flex-col gap-4 rounded-xl border bg-card p-5">
      <header className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wide text-primary">{pathLabel}</div>
        <p className="text-xs text-muted-foreground">{pathDescription}</p>
      </header>
      <div>
        <h3 className="text-xl font-semibold">{occupation.title_he}</h3>
        <p className="mt-1 text-sm text-muted-foreground" dir="auto">{occupation.description_he}</p>
      </div>
      {prose && (
        <p className="rounded-md bg-primary/5 p-3 text-sm leading-relaxed" dir="auto">{prose}</p>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{market.demand}</dt>
          <dd>{demandLabels[occupation.market.demand_he]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{market.salary}</dt>
          <dd dir="ltr">
            ₪{occupation.market.typical_salary_nis_min.toLocaleString()}–{occupation.market.typical_salary_nis_max.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{market.training}</dt>
          <dd>{trainingMonths === 0 ? market.noTraining : `${trainingMonths} ${market.months}`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{market.ai_risk}</dt>
          <dd>{aiRiskLabels[occupation.market.ai_risk]}</dd>
        </div>
      </dl>
      <ScoreBreakdown breakdown={ranking.breakdown} />
    </article>
  );
}
```

- [ ] **Step 3: `ThreePathsView.tsx`**

```tsx
import { he } from "@/lib/i18n/he";
import { PathCard } from "./PathCard";
import type { Ranking, Occupation, Paths } from "@/lib/matching/types";

export function ThreePathsView({
  rankings,
  paths,
  occupations,
  prose,
}: {
  rankings: Ranking[];
  paths: Paths;
  occupations: Occupation[];
  prose: Record<string, string>;
}) {
  const occMap = new Map(occupations.map((o) => [o.id, o]));
  const rankMap = new Map(rankings.map((r) => [r.occupation_id, r]));
  const labels = he.recommendations.pathLabels;
  const descriptions = he.recommendations.pathDescriptions;

  const slots: { key: "safe" | "growth" | "wildcard"; id: string | null }[] = [
    { key: "safe", id: paths.safe },
    { key: "growth", id: paths.growth },
    { key: "wildcard", id: paths.wildcard },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {slots.map(({ key, id }) => {
        if (!id) {
          return (
            <div key={key} className="rounded-xl border border-dashed bg-muted/20 p-5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels[key]}</div>
              <p className="mt-3 text-sm text-muted-foreground">{he.recommendations.noPathOption}</p>
            </div>
          );
        }
        const ranking = rankMap.get(id);
        const occupation = occMap.get(id);
        if (!ranking || !occupation) return null;
        return (
          <PathCard
            key={key}
            pathLabel={labels[key]}
            pathDescription={descriptions[key]}
            ranking={ranking}
            occupation={occupation}
            prose={prose[id]}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: `EmptyProfileState.tsx`**

```tsx
import Link from "next/link";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";

export function EmptyProfileState() {
  const t = he.recommendations.emptyProfile;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center">
      <h2 className="text-xl font-semibold">{t.title}</h2>
      <p className="text-sm text-muted-foreground">{t.body}</p>
      <div className="flex gap-2">
        <Button asChild><Link href="/chat">{t.ctaChat}</Link></Button>
        <Button asChild variant="outline"><Link href="/assessment">{t.ctaAssess}</Link></Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```powershell
git add components/recommendations
git commit -m "feat(ui): recommendations components (PathCard, ScoreBreakdown, ThreePathsView, EmptyState)"
```

---

## Task 19: Page — `/recommendations`

**Files:**
- Create: `app/(app)/recommendations/page.tsx`
- Create: `components/recommendations/RecommendationsClient.tsx`

- [ ] **Step 1: Write the client component (handles the POST + state)**

`components/recommendations/RecommendationsClient.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { he } from "@/lib/i18n/he";
import { ThreePathsView } from "./ThreePathsView";
import { EmptyProfileState } from "./EmptyProfileState";
import { Button } from "@/components/ui/button";
import type { Ranking, Occupation, Paths } from "@/lib/matching/types";

type ApiResponse = {
  rankings: Ranking[];
  paths: Paths;
  prose: Record<string, string>;
  cached: boolean;
  generated_at?: string;
  error?: string;
};

export function RecommendationsClient({ occupations }: { occupations: Occupation[] }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecs = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        cache: force ? "no-store" : "default",
      });
      if (!res.ok) {
        setError(he.recommendations.error.generic);
        setLoading(false);
        return;
      }
      const json = (await res.json()) as ApiResponse;
      if (json.error) {
        setError(he.recommendations.error.generic);
      } else {
        setData(json);
      }
    } catch {
      setError(he.recommendations.error.generic);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRecs(); }, []);

  if (loading && !data) {
    return <div className="py-16 text-center text-muted-foreground">…</div>;
  }
  if (error && !data) {
    return <div className="py-16 text-center text-sm text-destructive">{error}</div>;
  }
  if (!data || data.rankings.length === 0) return <EmptyProfileState />;

  const cachedNote = data.cached && data.generated_at
    ? he.recommendations.cachedNote.replace("{when}", new Date(data.generated_at).toLocaleDateString("he-IL"))
    : null;

  return (
    <div className="space-y-4">
      {cachedNote && (
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>{cachedNote}</span>
          <Button size="sm" variant="ghost" onClick={() => fetchRecs(true)}>{he.recommendations.regenerate}</Button>
        </div>
      )}
      <ThreePathsView
        rankings={data.rankings}
        paths={data.paths}
        occupations={occupations}
        prose={data.prose}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write the page (server component fetches occupations once)**

`app/(app)/recommendations/page.tsx`:
```tsx
import { he } from "@/lib/i18n/he";
import { loadAllOccupations } from "@/lib/db/occupations";
import { RecommendationsClient } from "@/components/recommendations/RecommendationsClient";

export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  const occupations = await loadAllOccupations();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{he.recommendations.title}</h1>
        <p className="text-base text-muted-foreground">{he.recommendations.subtitle}</p>
      </header>
      <RecommendationsClient occupations={occupations} />
    </div>
  );
}
```

- [ ] **Step 3: Build, expect success with `/recommendations` in route table**

```powershell
npm run build
```

- [ ] **Step 4: Commit**

```powershell
git add components/recommendations "app/(app)/recommendations"
git commit -m "feat(ui): /recommendations page with client-driven fetch + 3-paths view"
```

---

## Task 20: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Apply migration + seed catalog (already done in Tasks 1+5; redo if dev DB was reset)**

- [ ] **Step 2: Run dev server**

```powershell
npm run dev
```

- [ ] **Step 3: Take all 4 assessments at `/assessment`** (you've validated these in Phase 3a; re-verify the rows write)

- [ ] **Step 4: Visit `/recommendations`**

Expected:
- Loading state for 2-5 seconds
- Three path cards render with: occupation title in Hebrew, prose explanation in Hebrew, market info, score breakdown bars
- Score breakdown shows 6 dimensions, ones present in profile have bars, missing show "אין נתונים"
- `cached: false` on first load

- [ ] **Step 5: Reload `/recommendations`**

Expected: now shows the cached banner with "המלצות שמורות מ-..." and a "צור מחדש" button. No new LLM call.

- [ ] **Step 6: Verify in DB**

Via Supabase MCP `execute_sql`:
```sql
select profile_hash, generated_at,
  jsonb_array_length(rankings) as ranking_count,
  paths,
  jsonb_typeof(prose) as prose_type
from public.recommendations
where user_id = (select id from public.users order by created_at desc limit 1)
order by generated_at desc
limit 3;
```

Expected: 1 row, `ranking_count = 10` (or however many occupations matched), `paths` is a jsonb object with safe/growth/wildcard keys, `prose_type = 'object'`.

- [ ] **Step 7: Sanity-check the Hebrew prose**

Look at `prose` JSONB. Each occupation_id key maps to a Hebrew string of 40-900 chars. Are the explanations specific to the user (mentioning skills/interests they reported) or generic? If generic, that's a Phase 4.5 prompt-engineering follow-up — not a blocker, but log it.

- [ ] **Step 8: Push branch + open PR**

```powershell
git push origin feat/phase-4-matching-engine
```

(use the same gh-token-via-tmotti77 pattern from Phase 3a)

```powershell
gh pr create --title "Phase 4: occupations DB + matching engine" --body "..."
```

---

## 5. Definition of Done

- [ ] Migration applied; `occupations`, `skills`, `recommendations`, `catalog_version` tables exist
- [ ] 60 skills + 20 occupations seeded; `catalog_version` ≥ 2
- [ ] All 6 per-dimension scorers + engine + paths + hash have green unit tests (~30 tests across 8 files)
- [ ] `/api/recommendations` works for: chat-only profile, assessment-only profile, full profile, no-profile (returns empty rankings → UI shows EmptyProfileState)
- [ ] `/recommendations` page renders 3 path cards with Hebrew prose + score breakdown
- [ ] Recommendations cache works: same profile → same hash → cached response on second request; profile change → new hash → recompute
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds; `/recommendations` and `/api/recommendations` in route table
- [ ] CLAUDE.md updated with Phase 4 architecture notes
- [ ] PR opened against `main`

---

## 6. Known follow-ups (not blocking Phase 4 merge)

1. **Catalog expansion to 100 occupations** — Phase 4.5; parallel research track.
2. **Item-quality review of occupation JSONs** by a career counselor or domain expert (master roadmap §6 risk: "Occupation DB stale or wrong"). Phase 7 launch checklist.
3. **Skill-extraction-to-taxonomy mapping** via LLM — Phase 3b (CV upload).
4. **Generic-feeling prose** if user testing flags it — refine `lib/ai/prompts/explanations.ts` system prompt to require quoting user phrases verbatim from `data.summary_he` or chat history.
5. **Per-conversation profile picker** — currently the recommendations route uses the user's most recent conversation. If a user has multiple, we should let them pick.
6. **3-paths fallback when no occupation qualifies** — currently shows "no clear N-path option". Could relax the criteria progressively (lower the constraints score threshold, etc.) and surface that we did so.
7. **Score breakdown explanations** — clicking a bar in the breakdown could show "interests = 78 because your top RIASEC types match this role's affinity" inline. UX polish for Phase 5.
8. **Locale-aware date formatting** — the cached note uses `toLocaleDateString("he-IL")` which gives Gregorian. If we ever need Hebrew calendar, that's a separate task.
9. **Staleness UX** — currently shows cached if ≤7 days. If profile changed but hash didn't (e.g. user re-took an assessment with same answers), the engine still re-runs. Acceptable — it's cheap.
10. **Telemetry** — `lib/analytics.ts` event for "recommendations_generated" with cache hit/miss + time-to-render. Phase 6 polish.
