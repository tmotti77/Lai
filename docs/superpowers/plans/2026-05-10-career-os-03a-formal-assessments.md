# CareerOS — Phase 3a: Formal Assessments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four formal assessment surfaces — 30-item RIASEC interest inventory, 20-item Big-Five short form, 12-option values picker, and a constraints form — with **deterministic** scoring in pure TypeScript, persisted to a versioned `assessments` table, surfaced through a unified Hebrew RTL UI hub at `/assessment`. The output is a structured profile signal that the Phase 4 matching engine can consume alongside Phase 2's chat-extracted profile.

**Architecture:** Items live in code (`lib/assessment/<type>/items.ts`), not DB — they're versioned with the repo and rarely change. Each submission writes one row to `public.assessments` with the raw responses, the computed scores, and an `items_version` so old scores remain interpretable when items get reworded. Scoring is pure TypeScript (no LLM): `lib/assessment/<type>/score.ts` is unit-tested against fixture inputs. The four assessments share one `/api/assessment/submit` endpoint that validates the payload against a discriminated-union zod schema, computes scores server-side, and persists. The UI is a hub at `/assessment` showing per-assessment status (not started / in progress / complete) plus deep-link routes per assessment. Submissions are visible to the chat agent on subsequent turns by extending Phase 2's `getProfile` to JOIN the latest assessment row per type.

**Tech Stack:** Builds on Phase 1+2 (Next.js 16 + Supabase + Anthropic Claude + Vercel AI SDK). Adds: zod discriminated unions for the submit endpoint, Radix UI primitives (`@radix-ui/react-radio-group`, `@radix-ui/react-slider`) for accessible Hebrew RTL form controls. No new heavy deps.

---

## 1. Decisions baked into this plan

| Decision | Choice | Why |
|---|---|---|
| Items storage | **Code (`lib/assessment/<type>/items.ts`)**, not DB | Items are static, versioned with repo; no need for migrations to reword a question. Scoring functions stay testable. |
| Items version field | **`items_version` integer per row** | Future item rewording shouldn't silently invalidate historical scores. Score against the version that was active at submission time. |
| Scoring | **Pure deterministic TypeScript** | Same input → same output, unit-testable, free. LLM only writes Hebrew prose around scores in Phase 4. CLAUDE.md §"Matching is deterministic TypeScript" already enshrines this. |
| Assessments table | **One row per submission** (history-preserving) | Allows retakes without overwriting; lets us track drift over time; gives an audit trail. Latest-per-type retrieved via `DISTINCT ON (user_id, type) ORDER BY taken_at DESC`. |
| Profile integration | **`getProfile()` JOINs latest assessment per type at read time**, not a denormalized cache | One source of truth. No sync problems. |
| RIASEC items | **30 items, paraphrased from O\*NET Interest Profiler short form (public domain)** | 5 items × 6 types. Hebrew-paraphrased; no licensed test reproduction. Matches master roadmap §4.3. |
| Big5 items | **20 items, IPIP-NEO short form (open license)**, Hebrew-translated | 4 items × 5 traits. Each trait has 2 positively-keyed and 2 reverse-keyed items to control acquiescence bias. |
| Values selection | **Pick top 5 of 12, then rank top 3** | Pure ranking is too tedious for 12. Pick-then-rank is faster, captures the meaningful signal (which 3 dominate). |
| Constraints form | **Single page, mostly optional**, with sensible defaults | Privacy: don't force health/marital info. Required: location, time-available, budget. Optional: everything else. |
| Submit endpoint | **One unified `/api/assessment/submit` with zod discriminated union** | Single auth/rate-limit/persistence surface. Type-safe. Easier to add a 5th assessment later. |
| Anonymous flow | **All assessments work for anonymous users** | Match Phase 1+2's anonymous-first principle. Sign-up is required to *save the report* (Phase 5), not to take assessments. |
| UI layout | **Hub at `/assessment` + deep-link per assessment** | Lets users do them in any order (RIASEC twice if they want), shows progress at a glance. |
| Form library | **Native HTML `<form>` + RHF-free `useState`** | Forms are short (≤30 items). React Hook Form is overkill. shadcn/ui primitives + uncontrolled-where-trivial is enough. |
| Scoring boundary | **Server-side, never client** | Client computes for live preview if we want, but the persisted `scores` jsonb is computed in `/api/assessment/submit`. Client could be tampered with. |
| Required to proceed? | **No gating** | Phase 3a doesn't gate the chat or future flows. Phase 4 matching will work with whatever profile signal it has — formal assessments improve match quality but aren't strict prerequisites. |

**Out of scope for this plan (Phase 3b or later):**
- CV upload + skills extraction (Phase 3b)
- Re-translation/review of items by a Hebrew-speaking psychologist (we ship best-effort items v1 and gate "production launch" on that review)
- Adaptive testing (early-termination logic)
- Result visualization (radar chart, percentiles vs cohort) — Phase 5 report owns this
- "Compare retakes" UI

---

## 2. Architectural notes worth documenting

### 2.1 Why `items_version` matters
If we reword item #7 from "אני נהנה לעבוד עם המון אנשים בו זמנית" to "אני אוהב להיות במרכז קבוצה גדולה", the meaning shifts subtly and the response distribution may change. A historical row with the old wording but no version tag would be silently misinterpreted by future scoring code. Solution: each `items.ts` exports a `RIASEC_ITEMS_VERSION` constant; the submit endpoint stamps it onto the row. If we ever rev the items, scoring code chooses the right version's mapping. Cheap insurance.

### 2.2 Why pure deterministic, not LLM-assisted
RIASEC and Big5 scoring is arithmetic: per-trait sum, divide by max possible, ×100. Reverse-keyed items: `6 - response` then sum. There's no judgment call. LLM scoring would (a) cost ~$0.01 per submission, (b) be non-reproducible across runs, (c) make `riasec-score.test.ts` impossible to write meaningfully. The LLM has a clear later role: in Phase 5, it writes the Hebrew prose explaining what an "IAS" Holland code means *for this specific person's chat-extracted profile*. Math first, prose second.

### 2.3 Why items live in code, not DB
- Items rarely change; when they do, it's a deliberate review pass, not a runtime config change.
- Versioned with git, code-reviewed before merge.
- Test fixtures can import the items module directly — no DB stub needed for unit tests.
- One fewer migration when adding/removing a question.
- Tradeoff: rewording an item requires a deploy. Acceptable.

### 2.4 Why one unified submit endpoint
We could have `/api/assessment/riasec`, `/api/assessment/big5`, etc. Four endpoints share auth, rate-limit, persistence, and only differ in the validator + scorer. zod discriminated unions handle that cleanly:
```ts
const SubmitSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("riasec"), responses: z.record(z.string(), z.number().int().min(1).max(5)) }),
  z.object({ type: z.literal("big5"), responses: z.record(z.string(), z.number().int().min(1).max(5)) }),
  // ...
]);
```
One place to add auth, persistence, error handling. Adding a 5th assessment is a new union member + a new scorer.

### 2.5 Why pick-then-rank for values, not pure ranking
Pure ranking of 12 items requires the user to commit to a relative order between options 8 and 9 they don't actually care about. The data is mostly noise past the top 3-4. Pick-then-rank: select 5 of 12, then drag-rank only the chosen 5 (then we capture position 1, 2, 3 explicitly; positions 4 and 5 are "also picked"). Captures the meaningful signal in <60 seconds.

### 2.6 Why anonymous users can take assessments
Phase 1's anonymous-first funnel decision applies here. A user who chats and then takes RIASEC has a richer profile than one who only chats. We want that richer profile so when they eventually save the report (and convert), the report is good. Gating assessments behind sign-up would tank our top-of-funnel quality signal. RLS on `assessments` is by `user_id` (the internal anonymous-or-real users.id), same as `conversations` and `career_profile`.

### 2.7 RTL form considerations
- All form layouts use logical properties (`ms-*`, `me-*`, `gap-*`) — never `ml-*`/`mr-*`/`space-x-*`.
- Likert scales: 5 buttons left-to-right in DOM order, but **rendered right-to-left** in RTL — meaning "מסכים מאוד" (strongly agree) appears on the right (start of reading). Verify visually; don't trust the test alone.
- Number inputs (e.g., budget): `dir="ltr"` on the input itself even inside RTL document, because numerals read LTR.
- Sliders: native `<input type="range">` behaves correctly in RTL on modern browsers (right is min, left is max). Verify in Chrome + Firefox.

### 2.8 Latest-per-type query pattern
The `getProfile()` JOIN looks like:
```sql
select distinct on (a.type)
  a.type, a.scores, a.taken_at, a.items_version
from public.assessments a
where a.user_id = $1
order by a.type, a.taken_at desc;
```
Postgres `DISTINCT ON` is the right tool here — gives us "latest per type" in one pass. Index the table on `(user_id, type, taken_at DESC)` to make this fast.

---

## 3. File structure (target end-state for Phase 3a)

```
lib/assessment/                                # NEW
├── riasec/
│   ├── items.ts                               # 30 items + RIASEC_ITEMS_VERSION
│   ├── score.ts                               # scoreRiasec(responses, version) → RiasecScores
│   └── types.ts                               # RiasecResponses, RiasecScores, HollandCode
├── big5/
│   ├── items.ts                               # 20 items, reverse-keyed flags + BIG5_ITEMS_VERSION
│   ├── score.ts                               # scoreBig5(responses, version) → Big5Scores
│   └── types.ts
├── values/
│   ├── options.ts                             # 12 values + VALUES_OPTIONS_VERSION
│   └── types.ts                               # ValuesSubmission, ValuesScores
├── constraints/
│   └── schema.ts                              # zod schema, also exports inferred ts type
└── index.ts                                   # re-exports + AssessmentType union

components/assessment/                         # NEW
├── AssessmentHub.tsx                          # 4-card grid showing status
├── AssessmentLayout.tsx                       # shared shell: header, progress, RTL container
├── RIASECQuiz.tsx
├── Big5Quiz.tsx
├── ValuesPicker.tsx
├── ConstraintsForm.tsx
├── LikertRow.tsx                              # shared 5-point Likert row
└── ProgressIndicator.tsx                      # X / Y items answered

app/(app)/assessment/                          # NEW
├── layout.tsx                                 # auth-optional shell
├── page.tsx                                   # hub
├── riasec/page.tsx
├── big5/page.tsx
├── values/page.tsx
└── constraints/page.tsx

app/api/assessment/                            # NEW
├── submit/route.ts                            # POST: validate, score, persist
└── status/route.ts                            # GET: per-user status of all 4

lib/db/
├── assessments.ts                             # NEW: saveAssessment, getLatestByType, getStatus
├── profile.ts                                 # MODIFIED: getProfile() now JOINs latest assessments
└── types.gen.ts                               # regenerated

lib/i18n/
└── he.ts                                      # MODIFIED: add assessment.* section

supabase/migrations/
└── <timestamp>_assessments.sql                # NEW

tests/unit/assessment/                         # NEW
├── riasec-score.test.ts
├── big5-score.test.ts
├── values-score.test.ts
└── constraints-schema.test.ts

tests/integration/                             # NEW (or extend existing)
└── assessment-submit.test.ts
```

---

## 4. Pre-flight (do once before Task 1)

- [ ] Confirm Phase 2 is fully on `main` and CI is green (`git log --oneline -3` should show the cache-fix commit `aa6daeb` or later)
- [ ] Confirm `npm run dev` works and the chat agent advances stages and extracts profile (you verified this end-of-Phase-2)
- [ ] Confirm `.env.local` has all keys; no new env vars needed for Phase 3a
- [ ] Read `lib/i18n/he.ts` and `lib/db/profile.ts` once so you know the conventions you're extending

---

## Task 1: Migration — `assessments` table

**Files:**
- Create: `supabase/migrations/<timestamp>_assessments.sql`

- [ ] **Step 1: Generate migration file**

```powershell
npx supabase migration new assessments
```

Note the generated filename (timestamp prefix).

- [ ] **Step 2: Write migration SQL**

Paste this into the new file:

```sql
create type public.assessment_type as enum ('riasec', 'big5', 'values', 'constraints');

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type public.assessment_type not null,
  responses jsonb not null,
  scores jsonb not null,
  items_version int not null,
  taken_at timestamptz not null default now()
);

create index assessments_user_type_taken_at_idx
  on public.assessments(user_id, type, taken_at desc);

alter table public.assessments enable row level security;

-- Authenticated users see their own assessments. Anonymous users access via the
-- server's service-role client (same pattern as career_profile in Phase 2 — the
-- chat/assessment routes resolve user_id server-side and bypass RLS).
create policy assessments_self on public.assessments
  for all using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );
```

- [ ] **Step 3: Apply migration**

```powershell
npx supabase db push
```

Expected: "Applying migration <timestamp>_assessments.sql..." then success.

- [ ] **Step 4: Regenerate types**

```powershell
npm run db:types
```

Expected: `lib/db/types.gen.ts` now has `assessments` table type and `assessment_type` enum.

- [ ] **Step 5: Verify types updated**

Open `lib/db/types.gen.ts`, search for `assessments:`. Confirm the table appears with the four columns (`type`, `responses`, `scores`, `items_version`) plus `id`, `user_id`, `taken_at`.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations lib/db/types.gen.ts
git commit -m "feat(db): add assessments table with per-type RLS"
```

---

## Task 2: RIASEC items + types

**Files:**
- Create: `lib/assessment/riasec/items.ts`
- Create: `lib/assessment/riasec/types.ts`

- [ ] **Step 1: Define types**

`lib/assessment/riasec/types.ts`:
```ts
export const RIASEC_TYPES = ["R", "I", "A", "S", "E", "C"] as const;
export type RiasecType = (typeof RIASEC_TYPES)[number];

export type RiasecItem = {
  id: string;            // stable id, e.g. "R1", "A3"
  type: RiasecType;
  text_he: string;
};

export type RiasecResponses = Record<string, number>; // itemId → 1..5

export type RiasecScores = {
  R: number; I: number; A: number; S: number; E: number; C: number;  // 0..100
  hollandCode: string;   // top-3 letters concatenated, e.g. "IAS"
};
```

- [ ] **Step 2: Write items file**

`lib/assessment/riasec/items.ts`:
```ts
import type { RiasecItem } from "./types";

export const RIASEC_ITEMS_VERSION = 1;

export const RIASEC_ITEMS: RiasecItem[] = [
  // Realistic — בונה, מתקן, פיזי, מעשי
  { id: "R1", type: "R", text_he: "אני נהנה לבנות או לתקן דברים בידיים שלי." },
  { id: "R2", type: "R", text_he: "מעניין אותי להפעיל מכונות, ציוד או כלים מקצועיים." },
  { id: "R3", type: "R", text_he: "הייתי שמח לעבוד באוויר הפתוח, גם אם זה דורש מאמץ פיזי." },
  { id: "R4", type: "R", text_he: "אני מעדיף לראות תוצאה מוחשית של מה שעשיתי בסוף היום." },
  { id: "R5", type: "R", text_he: "מעניין אותי איך דברים מורכבים — מנועים, מבנים, מערכות." },

  // Investigative — חוקר, מנתח, מדעי
  { id: "I1", type: "I", text_he: "אני אוהב להבין למה דברים עובדים כמו שהם עובדים." },
  { id: "I2", type: "I", text_he: "מעניין אותי לחקור בעיות מורכבות ולנתח אותן לעומק." },
  { id: "I3", type: "I", text_he: "אני נהנה לקרוא חומר מדעי או טכני בזמני הפנוי." },
  { id: "I4", type: "I", text_he: "הייתי שמח לעבוד במחקר או במעבדה." },
  { id: "I5", type: "I", text_he: "כשאני נתקל בשאלה לא ברורה, אני אוהב לחפש תשובה לבד לפני שאני שואל." },

  // Artistic — יצירתי, מבטא, אומנותי
  { id: "A1", type: "A", text_he: "אני נהנה ליצור — לכתוב, לצייר, לצלם, להלחין או לעצב." },
  { id: "A2", type: "A", text_he: "חשוב לי לעבוד בסביבה שמאפשרת לי גמישות וביטוי אישי." },
  { id: "A3", type: "A", text_he: "מעניין אותי איך לעצב חוויה — מוצר, מרחב, סיפור." },
  { id: "A4", type: "A", text_he: "אני מעדיף עבודה פתוחה בלי הרבה כללים נוקשים." },
  { id: "A5", type: "A", text_he: "אומנות, מוזיקה או עיצוב הם חלק חשוב בחיים שלי." },

  // Social — אנשים, עזרה, חינוך
  { id: "S1", type: "S", text_he: "אני נהנה לעזור לאנשים אחרים להבין משהו או להתקדם." },
  { id: "S2", type: "S", text_he: "חשוב לי שעבודה שלי תועיל לאנשים בצורה ישירה." },
  { id: "S3", type: "S", text_he: "אני טוב בלהקשיב למה שמישהו עובר בלי לשפוט אותו." },
  { id: "S4", type: "S", text_he: "הייתי שמח לעבוד עם ילדים, נוער, או אוכלוסיות מיוחדות." },
  { id: "S5", type: "S", text_he: "אני נמשך לתפקידים שדורשים תקשורת בין-אישית עמוקה." },

  // Enterprising — שכנוע, יזמות, ניהול
  { id: "E1", type: "E", text_he: "אני נהנה לשכנע אנשים בעמדה שלי כשאני מאמין בה." },
  { id: "E2", type: "E", text_he: "מעניין אותי להוביל קבוצה ולקחת אחריות על המהלך." },
  { id: "E3", type: "E", text_he: "אני אוהב למכור — רעיון, מוצר, תוכנית, תועלת." },
  { id: "E4", type: "E", text_he: "הייתי שמח להקים עסק משלי בעתיד." },
  { id: "E5", type: "E", text_he: "אני מתחבר לסביבה תחרותית עם תוצאות מדידות." },

  // Conventional — סדר, נהלים, נתונים
  { id: "C1", type: "C", text_he: "אני מעדיף עבודה מסודרת עם נהלים ברורים." },
  { id: "C2", type: "C", text_he: "אני נהנה לעבוד עם נתונים, גיליונות, או מערכות מסודרות." },
  { id: "C3", type: "C", text_he: "חשוב לי שתוצרים יהיו מדויקים ובלי טעויות." },
  { id: "C4", type: "C", text_he: "אני מתפקד טוב במסגרות יציבות עם ציפיות ברורות." },
  { id: "C5", type: "C", text_he: "אני נהנה לעקוב אחרי תהליך מתחילתו ועד סופו ולוודא שהכל הושלם." },
];
```

> **Item-quality note for review before launch:** these are best-effort Hebrew items, paraphrased to capture each O\*NET RIASEC type without reproducing licensed test wording. Before public launch, they should be reviewed by a Hebrew-speaking psychologist for cultural fit and acquiescence balance. Gate this in Phase 7's launch checklist.

- [ ] **Step 3: Commit**

```powershell
git add lib/assessment/riasec/
git commit -m "feat(assessment): RIASEC items v1 and types"
```

---

## Task 3: RIASEC scoring (TDD)

**Files:**
- Create: `tests/unit/assessment/riasec-score.test.ts`
- Create: `lib/assessment/riasec/score.ts`

- [ ] **Step 1: Write failing test**

`tests/unit/assessment/riasec-score.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { scoreRiasec } from "@/lib/assessment/riasec/score";
import { RIASEC_ITEMS, RIASEC_ITEMS_VERSION } from "@/lib/assessment/riasec/items";

describe("scoreRiasec", () => {
  it("returns all-50 when every response is the midpoint (3)", () => {
    const responses = Object.fromEntries(RIASEC_ITEMS.map((i) => [i.id, 3]));
    const scores = scoreRiasec(responses, RIASEC_ITEMS_VERSION);
    expect(scores.R).toBe(50);
    expect(scores.I).toBe(50);
    expect(scores.A).toBe(50);
    expect(scores.S).toBe(50);
    expect(scores.E).toBe(50);
    expect(scores.C).toBe(50);
  });

  it("returns 100 for a type when all its items are 5", () => {
    const responses = Object.fromEntries(
      RIASEC_ITEMS.map((i) => [i.id, i.type === "I" ? 5 : 1]),
    );
    const scores = scoreRiasec(responses, RIASEC_ITEMS_VERSION);
    expect(scores.I).toBe(100);
    expect(scores.R).toBe(0);
  });

  it("computes Holland code from top 3 types", () => {
    // I=5, A=4, S=3, others=1
    const responses = Object.fromEntries(
      RIASEC_ITEMS.map((i) => {
        if (i.type === "I") return [i.id, 5];
        if (i.type === "A") return [i.id, 4];
        if (i.type === "S") return [i.id, 3];
        return [i.id, 1];
      }),
    );
    const scores = scoreRiasec(responses, RIASEC_ITEMS_VERSION);
    expect(scores.hollandCode).toBe("IAS");
  });

  it("throws on missing response", () => {
    const responses = Object.fromEntries(
      RIASEC_ITEMS.slice(0, 5).map((i) => [i.id, 3]),
    );
    expect(() => scoreRiasec(responses, RIASEC_ITEMS_VERSION)).toThrow(/missing/i);
  });

  it("throws on out-of-range response", () => {
    const responses = Object.fromEntries(RIASEC_ITEMS.map((i) => [i.id, 3]));
    responses["R1"] = 6;
    expect(() => scoreRiasec(responses, RIASEC_ITEMS_VERSION)).toThrow(/range/i);
  });

  it("throws on unsupported items_version", () => {
    const responses = Object.fromEntries(RIASEC_ITEMS.map((i) => [i.id, 3]));
    expect(() => scoreRiasec(responses, 999)).toThrow(/version/i);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```powershell
npm test -- riasec-score
```

Expected: FAIL with "Cannot find module '@/lib/assessment/riasec/score'".

- [ ] **Step 3: Implement scorer**

`lib/assessment/riasec/score.ts`:
```ts
import { RIASEC_ITEMS, RIASEC_ITEMS_VERSION } from "./items";
import type { RiasecResponses, RiasecScores, RiasecType } from "./types";
import { RIASEC_TYPES } from "./types";

export function scoreRiasec(
  responses: RiasecResponses,
  version: number,
): RiasecScores {
  if (version !== RIASEC_ITEMS_VERSION) {
    throw new Error(
      `Unsupported RIASEC items version: ${version} (current: ${RIASEC_ITEMS_VERSION})`,
    );
  }

  // Validate all items present and in range
  for (const item of RIASEC_ITEMS) {
    const r = responses[item.id];
    if (r === undefined) {
      throw new Error(`missing response for item ${item.id}`);
    }
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      throw new Error(`response for ${item.id} out of range: ${r}`);
    }
  }

  // Per-type sum and normalize to 0..100
  const perType: Record<RiasecType, { sum: number; count: number }> = {
    R: { sum: 0, count: 0 },
    I: { sum: 0, count: 0 },
    A: { sum: 0, count: 0 },
    S: { sum: 0, count: 0 },
    E: { sum: 0, count: 0 },
    C: { sum: 0, count: 0 },
  };

  for (const item of RIASEC_ITEMS) {
    perType[item.type].sum += responses[item.id];
    perType[item.type].count += 1;
  }

  const normalize = (sum: number, count: number) =>
    Math.round(((sum - count) / (count * 4)) * 100); // 1..5 → 0..1

  const partial = {
    R: normalize(perType.R.sum, perType.R.count),
    I: normalize(perType.I.sum, perType.I.count),
    A: normalize(perType.A.sum, perType.A.count),
    S: normalize(perType.S.sum, perType.S.count),
    E: normalize(perType.E.sum, perType.E.count),
    C: normalize(perType.C.sum, perType.C.count),
  };

  const hollandCode = [...RIASEC_TYPES]
    .sort((a, b) => partial[b] - partial[a])
    .slice(0, 3)
    .join("");

  return { ...partial, hollandCode };
}
```

- [ ] **Step 4: Run tests, expect pass**

```powershell
npm test -- riasec-score
```

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```powershell
git add tests/unit/assessment lib/assessment/riasec/score.ts
git commit -m "feat(assessment): RIASEC deterministic scorer with full unit tests"
```

---

## Task 4: Big5 items + types

**Files:**
- Create: `lib/assessment/big5/items.ts`
- Create: `lib/assessment/big5/types.ts`

- [ ] **Step 1: Define types**

`lib/assessment/big5/types.ts`:
```ts
export const BIG5_TRAITS = ["O", "C", "E", "A", "N"] as const;
export type Big5Trait = (typeof BIG5_TRAITS)[number];

export type Big5Item = {
  id: string;            // e.g. "O1", "N3"
  trait: Big5Trait;
  text_he: string;
  reverseKeyed: boolean; // if true, score is 6 - response
};

export type Big5Responses = Record<string, number>; // itemId → 1..5

export type Big5Scores = {
  O: number; C: number; E: number; A: number; N: number; // 0..100
};
```

- [ ] **Step 2: Write items file**

`lib/assessment/big5/items.ts`:
```ts
import type { Big5Item } from "./types";

export const BIG5_ITEMS_VERSION = 1;

// 4 items per trait (2 keyed + 2 reverse-keyed) — IPIP-NEO short form, Hebrew.
export const BIG5_ITEMS: Big5Item[] = [
  // Openness
  { id: "O1", trait: "O", reverseKeyed: false, text_he: "יש לי דמיון פעיל." },
  { id: "O2", trait: "O", reverseKeyed: false, text_he: "אני אוהב לחשוב על רעיונות מופשטים." },
  { id: "O3", trait: "O", reverseKeyed: true,  text_he: "אין לי עניין מיוחד באמנות." },
  { id: "O4", trait: "O", reverseKeyed: true,  text_he: "אני מעדיף שגרה על פני שינויים תכופים." },

  // Conscientiousness
  { id: "C1", trait: "C", reverseKeyed: false, text_he: "אני שם לב לפרטים קטנים." },
  { id: "C2", trait: "C", reverseKeyed: false, text_he: "אני מסיים מה שהתחלתי." },
  { id: "C3", trait: "C", reverseKeyed: true,  text_he: "לפעמים אני שוכח להחזיר דברים למקום." },
  { id: "C4", trait: "C", reverseKeyed: true,  text_he: "קשה לי להתחיל משימה ללא דחיפה מבחוץ." },

  // Extraversion
  { id: "E1", trait: "E", reverseKeyed: false, text_he: "אני נהנה להיות במרכז קבוצה." },
  { id: "E2", trait: "E", reverseKeyed: false, text_he: "אני פותח שיחה בקלות עם אנשים שלא הכרתי." },
  { id: "E3", trait: "E", reverseKeyed: true,  text_he: "אני מעדיף לבלות זמן לבד מאשר עם אנשים." },
  { id: "E4", trait: "E", reverseKeyed: true,  text_he: "במסיבות אני נוטה להישאר בצד." },

  // Agreeableness
  { id: "A1", trait: "A", reverseKeyed: false, text_he: "אני מתעניין במה שאחרים מרגישים." },
  { id: "A2", trait: "A", reverseKeyed: false, text_he: "אני נוטה לתת לאנשים את ההזדמנות השנייה." },
  { id: "A3", trait: "A", reverseKeyed: true,  text_he: "אני מתעצבן בקלות על אנשים." },
  { id: "A4", trait: "A", reverseKeyed: true,  text_he: "אני יכול להיות ישיר עד כדי קשיחות." },

  // Neuroticism
  { id: "N1", trait: "N", reverseKeyed: false, text_he: "אני נוטה לדאוג גם על דברים קטנים." },
  { id: "N2", trait: "N", reverseKeyed: false, text_he: "אני יכול להישאב לתחושות שליליות לאורך זמן." },
  { id: "N3", trait: "N", reverseKeyed: true,  text_he: "ברוב המקרים אני נשאר רגוע גם בלחץ." },
  { id: "N4", trait: "N", reverseKeyed: true,  text_he: "אני חוזר לעצמי מהר אחרי דברים שמכעיסים אותי." },
];
```

> **Item-quality note:** same as RIASEC — needs Hebrew-speaking psychologist review before public launch.

- [ ] **Step 3: Commit**

```powershell
git add lib/assessment/big5
git commit -m "feat(assessment): Big5 items v1 (IPIP-NEO short form, Hebrew) and types"
```

---

## Task 5: Big5 scoring (TDD)

**Files:**
- Create: `tests/unit/assessment/big5-score.test.ts`
- Create: `lib/assessment/big5/score.ts`

- [ ] **Step 1: Write failing test**

`tests/unit/assessment/big5-score.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { scoreBig5 } from "@/lib/assessment/big5/score";
import { BIG5_ITEMS, BIG5_ITEMS_VERSION } from "@/lib/assessment/big5/items";

describe("scoreBig5", () => {
  it("returns 50 for all traits when responses are midpoint", () => {
    const responses = Object.fromEntries(BIG5_ITEMS.map((i) => [i.id, 3]));
    const scores = scoreBig5(responses, BIG5_ITEMS_VERSION);
    expect(scores.O).toBe(50);
    expect(scores.C).toBe(50);
    expect(scores.E).toBe(50);
    expect(scores.A).toBe(50);
    expect(scores.N).toBe(50);
  });

  it("reverse-keyed items invert the response when scoring", () => {
    // For trait O: O1 (positive) = 5, O2 (positive) = 5, O3 (reverse) = 1, O4 (reverse) = 1
    // Effective: O1=5, O2=5, O3=6-1=5, O4=6-1=5 → mean=5 → 100
    const responses: Record<string, number> = {};
    for (const item of BIG5_ITEMS) {
      if (item.trait === "O") {
        responses[item.id] = item.reverseKeyed ? 1 : 5;
      } else {
        responses[item.id] = 3;
      }
    }
    const scores = scoreBig5(responses, BIG5_ITEMS_VERSION);
    expect(scores.O).toBe(100);
    expect(scores.C).toBe(50);
  });

  it("returns 0 for a trait when all effective responses are 1", () => {
    const responses: Record<string, number> = {};
    for (const item of BIG5_ITEMS) {
      if (item.trait === "N") {
        responses[item.id] = item.reverseKeyed ? 5 : 1;
      } else {
        responses[item.id] = 3;
      }
    }
    const scores = scoreBig5(responses, BIG5_ITEMS_VERSION);
    expect(scores.N).toBe(0);
  });

  it("throws on missing response", () => {
    const responses = Object.fromEntries(BIG5_ITEMS.slice(0, 5).map((i) => [i.id, 3]));
    expect(() => scoreBig5(responses, BIG5_ITEMS_VERSION)).toThrow(/missing/i);
  });

  it("throws on out-of-range response", () => {
    const responses = Object.fromEntries(BIG5_ITEMS.map((i) => [i.id, 3]));
    responses["O1"] = 0;
    expect(() => scoreBig5(responses, BIG5_ITEMS_VERSION)).toThrow(/range/i);
  });

  it("throws on unsupported items_version", () => {
    const responses = Object.fromEntries(BIG5_ITEMS.map((i) => [i.id, 3]));
    expect(() => scoreBig5(responses, 999)).toThrow(/version/i);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```powershell
npm test -- big5-score
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement scorer**

`lib/assessment/big5/score.ts`:
```ts
import { BIG5_ITEMS, BIG5_ITEMS_VERSION } from "./items";
import type { Big5Responses, Big5Scores, Big5Trait } from "./types";

export function scoreBig5(responses: Big5Responses, version: number): Big5Scores {
  if (version !== BIG5_ITEMS_VERSION) {
    throw new Error(
      `Unsupported Big5 items version: ${version} (current: ${BIG5_ITEMS_VERSION})`,
    );
  }

  for (const item of BIG5_ITEMS) {
    const r = responses[item.id];
    if (r === undefined) throw new Error(`missing response for item ${item.id}`);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      throw new Error(`response for ${item.id} out of range: ${r}`);
    }
  }

  const perTrait: Record<Big5Trait, { sum: number; count: number }> = {
    O: { sum: 0, count: 0 },
    C: { sum: 0, count: 0 },
    E: { sum: 0, count: 0 },
    A: { sum: 0, count: 0 },
    N: { sum: 0, count: 0 },
  };

  for (const item of BIG5_ITEMS) {
    const raw = responses[item.id];
    const effective = item.reverseKeyed ? 6 - raw : raw;
    perTrait[item.trait].sum += effective;
    perTrait[item.trait].count += 1;
  }

  const normalize = (sum: number, count: number) =>
    Math.round(((sum - count) / (count * 4)) * 100);

  return {
    O: normalize(perTrait.O.sum, perTrait.O.count),
    C: normalize(perTrait.C.sum, perTrait.C.count),
    E: normalize(perTrait.E.sum, perTrait.E.count),
    A: normalize(perTrait.A.sum, perTrait.A.count),
    N: normalize(perTrait.N.sum, perTrait.N.count),
  };
}
```

- [ ] **Step 4: Run tests, expect pass**

```powershell
npm test -- big5-score
```

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```powershell
git add tests/unit/assessment/big5-score.test.ts lib/assessment/big5/score.ts
git commit -m "feat(assessment): Big5 deterministic scorer with reverse-keyed items"
```

---

## Task 6: Values options + scoring

**Files:**
- Create: `lib/assessment/values/options.ts`
- Create: `lib/assessment/values/types.ts`
- Create: `tests/unit/assessment/values-score.test.ts`

- [ ] **Step 1: Define options + types**

`lib/assessment/values/types.ts`:
```ts
export type ValueOption = {
  id: string;
  label_he: string;
  description_he: string;
};

export type ValuesSubmission = {
  picked: string[];   // 5 ids
  ranked: string[];   // first 3 ids of `picked` in priority order
};

export type ValuesScores = {
  topThree: string[];          // ranked top-3 ids, ordered
  alsoPicked: string[];        // ids 4-5 from picked, unordered
};
```

`lib/assessment/values/options.ts`:
```ts
import type { ValueOption } from "./types";

export const VALUES_OPTIONS_VERSION = 1;

export const VALUES_OPTIONS: ValueOption[] = [
  { id: "money",       label_he: "כסף וביטחון כלכלי",      description_he: "הכנסה יציבה ויכולת לחסוך לטווח ארוך." },
  { id: "stability",   label_he: "יציבות בקריירה",         description_he: "תפקיד ברור, מסלול ידוע, מעט סיכון." },
  { id: "variety",     label_he: "גיוון ועניין",           description_he: "לא לחזור על אותו דבר כל יום." },
  { id: "impact",      label_he: "השפעה ומשמעות",          description_he: "להרגיש שהעבודה תורמת למשהו גדול ממני." },
  { id: "freedom",     label_he: "חופש ועצמאות",           description_he: "לקבוע איך ומתי לעבוד, פחות הוראות מלמעלה." },
  { id: "status",      label_he: "יוקרה וסטטוס",            description_he: "תפקיד שאחרים מעריכים, נראות מקצועית." },
  { id: "learning",    label_he: "למידה מתמדת",             description_he: "ללמוד דברים חדשים כל הזמן." },
  { id: "team",        label_he: "שייכות לצוות",            description_he: "אנשים שאני מתחבר אליהם, סביבה חברתית." },
  { id: "balance",     label_he: "איזון בית ועבודה",        description_he: "שליטה בלוח הזמנים, פחות לחץ של שעות נוספות." },
  { id: "creativity",  label_he: "יצירה והבעה אישית",       description_he: "להביא משהו משלי שלא קיים עדיין." },
  { id: "challenge",   label_he: "אתגר אינטלקטואלי",        description_he: "בעיות קשות, חידות, חשיבה לעומק." },
  { id: "service",     label_he: "תרומה לחברה",             description_he: "לעבוד מול אוכלוסיות שצריכות עזרה." },
];
```

- [ ] **Step 2: Write failing test**

`tests/unit/assessment/values-score.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { scoreValues, validateValuesSubmission } from "@/lib/assessment/values/score";
import { VALUES_OPTIONS, VALUES_OPTIONS_VERSION } from "@/lib/assessment/values/options";

describe("validateValuesSubmission", () => {
  it("accepts a valid submission", () => {
    expect(() =>
      validateValuesSubmission(
        {
          picked: ["money", "freedom", "learning", "team", "balance"],
          ranked: ["money", "freedom", "learning"],
        },
        VALUES_OPTIONS_VERSION,
      ),
    ).not.toThrow();
  });

  it("rejects when picked is not exactly 5", () => {
    expect(() =>
      validateValuesSubmission(
        { picked: ["money", "freedom"], ranked: ["money"] },
        VALUES_OPTIONS_VERSION,
      ),
    ).toThrow(/exactly 5/);
  });

  it("rejects when ranked is not exactly 3", () => {
    expect(() =>
      validateValuesSubmission(
        {
          picked: ["money", "freedom", "learning", "team", "balance"],
          ranked: ["money", "freedom"],
        },
        VALUES_OPTIONS_VERSION,
      ),
    ).toThrow(/exactly 3/);
  });

  it("rejects when ranked references unpicked id", () => {
    expect(() =>
      validateValuesSubmission(
        {
          picked: ["money", "freedom", "learning", "team", "balance"],
          ranked: ["money", "status", "learning"],
        },
        VALUES_OPTIONS_VERSION,
      ),
    ).toThrow(/must be subset/);
  });

  it("rejects unknown value id", () => {
    expect(() =>
      validateValuesSubmission(
        {
          picked: ["money", "freedom", "learning", "team", "nonsense"],
          ranked: ["money", "freedom", "learning"],
        },
        VALUES_OPTIONS_VERSION,
      ),
    ).toThrow(/unknown/);
  });
});

describe("scoreValues", () => {
  it("returns topThree (ranked) and alsoPicked (the rest)", () => {
    const submission = {
      picked: ["money", "freedom", "learning", "team", "balance"],
      ranked: ["learning", "money", "team"],
    };
    const scores = scoreValues(submission, VALUES_OPTIONS_VERSION);
    expect(scores.topThree).toEqual(["learning", "money", "team"]);
    expect(scores.alsoPicked.sort()).toEqual(["balance", "freedom"].sort());
  });
});
```

- [ ] **Step 3: Run test, expect fail**

```powershell
npm test -- values-score
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement validator + scorer**

`lib/assessment/values/score.ts`:
```ts
import { VALUES_OPTIONS, VALUES_OPTIONS_VERSION } from "./options";
import type { ValuesSubmission, ValuesScores } from "./types";

export function validateValuesSubmission(
  submission: ValuesSubmission,
  version: number,
): void {
  if (version !== VALUES_OPTIONS_VERSION) {
    throw new Error(
      `Unsupported values version: ${version} (current: ${VALUES_OPTIONS_VERSION})`,
    );
  }

  const validIds = new Set(VALUES_OPTIONS.map((o) => o.id));
  const { picked, ranked } = submission;

  if (picked.length !== 5) {
    throw new Error(`picked must be exactly 5 items, got ${picked.length}`);
  }
  if (new Set(picked).size !== 5) {
    throw new Error("picked has duplicates");
  }
  for (const id of picked) {
    if (!validIds.has(id)) throw new Error(`unknown value id: ${id}`);
  }

  if (ranked.length !== 3) {
    throw new Error(`ranked must be exactly 3 items, got ${ranked.length}`);
  }
  if (new Set(ranked).size !== 3) {
    throw new Error("ranked has duplicates");
  }
  const pickedSet = new Set(picked);
  for (const id of ranked) {
    if (!pickedSet.has(id)) throw new Error(`ranked must be subset of picked: ${id}`);
  }
}

export function scoreValues(submission: ValuesSubmission, version: number): ValuesScores {
  validateValuesSubmission(submission, version);
  const rankedSet = new Set(submission.ranked);
  return {
    topThree: [...submission.ranked],
    alsoPicked: submission.picked.filter((id) => !rankedSet.has(id)),
  };
}
```

- [ ] **Step 5: Run tests, expect pass**

```powershell
npm test -- values-score
```

Expected: PASS, 6/6.

- [ ] **Step 6: Commit**

```powershell
git add lib/assessment/values tests/unit/assessment/values-score.test.ts
git commit -m "feat(assessment): values pick-then-rank with validation"
```

---

## Task 7: Constraints schema

**Files:**
- Create: `lib/assessment/constraints/schema.ts`
- Create: `tests/unit/assessment/constraints-schema.test.ts`

- [ ] **Step 1: Write failing test**

`tests/unit/assessment/constraints-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ConstraintsSchema, CONSTRAINTS_VERSION } from "@/lib/assessment/constraints/schema";

describe("ConstraintsSchema", () => {
  it("accepts a minimal valid submission with only required fields", () => {
    const result = ConstraintsSchema.safeParse({
      location_he: "מרכז",
      time_per_week_hours: 10,
      training_budget_nis: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated submission", () => {
    const result = ConstraintsSchema.safeParse({
      location_he: "צפון",
      remote_ok: true,
      time_per_week_hours: 20,
      training_budget_nis: 5000,
      english_level: "intermediate",
      risk_tolerance: 7,
      needs_immediate_income: false,
      months_until_income_required: 6,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative budget", () => {
    const result = ConstraintsSchema.safeParse({
      location_he: "מרכז",
      time_per_week_hours: 10,
      training_budget_nis: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects time_per_week_hours > 60", () => {
    const result = ConstraintsSchema.safeParse({
      location_he: "מרכז",
      time_per_week_hours: 80,
      training_budget_nis: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects risk_tolerance outside 1..10", () => {
    const result = ConstraintsSchema.safeParse({
      location_he: "מרכז",
      time_per_week_hours: 10,
      training_budget_nis: 0,
      risk_tolerance: 11,
    });
    expect(result.success).toBe(false);
  });

  it("exports a schema version constant", () => {
    expect(typeof CONSTRAINTS_VERSION).toBe("number");
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```powershell
npm test -- constraints-schema
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement schema**

`lib/assessment/constraints/schema.ts`:
```ts
import { z } from "zod";

export const CONSTRAINTS_VERSION = 1;

export const ENGLISH_LEVELS = ["none", "basic", "intermediate", "advanced", "fluent"] as const;

export const ConstraintsSchema = z.object({
  location_he: z.string().min(1).max(40),
  remote_ok: z.boolean().optional(),
  time_per_week_hours: z.number().int().min(0).max(60),
  training_budget_nis: z.number().int().min(0).max(200_000),
  english_level: z.enum(ENGLISH_LEVELS).optional(),
  risk_tolerance: z.number().int().min(1).max(10).optional(),
  needs_immediate_income: z.boolean().optional(),
  months_until_income_required: z.number().int().min(0).max(60).optional(),
});

export type ConstraintsSubmission = z.infer<typeof ConstraintsSchema>;
```

- [ ] **Step 4: Run tests, expect pass**

```powershell
npm test -- constraints-schema
```

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```powershell
git add lib/assessment/constraints tests/unit/assessment/constraints-schema.test.ts
git commit -m "feat(assessment): constraints zod schema with field bounds"
```

---

## Task 8: i18n strings for assessments

**Files:**
- Modify: `lib/i18n/he.ts`

- [ ] **Step 1: Add `assessment` section to `he.ts`**

Add the following property inside the `he` const, after the `safety` block:

```ts
  assessment: {
    hub: {
      title: "שאלונים פורמליים",
      subtitle: "ארבעה שאלונים קצרים שיחדדו את ההמלצות שלך. אפשר לעשות רק חלק או את כולם.",
      cardLabels: {
        riasec: "תחומי עניין",
        big5: "אופי ואישיות",
        values: "ערכים",
        constraints: "אילוצים",
      },
      status: {
        notStarted: "טרם התחלת",
        inProgress: "באמצע",
        completed: "הושלם",
      },
    },
    common: {
      next: "המשך",
      back: "חזור",
      submit: "סיים שאלון",
      submitting: "שומר…",
      submitted: "נשמר. תודה!",
      error: "אירעה שגיאה. ננסה שוב?",
      progress: "{current} מתוך {total}",
    },
    likert: {
      "1": "ממש לא",
      "2": "לא כל כך",
      "3": "ככה ככה",
      "4": "די כן",
      "5": "ממש כן",
    },
    riasec: {
      title: "תחומי עניין",
      intro: "ל-30 משפטים הבאים, ענה עד כמה זה מרגיש כמוך. אין תשובה נכונה.",
    },
    big5: {
      title: "סגנון אישי",
      intro: "20 משפטים על האופי והגישה שלך. בלי 'מבחן אישיות' מסחרי — רק שאלון פתוח שמלמד אותנו עליך.",
    },
    values: {
      title: "מה הכי חשוב לך בעבודה",
      pickInstruction: "בחר 5 ערכים שהכי חשובים לך:",
      rankInstruction: "סדר את 3 הערכים החשובים ביותר לפי סדר חשיבות:",
      mustPickFive: "צריך לבחור בדיוק 5",
      mustRankThree: "צריך לדרג בדיוק 3",
    },
    constraints: {
      title: "מה ריאלי בשבילך",
      intro: "כמה שאלות מעשיות. כל שדה חוץ מאזור, זמן ותקציב — אופציונלי.",
      fields: {
        location_he: "אזור גאוגרפי בארץ",
        remote_ok: "מוכן לעבודה מרחוק",
        time_per_week_hours: "כמה שעות בשבוע אתה יכול להקדיש ללימודים נוספים?",
        training_budget_nis: "תקציב להכשרה / לימודים (בשקלים)",
        english_level: "רמת אנגלית",
        risk_tolerance: "נכונות לקחת סיכון מקצועי (1=נמוך, 10=גבוה)",
        needs_immediate_income: "צריך הכנסה מהיום הראשון",
        months_until_income_required: "תוך כמה חודשים אתה חייב להתחיל להרוויח",
      },
      englishLevels: {
        none: "אין",
        basic: "בסיסית",
        intermediate: "טובה",
        advanced: "מתקדמת",
        fluent: "שוטפת",
      },
    },
  },
```

- [ ] **Step 2: Verify TS compile**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add lib/i18n/he.ts
git commit -m "feat(i18n): assessment Hebrew strings (hub, likert, per-test labels)"
```

---

## Task 9: DB layer for assessments

**Files:**
- Create: `lib/db/assessments.ts`

- [ ] **Step 1: Write the file**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types.gen";

type AssessmentType = Database["public"]["Enums"]["assessment_type"];

export type AssessmentStatus = "not_started" | "completed";

export type AssessmentStatusMap = Record<AssessmentType, AssessmentStatus>;

export async function saveAssessment(
  supabase: SupabaseClient<Database>,
  args: {
    userId: string;
    type: AssessmentType;
    responses: unknown;
    scores: unknown;
    itemsVersion: number;
  },
): Promise<{ id: string; takenAt: string }> {
  const { data, error } = await supabase
    .from("assessments")
    .insert({
      user_id: args.userId,
      type: args.type,
      responses: args.responses as never,
      scores: args.scores as never,
      items_version: args.itemsVersion,
    })
    .select("id, taken_at")
    .single();
  if (error) throw error;
  return { id: data.id, takenAt: data.taken_at };
}

export async function getLatestByType(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Record<AssessmentType, { scores: unknown; takenAt: string; itemsVersion: number } | null>> {
  const { data, error } = await supabase
    .from("assessments")
    .select("type, scores, taken_at, items_version")
    .eq("user_id", userId)
    .order("taken_at", { ascending: false });
  if (error) throw error;

  const result: Record<string, { scores: unknown; takenAt: string; itemsVersion: number } | null> = {
    riasec: null, big5: null, values: null, constraints: null,
  };
  for (const row of data ?? []) {
    if (result[row.type] == null) {
      result[row.type] = {
        scores: row.scores,
        takenAt: row.taken_at,
        itemsVersion: row.items_version,
      };
    }
  }
  return result as Record<AssessmentType, { scores: unknown; takenAt: string; itemsVersion: number } | null>;
}

export async function getStatus(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<AssessmentStatusMap> {
  const latest = await getLatestByType(supabase, userId);
  return {
    riasec: latest.riasec ? "completed" : "not_started",
    big5: latest.big5 ? "completed" : "not_started",
    values: latest.values ? "completed" : "not_started",
    constraints: latest.constraints ? "completed" : "not_started",
  };
}
```

- [ ] **Step 2: Verify TS compile**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add lib/db/assessments.ts
git commit -m "feat(db): assessments queries — save, getLatestByType, getStatus"
```

---

## Task 10: API route — submit

**Files:**
- Create: `app/api/assessment/submit/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { saveAssessment } from "@/lib/db/assessments";
import { scoreRiasec } from "@/lib/assessment/riasec/score";
import { RIASEC_ITEMS_VERSION, RIASEC_ITEMS } from "@/lib/assessment/riasec/items";
import { scoreBig5 } from "@/lib/assessment/big5/score";
import { BIG5_ITEMS_VERSION, BIG5_ITEMS } from "@/lib/assessment/big5/items";
import { scoreValues } from "@/lib/assessment/values/score";
import { VALUES_OPTIONS_VERSION } from "@/lib/assessment/values/options";
import { ConstraintsSchema, CONSTRAINTS_VERSION } from "@/lib/assessment/constraints/schema";

export const runtime = "nodejs";

const LikertResponses = z.record(z.string(), z.number().int().min(1).max(5));

const SubmitSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("riasec"), responses: LikertResponses }),
  z.object({ type: z.literal("big5"), responses: LikertResponses }),
  z.object({
    type: z.literal("values"),
    responses: z.object({
      picked: z.array(z.string()).length(5),
      ranked: z.array(z.string()).length(3),
    }),
  }),
  z.object({ type: z.literal("constraints"), responses: ConstraintsSchema }),
]);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = SubmitSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);

  try {
    const submission = parsed.data;
    let scores: unknown;
    let itemsVersion: number;

    switch (submission.type) {
      case "riasec": {
        // Verify all RIASEC item ids present
        const expected = new Set(RIASEC_ITEMS.map((i) => i.id));
        const got = new Set(Object.keys(submission.responses));
        if (got.size !== expected.size || ![...expected].every((id) => got.has(id))) {
          return Response.json({ error: "incomplete_riasec" }, { status: 400 });
        }
        scores = scoreRiasec(submission.responses, RIASEC_ITEMS_VERSION);
        itemsVersion = RIASEC_ITEMS_VERSION;
        break;
      }
      case "big5": {
        const expected = new Set(BIG5_ITEMS.map((i) => i.id));
        const got = new Set(Object.keys(submission.responses));
        if (got.size !== expected.size || ![...expected].every((id) => got.has(id))) {
          return Response.json({ error: "incomplete_big5" }, { status: 400 });
        }
        scores = scoreBig5(submission.responses, BIG5_ITEMS_VERSION);
        itemsVersion = BIG5_ITEMS_VERSION;
        break;
      }
      case "values": {
        scores = scoreValues(submission.responses, VALUES_OPTIONS_VERSION);
        itemsVersion = VALUES_OPTIONS_VERSION;
        break;
      }
      case "constraints": {
        scores = submission.responses; // no derived score; the form IS the score
        itemsVersion = CONSTRAINTS_VERSION;
        break;
      }
    }

    const saved = await saveAssessment(supabase, {
      userId: internalUserId,
      type: submission.type,
      responses: submission.responses,
      scores,
      itemsVersion,
    });

    return Response.json({ id: saved.id, takenAt: saved.takenAt, scores });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "scoring_failed", message }, { status: 400 });
  }
}
```

- [ ] **Step 2: Verify TS compile**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add app/api/assessment/submit/route.ts
git commit -m "feat(api): unified /api/assessment/submit endpoint with discriminated union"
```

---

## Task 11: API route — status

**Files:**
- Create: `app/api/assessment/status/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getStatus } from "@/lib/db/assessments";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);
  const status = await getStatus(supabase, internalUserId);
  return Response.json(status);
}
```

- [ ] **Step 2: Commit**

```powershell
git add app/api/assessment/status/route.ts
git commit -m "feat(api): /api/assessment/status returns per-type completion state"
```

---

## Task 12: Shared assessment UI primitives

**Files:**
- Create: `components/assessment/AssessmentLayout.tsx`
- Create: `components/assessment/LikertRow.tsx`
- Create: `components/assessment/ProgressIndicator.tsx`

- [ ] **Step 1: Write `AssessmentLayout`**

`components/assessment/AssessmentLayout.tsx`:
```tsx
import type { ReactNode } from "react";
import Link from "next/link";

export function AssessmentLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-8">
      <Link href="/assessment" className="text-sm text-muted-foreground hover:underline">
        ← חזרה לרשימת השאלונים
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-base text-muted-foreground" dir="auto">{intro}</p>
      </header>
      <main className="flex flex-col gap-4">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Write `LikertRow`**

`components/assessment/LikertRow.tsx`:
```tsx
"use client";
import { he } from "@/lib/i18n/he";

export function LikertRow({
  itemId,
  text,
  value,
  onChange,
}: {
  itemId: string;
  text: string;
  value: number | undefined;
  onChange: (next: number) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <p className="mb-3 text-base" dir="auto">{text}</p>
      <div className="flex items-center justify-between gap-2">
        {[1, 2, 3, 4, 5].map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={selected}
              aria-label={he.assessment.likert[String(n) as "1"|"2"|"3"|"4"|"5"]}
              onClick={() => onChange(n)}
              className={`flex h-11 min-w-11 flex-1 items-center justify-center rounded-md border text-sm transition-colors ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{he.assessment.likert["1"]}</span>
        <span>{he.assessment.likert["5"]}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `ProgressIndicator`**

`components/assessment/ProgressIndicator.tsx`:
```tsx
import { he } from "@/lib/i18n/he";

export function ProgressIndicator({ current, total }: { current: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((current / total) * 100);
  const label = he.assessment.common.progress
    .replace("{current}", String(current))
    .replace("{total}", String(total));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```powershell
git add components/assessment/AssessmentLayout.tsx components/assessment/LikertRow.tsx components/assessment/ProgressIndicator.tsx
git commit -m "feat(ui): shared assessment layout, likert row, progress indicator"
```

---

## Task 13: RIASEC quiz UI

**Files:**
- Create: `components/assessment/RIASECQuiz.tsx`
- Create: `app/(app)/assessment/riasec/page.tsx`

- [ ] **Step 1: Write quiz component**

`components/assessment/RIASECQuiz.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RIASEC_ITEMS } from "@/lib/assessment/riasec/items";
import { LikertRow } from "./LikertRow";
import { ProgressIndicator } from "./ProgressIndicator";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/i18n/he";
import { toast } from "sonner";

export function RIASECQuiz() {
  const router = useRouter();
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const total = RIASEC_ITEMS.length;
  const answered = Object.keys(responses).length;
  const allAnswered = answered === total;

  const onSubmit = async () => {
    if (!allAnswered) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "riasec", responses }),
      });
      if (!res.ok) {
        toast.error(he.assessment.common.error);
        setSubmitting(false);
        return;
      }
      toast.success(he.assessment.common.submitted);
      router.push("/assessment");
    } catch {
      toast.error(he.assessment.common.error);
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 border-b bg-background/80 px-4 py-3 backdrop-blur">
        <ProgressIndicator current={answered} total={total} />
      </div>
      {RIASEC_ITEMS.map((item) => (
        <LikertRow
          key={item.id}
          itemId={item.id}
          text={item.text_he}
          value={responses[item.id]}
          onChange={(n) => setResponses((prev) => ({ ...prev, [item.id]: n }))}
        />
      ))}
      <Button
        type="button"
        size="lg"
        disabled={!allAnswered || submitting}
        onClick={onSubmit}
        className="self-stretch"
      >
        {submitting ? he.assessment.common.submitting : he.assessment.common.submit}
      </Button>
    </>
  );
}
```

- [ ] **Step 2: Write page**

`app/(app)/assessment/riasec/page.tsx`:
```tsx
import { AssessmentLayout } from "@/components/assessment/AssessmentLayout";
import { RIASECQuiz } from "@/components/assessment/RIASECQuiz";
import { he } from "@/lib/i18n/he";

export const dynamic = "force-dynamic";

export default function RiasecPage() {
  return (
    <AssessmentLayout title={he.assessment.riasec.title} intro={he.assessment.riasec.intro}>
      <RIASECQuiz />
    </AssessmentLayout>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
git add components/assessment/RIASECQuiz.tsx "app/(app)/assessment/riasec"
git commit -m "feat(ui): RIASEC quiz with Likert rows and submit"
```

---

## Task 14: Big5 quiz UI

**Files:**
- Create: `components/assessment/Big5Quiz.tsx`
- Create: `app/(app)/assessment/big5/page.tsx`

- [ ] **Step 1: Write component**

`components/assessment/Big5Quiz.tsx` — structurally identical to `RIASECQuiz.tsx`, but imports `BIG5_ITEMS` and submits `type: "big5"`. Copy `RIASECQuiz.tsx`, search-replace `RIASEC` → `BIG5`, `riasec` → `big5`, swap import paths.

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BIG5_ITEMS } from "@/lib/assessment/big5/items";
import { LikertRow } from "./LikertRow";
import { ProgressIndicator } from "./ProgressIndicator";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/i18n/he";
import { toast } from "sonner";

export function Big5Quiz() {
  const router = useRouter();
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const total = BIG5_ITEMS.length;
  const answered = Object.keys(responses).length;
  const allAnswered = answered === total;

  const onSubmit = async () => {
    if (!allAnswered) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "big5", responses }),
      });
      if (!res.ok) {
        toast.error(he.assessment.common.error);
        setSubmitting(false);
        return;
      }
      toast.success(he.assessment.common.submitted);
      router.push("/assessment");
    } catch {
      toast.error(he.assessment.common.error);
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 border-b bg-background/80 px-4 py-3 backdrop-blur">
        <ProgressIndicator current={answered} total={total} />
      </div>
      {BIG5_ITEMS.map((item) => (
        <LikertRow
          key={item.id}
          itemId={item.id}
          text={item.text_he}
          value={responses[item.id]}
          onChange={(n) => setResponses((prev) => ({ ...prev, [item.id]: n }))}
        />
      ))}
      <Button type="button" size="lg" disabled={!allAnswered || submitting} onClick={onSubmit}>
        {submitting ? he.assessment.common.submitting : he.assessment.common.submit}
      </Button>
    </>
  );
}
```

- [ ] **Step 2: Write page**

`app/(app)/assessment/big5/page.tsx`:
```tsx
import { AssessmentLayout } from "@/components/assessment/AssessmentLayout";
import { Big5Quiz } from "@/components/assessment/Big5Quiz";
import { he } from "@/lib/i18n/he";

export const dynamic = "force-dynamic";

export default function Big5Page() {
  return (
    <AssessmentLayout title={he.assessment.big5.title} intro={he.assessment.big5.intro}>
      <Big5Quiz />
    </AssessmentLayout>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
git add components/assessment/Big5Quiz.tsx "app/(app)/assessment/big5"
git commit -m "feat(ui): Big5 quiz page"
```

---

## Task 15: Values picker UI

**Files:**
- Create: `components/assessment/ValuesPicker.tsx`
- Create: `app/(app)/assessment/values/page.tsx`

- [ ] **Step 1: Write component**

`components/assessment/ValuesPicker.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { VALUES_OPTIONS } from "@/lib/assessment/values/options";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/i18n/he";
import { toast } from "sonner";

const PICK_TARGET = 5;
const RANK_TARGET = 3;

export function ValuesPicker() {
  const router = useRouter();
  const [step, setStep] = useState<"pick" | "rank">("pick");
  const [picked, setPicked] = useState<string[]>([]);
  const [ranked, setRanked] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const togglePick = (id: string) => {
    setPicked((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < PICK_TARGET
        ? [...prev, id]
        : prev,
    );
  };

  const toggleRank = (id: string) => {
    setRanked((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < RANK_TARGET
        ? [...prev, id]
        : prev,
    );
  };

  const goToRank = () => {
    if (picked.length !== PICK_TARGET) {
      toast.error(he.assessment.values.mustPickFive);
      return;
    }
    setStep("rank");
  };

  const onSubmit = async () => {
    if (ranked.length !== RANK_TARGET) {
      toast.error(he.assessment.values.mustRankThree);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "values", responses: { picked, ranked } }),
      });
      if (!res.ok) {
        toast.error(he.assessment.common.error);
        setSubmitting(false);
        return;
      }
      toast.success(he.assessment.common.submitted);
      router.push("/assessment");
    } catch {
      toast.error(he.assessment.common.error);
      setSubmitting(false);
    }
  };

  if (step === "pick") {
    return (
      <>
        <p className="text-base">{he.assessment.values.pickInstruction} ({picked.length}/{PICK_TARGET})</p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {VALUES_OPTIONS.map((opt) => {
            const selected = picked.includes(opt.id);
            return (
              <li key={opt.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => togglePick(opt.id)}
                  className={`min-h-11 w-full rounded-lg border p-3 text-start transition-colors ${
                    selected ? "border-primary bg-primary/5" : "border-input hover:bg-accent"
                  }`}
                >
                  <div className="font-medium">{opt.label_he}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{opt.description_he}</div>
                </button>
              </li>
            );
          })}
        </ul>
        <Button onClick={goToRank} disabled={picked.length !== PICK_TARGET} size="lg">
          {he.assessment.common.next}
        </Button>
      </>
    );
  }

  // rank step
  const pickedOptions = picked
    .map((id) => VALUES_OPTIONS.find((o) => o.id === id))
    .filter((o): o is NonNullable<typeof o> => o != null);

  return (
    <>
      <p className="text-base">{he.assessment.values.rankInstruction} ({ranked.length}/{RANK_TARGET})</p>
      <ol className="space-y-3">
        {pickedOptions.map((opt) => {
          const rankIndex = ranked.indexOf(opt.id);
          const selected = rankIndex >= 0;
          return (
            <li key={opt.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => toggleRank(opt.id)}
                className={`flex min-h-11 w-full items-center justify-between rounded-lg border p-3 transition-colors ${
                  selected ? "border-primary bg-primary/5" : "border-input hover:bg-accent"
                }`}
              >
                <span className="font-medium">{opt.label_he}</span>
                {selected && (
                  <span className="ms-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">
                    {rankIndex + 1}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep("pick")}>
          {he.assessment.common.back}
        </Button>
        <Button onClick={onSubmit} disabled={ranked.length !== RANK_TARGET || submitting} size="lg" className="flex-1">
          {submitting ? he.assessment.common.submitting : he.assessment.common.submit}
        </Button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Write page**

`app/(app)/assessment/values/page.tsx`:
```tsx
import { AssessmentLayout } from "@/components/assessment/AssessmentLayout";
import { ValuesPicker } from "@/components/assessment/ValuesPicker";
import { he } from "@/lib/i18n/he";

export const dynamic = "force-dynamic";

export default function ValuesPage() {
  return (
    <AssessmentLayout
      title={he.assessment.values.title}
      intro="בחר את 5 הערכים שהכי חשובים לך, ואז דרג את 3 העליונים."
    >
      <ValuesPicker />
    </AssessmentLayout>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
git add components/assessment/ValuesPicker.tsx "app/(app)/assessment/values"
git commit -m "feat(ui): values pick-then-rank picker"
```

---

## Task 16: Constraints form UI

**Files:**
- Create: `components/assessment/ConstraintsForm.tsx`
- Create: `app/(app)/assessment/constraints/page.tsx`

- [ ] **Step 1: Write component**

`components/assessment/ConstraintsForm.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { he } from "@/lib/i18n/he";
import { ConstraintsSchema, ENGLISH_LEVELS } from "@/lib/assessment/constraints/schema";
import { toast } from "sonner";

const initialState = {
  location_he: "",
  remote_ok: false,
  time_per_week_hours: "",
  training_budget_nis: "",
  english_level: "",
  risk_tolerance: "5",
  needs_immediate_income: false,
  months_until_income_required: "",
};

export function ConstraintsForm() {
  const router = useRouter();
  const [form, setForm] = useState(initialState);
  const [submitting, setSubmitting] = useState(false);
  const labels = he.assessment.constraints.fields;
  const englishLabels = he.assessment.constraints.englishLevels;

  const setField = <K extends keyof typeof initialState>(key: K, value: (typeof initialState)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const payload = ConstraintsSchema.safeParse({
      location_he: form.location_he,
      remote_ok: form.remote_ok,
      time_per_week_hours: form.time_per_week_hours === "" ? undefined : Number(form.time_per_week_hours),
      training_budget_nis: form.training_budget_nis === "" ? undefined : Number(form.training_budget_nis),
      english_level: form.english_level || undefined,
      risk_tolerance: form.risk_tolerance ? Number(form.risk_tolerance) : undefined,
      needs_immediate_income: form.needs_immediate_income,
      months_until_income_required:
        form.months_until_income_required === "" ? undefined : Number(form.months_until_income_required),
    });
    if (!payload.success) {
      toast.error(he.assessment.common.error);
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "constraints", responses: payload.data }),
      });
      if (!res.ok) {
        toast.error(he.assessment.common.error);
        setSubmitting(false);
        return;
      }
      toast.success(he.assessment.common.submitted);
      router.push("/assessment");
    } catch {
      toast.error(he.assessment.common.error);
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={labels.location_he}>
        <Input
          required
          value={form.location_he}
          onChange={(e) => setField("location_he", e.target.value)}
          placeholder="מרכז / צפון / דרום / שרון / ירושלים …"
        />
      </Field>

      <CheckboxField
        label={labels.remote_ok}
        checked={form.remote_ok}
        onChange={(v) => setField("remote_ok", v)}
      />

      <Field label={labels.time_per_week_hours}>
        <Input
          required
          type="number"
          inputMode="numeric"
          min={0}
          max={60}
          dir="ltr"
          value={form.time_per_week_hours}
          onChange={(e) => setField("time_per_week_hours", e.target.value)}
        />
      </Field>

      <Field label={labels.training_budget_nis}>
        <Input
          required
          type="number"
          inputMode="numeric"
          min={0}
          max={200_000}
          dir="ltr"
          value={form.training_budget_nis}
          onChange={(e) => setField("training_budget_nis", e.target.value)}
        />
      </Field>

      <Field label={labels.english_level}>
        <select
          value={form.english_level}
          onChange={(e) => setField("english_level", e.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">—</option>
          {ENGLISH_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>{englishLabels[lvl]}</option>
          ))}
        </select>
      </Field>

      <Field label={labels.risk_tolerance}>
        <input
          type="range"
          min={1}
          max={10}
          value={form.risk_tolerance}
          onChange={(e) => setField("risk_tolerance", e.target.value)}
          className="w-full"
        />
        <div className="text-sm text-muted-foreground">{form.risk_tolerance}/10</div>
      </Field>

      <CheckboxField
        label={labels.needs_immediate_income}
        checked={form.needs_immediate_income}
        onChange={(v) => setField("needs_immediate_income", v)}
      />

      {form.needs_immediate_income && (
        <Field label={labels.months_until_income_required}>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={60}
            dir="ltr"
            value={form.months_until_income_required}
            onChange={(e) => setField("months_until_income_required", e.target.value)}
          />
        </Field>
      )}

      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? he.assessment.common.submitting : he.assessment.common.submit}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input"
      />
      <span>{label}</span>
    </label>
  );
}
```

- [ ] **Step 2: Write page**

`app/(app)/assessment/constraints/page.tsx`:
```tsx
import { AssessmentLayout } from "@/components/assessment/AssessmentLayout";
import { ConstraintsForm } from "@/components/assessment/ConstraintsForm";
import { he } from "@/lib/i18n/he";

export const dynamic = "force-dynamic";

export default function ConstraintsPage() {
  return (
    <AssessmentLayout
      title={he.assessment.constraints.title}
      intro={he.assessment.constraints.intro}
    >
      <ConstraintsForm />
    </AssessmentLayout>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
git add components/assessment/ConstraintsForm.tsx "app/(app)/assessment/constraints"
git commit -m "feat(ui): constraints form with conditional months-until-income field"
```

---

## Task 17: Assessment hub page

**Files:**
- Create: `components/assessment/AssessmentHub.tsx`
- Create: `app/(app)/assessment/page.tsx`

- [ ] **Step 1: Write hub component**

`components/assessment/AssessmentHub.tsx`:
```tsx
import Link from "next/link";
import { he } from "@/lib/i18n/he";
import type { AssessmentStatusMap } from "@/lib/db/assessments";

const TYPES = [
  { type: "riasec",      href: "/assessment/riasec",      blurb: "30 משפטים על תחומי עניין" },
  { type: "big5",        href: "/assessment/big5",        blurb: "20 משפטים על אופי" },
  { type: "values",      href: "/assessment/values",      blurb: "מה הכי חשוב לך" },
  { type: "constraints", href: "/assessment/constraints", blurb: "אילוצים מעשיים" },
] as const;

export function AssessmentHub({ status }: { status: AssessmentStatusMap }) {
  const labels = he.assessment.hub.cardLabels;
  const statusLabels = he.assessment.hub.status;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{he.assessment.hub.title}</h1>
        <p className="text-base text-muted-foreground">{he.assessment.hub.subtitle}</p>
      </header>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TYPES.map(({ type, href, blurb }) => {
          const done = status[type] === "completed";
          return (
            <li key={type}>
              <Link
                href={href}
                className="flex h-full flex-col justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
              >
                <div>
                  <div className="text-base font-medium">{labels[type]}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{blurb}</div>
                </div>
                <div
                  className={`mt-3 inline-flex w-fit rounded-full px-2 py-0.5 text-xs ${
                    done ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? statusLabels.completed : statusLabels.notStarted}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Write page (server component fetches status)**

`app/(app)/assessment/page.tsx`:
```tsx
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getStatus } from "@/lib/db/assessments";
import { AssessmentHub } from "@/components/assessment/AssessmentHub";

export const dynamic = "force-dynamic";

export default async function AssessmentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);
  const status = await getStatus(supabase, internalUserId);
  return <AssessmentHub status={status} />;
}
```

- [ ] **Step 3: Commit**

```powershell
git add components/assessment/AssessmentHub.tsx "app/(app)/assessment/page.tsx"
git commit -m "feat(ui): assessment hub with per-type completion status"
```

---

## Task 18: Wire latest assessments into `getProfile`

**Files:**
- Modify: `lib/db/profile.ts`

- [ ] **Step 1: Read current `getProfile`**

```powershell
type lib\db\profile.ts
```

Note its current return shape.

- [ ] **Step 2: Extend it**

Add a `formal` key to the returned profile that contains the latest assessment scores per type. Example shape:

```ts
export type CareerProfile = {
  // ... existing fields ...
  formal: {
    riasec: { scores: unknown; takenAt: string; itemsVersion: number } | null;
    big5:   { scores: unknown; takenAt: string; itemsVersion: number } | null;
    values: { scores: unknown; takenAt: string; itemsVersion: number } | null;
    constraints: { scores: unknown; takenAt: string; itemsVersion: number } | null;
  };
};
```

In the implementation, after the existing `career_profile` fetch, call `getLatestByType(supabase, userId)` from `@/lib/db/assessments` and set `profile.formal = latest`.

- [ ] **Step 3: Verify TS compile**

```powershell
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```powershell
git add lib/db/profile.ts
git commit -m "feat(profile): include latest assessment scores per type in getProfile"
```

---

## Task 19: Integration test — submit + read-back

**Files:**
- Create: `tests/integration/assessment-submit.test.ts`

- [ ] **Step 1: Write test**

`tests/integration/assessment-submit.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { POST as submitPost } from "@/app/api/assessment/submit/route";
import { RIASEC_ITEMS } from "@/lib/assessment/riasec/items";

function fakeRequest(body: unknown): Request {
  return new Request("http://localhost/api/assessment/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/assessment/submit", () => {
  it("rejects invalid type", async () => {
    const res = await submitPost(fakeRequest({ type: "nope", responses: {} }));
    expect(res.status).toBe(400);
  });

  it("rejects incomplete RIASEC", async () => {
    const res = await submitPost(fakeRequest({ type: "riasec", responses: { R1: 3 } }));
    expect(res.status).toBe(400);
  });

  it("accepts complete RIASEC submission and returns scores", async () => {
    const responses = Object.fromEntries(RIASEC_ITEMS.map((i) => [i.id, 3]));
    const res = await submitPost(fakeRequest({ type: "riasec", responses }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scores).toBeDefined();
    expect(json.scores.R).toBe(50);
  });
});
```

> If your Vitest setup mocks Supabase and anonymous-user creation, this test will go through. If those pieces error in test environment, mark the test `skip` and verify manually via the dev server. The unit tests in Tasks 3, 5, 6, 7 already cover scoring correctness deterministically.

- [ ] **Step 2: Run**

```powershell
npm test -- assessment-submit
```

Expected: PASS or skipped (depending on test infra).

- [ ] **Step 3: Commit**

```powershell
git add tests/integration/assessment-submit.test.ts
git commit -m "test: integration coverage for /api/assessment/submit"
```

---

## Task 20: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run dev server**

```powershell
npm run dev
```

- [ ] **Step 2: Visit `/assessment`** in the browser

Expected: hub page loads with 4 cards, all showing "טרם התחלת".

- [ ] **Step 3: Take RIASEC** — click into `/assessment/riasec`, answer all 30 items, submit

Expected: success toast, redirect to hub, RIASEC card now shows "הושלם".

- [ ] **Step 4: Take Big5** — same flow, 20 items

- [ ] **Step 5: Take values** — pick 5, click המשך, rank 3, submit

- [ ] **Step 6: Take constraints** — fill required fields, submit

- [ ] **Step 7: Verify in DB**

In Supabase SQL editor or via MCP:
```sql
select type, items_version, scores, taken_at
from public.assessments
where user_id = (select id from public.users order by created_at desc limit 1)
order by taken_at desc;
```

Expected: 4 rows, one per type.

- [ ] **Step 8: Verify chat agent sees the formal scores**

Open `/chat`, ask: "אתה רואה את התוצאות של השאלונים שמילאתי?". The agent should be able to reference your top RIASEC types or your top values. (It won't *automatically* — the chat route needs to read `getProfile().formal` and inject into the system prompt. **This is intentionally out of scope for Phase 3a — the data is persisted; Phase 4's matching engine is what consumes it.** Verify only that the data is there.)

- [ ] **Step 9: Push branch + open PR**

```powershell
git push origin feat/phase-3a-assessments
gh pr create --title "Phase 3a: formal assessments" --body "RIASEC + Big5 + values + constraints behind /assessment/* with deterministic scoring and \`assessments\` table."
```

---

## 5. Definition of Done

- [ ] All four assessments accessible from `/assessment` hub
- [ ] All four submit successfully end-to-end
- [ ] All four scoring functions have green unit tests
- [ ] `assessments` table has rows for each completed submission
- [ ] `getProfile()` includes `formal.{riasec,big5,values,constraints}` (null where not taken)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm test` green
- [ ] CI green on PR
- [ ] Item-quality review captured as a Phase 7 launch-checklist task (out of scope here)

---

## 6. Known follow-ups (not blocking Phase 3a merge)

1. **Hebrew item review by a psychologist** — items v1 are best-effort; gate before public launch.
2. **Item analytics** — once we have ≥100 submissions, look at item-rest correlations to flag items that don't load on their intended trait.
3. **Save partial progress** — Phase 3a quizzes lose state on refresh; Phase 4 or 5 can add localStorage persistence if user testing flags this.
4. **Skip-and-come-back** — currently a quiz must be completed in one sitting; partial saves would fix.
5. **Constraint conflicts** — if user says "needs immediate income" but `months_until_income_required = 36`, that's contradictory. Phase 4 matching engine should validate cross-field consistency.
6. **Chat-agent awareness of formal scores** — explicit prompt extension that lets Claude reference assessment results when explaining matches. Lives more naturally in Phase 4 (matching prose generation) than here.
