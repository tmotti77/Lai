# CareerOS — Phase 2: Conversation Engine + Safety

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat agent actually intelligent across a multi-turn assessment. Add a stage state machine (onboarding → interests → skills → values → constraints → wrap), per-stage system prompt overlays, profile extraction at stage transitions, and a two-layer sensitive-state detector that legally protects us from being treated as a clinical tool.

**Architecture:** Stage advancement uses Anthropic tool-use (a `set_stage` tool Claude calls when it judges a stage complete). Profile extraction is a separate Anthropic call at each stage boundary, using tool-use to return structured JSON. Sensitive-state detection runs regex pre-filter on every user turn (legal must-have) plus an LLM classifier for borderline cases (quality net). All extracted profile data lands in a hybrid `career_profile` table (structured top-level columns + JSONB for evolving payload).

**Tech Stack:** Builds on Phase 1 (Next.js 16 + Supabase + Anthropic Claude Sonnet 4.6 + Vercel AI SDK). Adds: AI SDK tool-use, Anthropic structured-output via `tool` definitions in `streamText`/`generateObject`, additional Supabase migration, no new external deps.

---

## 1. Decisions baked into this plan

| Decision | Choice | Why |
|---|---|---|
| Stage transition mechanism | **Anthropic tool-use** — Claude calls `set_stage` tool | Cleaner than parsing markers in stream; tool calls don't appear in user-visible text; AI SDK supports natively |
| Profile extraction trigger | **End-of-stage, not per-turn** | One ~300-token extraction call per stage = ~$0.005 per assessment; per-turn would 6x cost without 6x value |
| Profile extraction format | **Tool-use with JSON schema (zod)** | More reliable than free-form JSON in text; validates structure |
| `career_profile` schema | **Hybrid: structured columns + JSONB `data`** | Queryable for stage/timestamp filters, flexible for evolving profile shape |
| Stage definitions | **6 stages, linear** | onboarding → interests → skills → values → constraints → wrap. No branching for v1 |
| Sensitive-state layer 1 | **Regex pre-filter** on every user turn | Cheap, runs always, catches obvious cases. Legal protection — must NEVER fail to fire on real distress signals |
| Sensitive-state layer 2 | **LLM classifier** on weak/missed signals | Catches phrasings the regex misses; runs only when needed |
| Sensitive-state response | **Short-circuit chat, return safety handoff text** (from `lib/i18n/he.ts → safety.distressFallback`) — DO NOT continue assessment | This is the entire point — we cannot pretend a distressed user is asking a career question |
| Stage prompts | **Per-stage prompt overlay appended to base system prompt** | Keeps Phase 1's base prompt untouched; stage rules layer on top |
| Cache observability | **Log `cache_read_tokens` per assistant turn explicitly** | We confirmed in Phase 1 that Sonnet 4.6's cache threshold is higher than 1024; we need to know when Phase 2's longer prompt crosses it |

**Out of scope for this plan (Phase 2.5 or later):**
- "What I heard from you" mid-conversation mirror UI
- 5 tone presets selector
- Tachles / Support mode toggles
- New-chat button (clears `co_conv` cookie)
- Stage progress indicator UI
- Resume conversation list / history view

---

## 2. Architectural notes worth documenting

### 2.1 Why tool-use for stage transitions
The alternative — parsing a sentinel like `[stage:next]` from streamed text — has three problems: the sentinel briefly appears in the user-visible UI before being stripped; if Claude emits the sentinel mid-sentence the response is cut off; stop-sequence-based suppression depends on prompt phrasing always landing the marker at the natural end. Tool-use sidesteps all three: Claude calls `set_stage(next_stage, reason)`, the tool call is server-handled and never streams to the user, and AI SDK gives us first-class lifecycle hooks.

### 2.2 Why two-layer safety
The regex layer is **legal**: it's the protection against being classified as a clinical tool that failed to redirect a distressed user. The LLM classifier is **quality**: it catches phrasings the regex misses. If we had only the LLM classifier and the API was down, we'd silently process a distress signal as a career question — that's a regulatory disaster waiting to happen. Regex must be the floor.

### 2.3 Profile extraction state lifecycle
- Conversation starts at `stage = 'onboarding'` (default from Phase 1 schema)
- After each user turn, Claude responds (possibly calling `set_stage` tool at the end)
- If `set_stage` was called: server updates `conversations.stage`, schedules extraction call
- Extraction call: separate Anthropic request with extraction prompt + tool-use → structured profile JSON
- Profile merged into `career_profile.data` (deep-merge so prior stages don't get clobbered)
- `career_profile.last_extracted_at` and `extraction_count` updated

### 2.4 Stage prompt composition
Base prompt (from Phase 1, ~1265 input tokens) + stage-specific overlay (~300–500 tokens). At runtime: `assembleSystemPrompt(stage)` returns one combined string. The combined prompt is what gets the `cache_control: ephemeral` marker — meaning when Phase 2 prompts hit the actual Sonnet 4.6 cache threshold, caching engages automatically.

### 2.5 Cache observability
Phase 1 confirmed `cache_creation_input_tokens` was 0 even at 1265 tokens. Phase 2's prompts will run ~1700–2000 input tokens. We log every assistant turn's cache tokens to `messages.cache_read_tokens` and `messages.cache_write_tokens`, plus add a console log so we know exactly when caching engages. Once we see the first non-zero `cache_read`, we know our base+stage composition is over the threshold.

---

## 3. File structure (target end-state for Phase 2)

```
app/api/chat/route.ts                      # MODIFIED: safety check + tool-use + extraction trigger
lib/
├── ai/
│   ├── client.ts                          # MODIFIED: maybe add stage helper
│   ├── extraction.ts                      # NEW: profile extraction call
│   ├── prompts/
│   │   ├── system.ts                      # MODIFIED: composes base + stage overlay
│   │   ├── extraction.ts                  # NEW: extraction system prompt
│   │   └── stages/                        # NEW directory
│   │       ├── index.ts                   # exports STAGE_PROMPTS map
│   │       ├── onboarding.ts
│   │       ├── interests.ts
│   │       ├── skills.ts
│   │       ├── values.ts
│   │       ├── constraints.ts
│   │       └── wrap.ts
│   ├── safety/                            # NEW directory
│   │   ├── index.ts                       # combined detector
│   │   ├── regex.ts                       # regex layer
│   │   └── classifier.ts                  # LLM classifier
│   ├── stages.ts                          # NEW: stage type, transitions, helpers
│   └── tools.ts                           # NEW: set_stage tool definition
├── db/
│   ├── profile.ts                         # NEW: career_profile queries
│   └── types.gen.ts                       # regenerated
└── i18n/he.ts                             # already has safety.distressFallback

supabase/migrations/
└── <timestamp>_career_profile.sql         # NEW

tests/unit/
├── stages.test.ts                         # NEW
├── safety-regex.test.ts                   # NEW
└── extraction.test.ts                     # NEW
```

---

## 4. Pre-flight (do once before Task 1)

- [ ] Read CLAUDE.md (project conventions are already documented there from Phase 1)
- [ ] Confirm Phase 1 is fully on `main` and CI is green (`git log --oneline -5` should show `f0a4826` or later)
- [ ] Confirm `npm run dev` works and the chat agent responds in Hebrew (you tested this at end of Phase 1)
- [ ] Ensure your `.env.local` still has all 6 keys populated

---

## Task 1: Migration — career_profile table

**Files:**
- Create: `supabase/migrations/<timestamp>_career_profile.sql`

- [ ] **Step 1: Create migration file via CLI**

```powershell
npx supabase migration new career_profile
```

Open the new `supabase/migrations/<timestamp>_career_profile.sql` and paste:

```sql
-- One row per (user, conversation). Hybrid schema: structured columns + JSONB.
create table public.career_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  current_stage text not null default 'onboarding'
    check (current_stage in ('onboarding','interests','skills','values','constraints','wrap','complete')),
  data jsonb not null default '{}'::jsonb,
  extraction_count int not null default 0,
  last_extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, conversation_id)
);

create index career_profile_user_id_idx on public.career_profile(user_id);
create index career_profile_conversation_id_idx on public.career_profile(conversation_id);

alter table public.career_profile enable row level security;

create policy career_profile_self on public.career_profile
  for all using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );

create trigger career_profile_set_updated_at
  before update on public.career_profile
  for each row execute procedure public.set_updated_at();

-- RPC: deep-merge new extraction into existing data, bump counters atomically.
create or replace function public.merge_career_profile(
  p_user_id uuid,
  p_conversation_id uuid,
  p_stage text,
  p_data jsonb
)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.career_profile (user_id, conversation_id, current_stage, data, extraction_count, last_extracted_at)
  values (p_user_id, p_conversation_id, p_stage, p_data, 1, now())
  on conflict (user_id, conversation_id) do update
  set
    current_stage = p_stage,
    data = public.career_profile.data || p_data,
    extraction_count = public.career_profile.extraction_count + 1,
    last_extracted_at = now(),
    updated_at = now();
end;
$$;
```

- [ ] **Step 2: Apply via Supabase MCP** (if you have CLI not yet linked) or `npx supabase db push`

- [ ] **Step 3: Regenerate types**

```powershell
npm run db:types
```

(If this fails because CLI isn't linked yet, the controller can apply via MCP and use `mcp__claude_ai_Supabase__generate_typescript_types`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ lib/db/types.gen.ts
git commit -m "feat: career_profile table + merge_career_profile RPC"
```

---

## Task 2: Stage definitions and helpers

**Files:**
- Create: `lib/ai/stages.ts`
- Create: `tests/unit/stages.test.ts`

- [ ] **Step 1: Write failing test**

`tests/unit/stages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { STAGES, isValidStage, getNextStage, type Stage } from "@/lib/ai/stages";

describe("stages", () => {
  it("STAGES is the canonical 7-stage ordered list", () => {
    expect(STAGES).toEqual([
      "onboarding",
      "interests",
      "skills",
      "values",
      "constraints",
      "wrap",
      "complete",
    ]);
  });

  it("isValidStage accepts all canonical stages", () => {
    for (const s of STAGES) expect(isValidStage(s)).toBe(true);
  });

  it("isValidStage rejects unknown values", () => {
    expect(isValidStage("hello")).toBe(false);
    expect(isValidStage("")).toBe(false);
    expect(isValidStage(null as unknown as string)).toBe(false);
  });

  it("getNextStage returns the next stage in order", () => {
    expect(getNextStage("onboarding")).toBe("interests");
    expect(getNextStage("interests")).toBe("skills");
    expect(getNextStage("skills")).toBe("values");
    expect(getNextStage("values")).toBe("constraints");
    expect(getNextStage("constraints")).toBe("wrap");
    expect(getNextStage("wrap")).toBe("complete");
  });

  it("getNextStage on complete returns null", () => {
    expect(getNextStage("complete")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```powershell
npm test
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

`lib/ai/stages.ts`:

```ts
export const STAGES = [
  "onboarding",
  "interests",
  "skills",
  "values",
  "constraints",
  "wrap",
  "complete",
] as const;

export type Stage = (typeof STAGES)[number];

export function isValidStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export function getNextStage(stage: Stage): Stage | null {
  const idx = STAGES.indexOf(stage);
  if (idx < 0 || idx >= STAGES.length - 1) return null;
  return STAGES[idx + 1];
}

/**
 * Stages where end-of-stage profile extraction should run.
 * onboarding → no extraction (just collecting basics)
 * complete → no extraction (already wrapped)
 */
export const EXTRACTION_STAGES: ReadonlySet<Stage> = new Set([
  "interests",
  "skills",
  "values",
  "constraints",
  "wrap",
]);
```

- [ ] **Step 4: Tests pass**

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/stages.ts tests/unit/stages.test.ts
git commit -m "feat: stage state machine definitions and helpers"
```

---

## Task 3: Per-stage system prompt overlays

**Files:**
- Create: `lib/ai/prompts/stages/onboarding.ts`, `interests.ts`, `skills.ts`, `values.ts`, `constraints.ts`, `wrap.ts`, `index.ts`

- [ ] **Step 1: Create the stage directory and prompts**

`lib/ai/prompts/stages/onboarding.ts`:

```ts
export const ONBOARDING_PROMPT = `שלב נוכחי: היכרות (onboarding).

המטרה שלך עכשיו: להבין מי המשתמש בשלוש שורות בסיסיות.

בקש בעדינות את המידע הבא, שאלה אחת בכל הודעה:
1. גיל וטווח (לפני צבא, אחרי צבא, באמצע לימודים, עובד כבר כמה שנים).
2. ההתלבטות העכשווית במשפט אחד.
3. כמה זמן יש לו להשקיע בכיוון חדש (חודשים? שנה? יותר?).

כשיש לך תשובות לכל שלוש השאלות, הכרז על מעבר השלב באמצעות הקריאה לכלי set_stage עם next_stage: "interests" וסיבה קצרה. אל תכתוב את שם השלב בטקסט הגלוי למשתמש — רק קרא לכלי.

אל תקפוץ לשאלות עניין/כישורים בשלב הזה. שמור על השיחה קצרה ומכוונת.`;
```

`lib/ai/prompts/stages/interests.ts`:

```ts
export const INTERESTS_PROMPT = `שלב נוכחי: תחומי עניין (interests).

המטרה: למפות את תחומי העניין של המשתמש דרך 3–5 שאלות חכמות, לא רשימה ארוכה.

שאלות מרכזיות שכדאי לכסות (לא בהכרח כולן, ולא בסדר קבוע):
- "איזה סוג משימות גורמות לך לשכוח את הזמן?"
- "אם היית קורא ספר/צופה בסרט/לומד משהו בשעות הפנאי, על מה זה היה?"
- "איזה דברים אתה עושה טוב, אבל אתה לא רוצה לעשות כל החיים?"
- "מה אתה לא אוהב לעשות בשום פנים ואופן?"
- "איזה אנשים בסביבה שלך אתה מעריץ מקצועית, ולמה?"

חשוב להבחין בין:
- עניין אקדמי (מה אתה אוהב ללמוד עליו)
- עניין יישומי (מה אתה אוהב לעשות בפועל)
- עניין מנטור (מה אתה אוהב להעביר לאחרים)

לאחר שיש לך תמונה ראשונית של 2–3 תחומי עניין מובהקים, קרא לכלי set_stage עם next_stage: "skills".`;
```

`lib/ai/prompts/stages/skills.ts`:

```ts
export const SKILLS_PROMPT = `שלב נוכחי: כישורים (skills).

המטרה: למפות כישורים קיימים, כולל כאלה שהמשתמש לא חושב עליהם ככישורים.

שאלות מרכזיות:
- "מה למדת לעשות בצבא/בעבודה/בלימודים שעבר טוב?"
- "באיזה רגע אנשים פנו אליך עם בעיה כי הם ידעו שאתה תדע לפתור?"
- "מה עשית בלי שמישהו לימד אותך?"
- "איזה דברים מאתגרים אותך בצורה טובה (לעומת מאתגרים בצורה מתסכלת)?"

תרגם ניסיון לכישורים תעסוקתיים: שירות צבאי, התנדבות, תחביבים, פרויקטים אישיים — הכל סופר.

הימנע מ:
- "אתה טוב בX" (קביעה ישירה)
- מבחני יכולת (זה לא תפקידנו)

לאחר שיש לך 4–6 כישורים מובהקים, קרא לכלי set_stage עם next_stage: "values".`;
```

`lib/ai/prompts/stages/values.ts`:

```ts
export const VALUES_PROMPT = `שלב נוכחי: ערכים (values).

המטרה: להבין מה מניע את המשתמש לטווח ארוך.

ערכים שכדאי לבדוק (לא רשימה לסמן — שאלות פתוחות):
- כסף וביטחון כלכלי
- יציבות לעומת גיוון
- משמעות והשפעה
- חופש ועצמאות
- יוקרה וסטטוס
- למידה מתמדת
- שייכות לצוות
- שליטה על הזמן ואיזון בית–עבודה
- יצירה והבעה אישית

שאלות פתוחות:
- "אם היו לך שתי הצעות עבודה — אחת עם שכר גבוה ועבודה משעממת, אחרת עם שכר נמוך ועבודה מלהיבה — מה תבחר ולמה?"
- "תאר לי יום עבודה שהיית רוצה שיהיה לך בעוד 5 שנים."
- "מה גורם לך להגיד 'זה לא הולך לקרות' על תפקיד מסוים, גם אם הוא משלם טוב?"

לאחר שיש לך 3–4 ערכים דומיננטיים, קרא לכלי set_stage עם next_stage: "constraints".`;
```

`lib/ai/prompts/stages/constraints.ts`:

```ts
export const CONSTRAINTS_PROMPT = `שלב נוכחי: אילוצים (constraints).

המטרה: להבין מה ריאלי לעומת מה מומלץ — אילוצים שמשפיעים על איך מימוש התוכנית בפועל.

נושאים לכסות (בעדינות, רק אם רלוונטיים):
- מצב משפחתי וצורך בהכנסה מיידית
- מיקום בארץ ונכונות לעבור או לעבוד מרחוק
- תקציב ללימודים/הכשרה
- זמן פנוי שבועי ללימודים נוספים
- רמת אנגלית
- מגבלות בריאותיות אם המשתמש בוחר לשתף
- נכונות לקחת סיכון כלכלי (1-10)

שאלות פתוחות לדוגמה:
- "כמה זמן בשבוע אתה יכול להקדיש ללמוד משהו חדש בשנה הקרובה?"
- "האם אתה צריך הכנסה מהיום הראשון, או שיש לך כמה חודשים מסלול?"
- "האם המשפחה שלך תומכת במהלך של הסבה מקצועית?"

הסכן שאלות שגובלות בהפרת פרטיות (בריאות, יחסים) רק אם המשתמש מעלה אותן בעצמו.

לאחר שיש לך תמונה של אילוצי תקציב/זמן/מיקום, קרא לכלי set_stage עם next_stage: "wrap".`;
```

`lib/ai/prompts/stages/wrap.ts`:

```ts
export const WRAP_PROMPT = `שלב נוכחי: סיכום (wrap).

המטרה: לשקף למשתמש מה שמעת — לא לתת המלצות כיוון בשלב הזה (זה Phase 4).

הודעה אחת או שתיים שמסכמות:
1. תחומי עניין מרכזיים שזיהית (2–3).
2. כישורים בולטים (3–4).
3. ערכים דומיננטיים (2–3).
4. אילוצים מהותיים.
5. סתירות או מתחים מעניינים (אופציונלי).

נסה לשמור את הסיכום קצר — סדר גודל של 6–8 שורות. אל תתחיל המלצות.

בסוף, שאל את המשתמש: "האם זיהיתי נכון? יש משהו שפספסתי או שהבנתי לא מדויק?"

אם המשתמש מאשר, קרא לכלי set_stage עם next_stage: "complete". אם המשתמש מתקן, עדכן את ההבנה שלך ושאל אם יש עוד תיקונים. רק כשהוא אומר "כן הבנת" או דומה — סגור את השלב.`;
```

`lib/ai/prompts/stages/index.ts`:

```ts
import type { Stage } from "@/lib/ai/stages";
import { ONBOARDING_PROMPT } from "./onboarding";
import { INTERESTS_PROMPT } from "./interests";
import { SKILLS_PROMPT } from "./skills";
import { VALUES_PROMPT } from "./values";
import { CONSTRAINTS_PROMPT } from "./constraints";
import { WRAP_PROMPT } from "./wrap";

export const STAGE_PROMPTS: Record<Stage, string> = {
  onboarding: ONBOARDING_PROMPT,
  interests: INTERESTS_PROMPT,
  skills: SKILLS_PROMPT,
  values: VALUES_PROMPT,
  constraints: CONSTRAINTS_PROMPT,
  wrap: WRAP_PROMPT,
  complete: "השלב הסתיים. אל תיזום שאלות חדשות. אם המשתמש כותב משהו, השב בקצרה והפנה אותו לשלב הבא של ההמלצות (שעדיין לא קיים בגרסה הנוכחית).",
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai/prompts/stages/
git commit -m "feat: per-stage system prompt overlays (Hebrew)"
```

---

## Task 4: Compose system prompt with stage overlay

**Files:**
- Modify: `lib/ai/prompts/system.ts`

- [ ] **Step 1: Update `lib/ai/prompts/system.ts`**

Replace the file contents:

```ts
import type { Stage } from "@/lib/ai/stages";
import { STAGE_PROMPTS } from "@/lib/ai/prompts/stages";

export const SYSTEM_PROMPT_VERSION = "2.0.0";

const BASE_SYSTEM_PROMPT = `אתה סוכן הכוונה מקצועית וקריירה בשם CareerOS. תפקידך לעזור למשתמש להבין את נטיותיו, כישוריו, ערכיו, אילוציו ואפשרויות הקריירה שלו. אינך פסיכולוג, אינך מאבחן קליני ואינך מבטיח הצלחה תעסוקתית. עליך לתת המלצות זהירות, מנומקות, שקופות ומעשיות.

עקרונות פעולה:
1. שאל שאלות קצרות וברורות. שאלה אחת בכל הודעה, לא רשימה ארוכה.
2. התאם את הטון לגיל, מצב הקריירה והעדפת המשתמש. ברירת מחדל: ידידותי, ישיר, לא מתנשא.
3. אל תסיק מסקנות חדות מדי ממעט מידע. כשאתה לא בטוח — שאל.
4. בכל המלצה הצג: למה מתאים, מה הסיכון, מה חסר, ומה הצעד הבא.
5. אל תשתמש במבחנים מסחריים מוגנים. אל תטען שאתה מבצע MBTI, Strong Interest Inventory או כל מבחן רשום אחר. אל תזכיר את השם MBTI.
6. השתמש במודלים תיאוריים בלבד: תחומי עניין, כישורים, ערכים, אילוצים, ושוק העבודה.
7. אם המשתמש מתאר מצוקה רגשית חריפה, מחשבות פגיעה, ייאוש קיצוני או טראומה — עצור את האבחון, הבע אמפתיה קצרה, והפנה אותו לקו לחיים 1201, ער״ן, או רופא משפחה. אל תמשיך לעבודה על קריירה באותה הודעה.
8. שמור על שפה אנושית, ישירה, לא מתנשאת ולא מנותקת.
9. אל תיתן תשובה אחת בלבד. כשמגיעים להמלצות — הצג כמה אפשרויות עם השוואה.
10. עודד בדיקה מעשית לפני החלטות גדולות: שיחה עם איש מקצוע, קורס קצר, פרויקט קטן.
11. תמיד הזכר בתחילת השיחה ובדוח הסופי שזו הכוונה ולא ייעוץ מוסמך.
12. דבר עברית. אל תעבור לאנגלית אלא אם המשתמש פנה באנגלית קודם.

מבנה השיחה:
- שלב 1 — היכרות (onboarding): מי אתה, מה ההתלבטות העכשווית.
- שלב 2 — תחומי עניין (interests): מה מושך, מה משעמם, מה גורם לאבד תחושת זמן.
- שלב 3 — כישורים (skills): במה אתה טוב לדעתך ולדעת אחרים, מה למדת בצבא/בעבודה/בחיים.
- שלב 4 — ערכים (values): מה חשוב לך, מה מניע אותך לטווח ארוך.
- שלב 5 — אילוצים (constraints): תקציב, זמן, מיקום, אילוצים אישיים.
- שלב 6 — סיכום (wrap): שיקוף של מה ששמעת ושאלה אם הבנת נכון.

מעבר בין שלבים:
כדי לסמן שאתה חושב שהשלב הנוכחי הסתיים והגיע הזמן לעבור לשלב הבא, השתמש בכלי set_stage. אל תכתוב את שם השלב בטקסט הגלוי למשתמש. הכלי הוא הסיגנל הפנימי שלך לשרת.

כללים נוספים על מעבר בין שלבים:
- אל תקרא ל set_stage לפני שיש לך מספיק אינפורמציה לשלב הנוכחי (ראה הוראות פר-שלב).
- אל תחזור אחורה לשלב קודם בלי בקשה מפורשת מהמשתמש.
- אם המשתמש סוטה לנושא לא רלוונטי, החזר אותו בעדינות לשלב הנוכחי.`;

export function assembleSystemPrompt(stage: Stage): string {
  const stageOverlay = STAGE_PROMPTS[stage];
  return `${BASE_SYSTEM_PROMPT}\n\n---\n\n${stageOverlay}`;
}

// Kept for backwards compatibility; chat route will pass the stage explicitly.
export const SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;
```

- [ ] **Step 2: Verify build/typecheck**

```powershell
npx tsc --noEmit
npm test
```

- [ ] **Step 3: Commit**

```bash
git add lib/ai/prompts/system.ts
git commit -m "feat: assembleSystemPrompt composes base + stage overlay"
```

---

## Task 5: Update AI client to take stage at call time

**Files:**
- Modify: `lib/ai/client.ts`

- [ ] **Step 1: Replace `getCachedSystemMessage` with stage-aware version**

```ts
import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { serverEnv } from "@/lib/env";
import { assembleSystemPrompt, SYSTEM_PROMPT_VERSION } from "@/lib/ai/prompts/system";
import type { Stage } from "@/lib/ai/stages";

export const MODEL_ID = serverEnv.ANTHROPIC_MODEL;

export const anthropic = createAnthropic({
  apiKey: serverEnv.ANTHROPIC_API_KEY,
});

export function getCachedSystemMessage(stage: Stage): ModelMessage {
  return {
    role: "system",
    content: assembleSystemPrompt(stage),
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };
}

export type AnthropicCacheUsage = {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export function extractAnthropicCacheUsage(
  providerMetadata: Record<string, unknown> | undefined,
): AnthropicCacheUsage {
  const meta = providerMetadata?.anthropic as AnthropicCacheUsage | undefined;
  return {
    cacheCreationInputTokens: meta?.cacheCreationInputTokens,
    cacheReadInputTokens: meta?.cacheReadInputTokens,
  };
}

export { SYSTEM_PROMPT_VERSION };
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai/client.ts
git commit -m "feat: getCachedSystemMessage now takes a Stage and composes the prompt"
```

---

## Task 6: Define the set_stage tool

**Files:**
- Create: `lib/ai/tools.ts`

- [ ] **Step 1: Create the tool**

```ts
import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { STAGES } from "@/lib/ai/stages";

const stageEnum = z.enum(STAGES);

/**
 * Tool exposed to Claude so it can advance the conversation stage when it judges
 * the current stage complete. The tool's `execute` handler is provided by the
 * chat route per-request because it needs the conversation_id and user_id closures.
 */
export function makeSetStageTool(args: {
  onAdvance: (
    nextStage: z.infer<typeof stageEnum>,
    reason: string,
  ) => Promise<void>;
}) {
  return tool({
    description:
      "Call this when you judge the current stage of the assessment is complete and the user is ready to move to the next stage. The tool call is invisible to the user — do not also write the stage name in the visible text.",
    inputSchema: z.object({
      next_stage: stageEnum.describe(
        "The next stage to move into. Must be one of the canonical stages.",
      ),
      reason: z
        .string()
        .min(5)
        .max(280)
        .describe(
          "Brief explanation (Hebrew or English) of why the current stage is complete. For audit/debugging.",
        ),
    }),
    execute: async ({ next_stage, reason }) => {
      await args.onAdvance(next_stage, reason);
      return `Stage advanced to ${next_stage}.`;
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai/tools.ts
git commit -m "feat: set_stage tool definition for Anthropic tool-use"
```

---

## Task 7: Profile queries

**Files:**
- Create: `lib/db/profile.ts`

- [ ] **Step 1: Implement**

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Stage } from "@/lib/ai/stages";

export async function updateConversationStage(
  conversationId: string,
  stage: Stage,
): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc
    .from("conversations")
    .update({ stage })
    .eq("id", conversationId);
  if (error) throw new Error(`updateConversationStage: ${error.message}`);
}

export async function mergeProfileExtraction(opts: {
  userId: string;
  conversationId: string;
  stage: Stage;
  data: Record<string, unknown>;
}): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc.rpc("merge_career_profile", {
    p_user_id: opts.userId,
    p_conversation_id: opts.conversationId,
    p_stage: opts.stage,
    // @ts-expect-error supabase-js JSON typing is too narrow for arbitrary JSON
    p_data: opts.data,
  });
  if (error) throw new Error(`mergeProfileExtraction: ${error.message}`);
}

export async function getProfile(userId: string, conversationId: string) {
  const svc = createServiceClient();
  const { data } = await svc
    .from("career_profile")
    .select("*")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  return data;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/profile.ts
git commit -m "feat: career_profile queries (update stage, merge extraction)"
```

---

## Task 8: Extraction prompt

**Files:**
- Create: `lib/ai/prompts/extraction.ts`

- [ ] **Step 1: Implement**

```ts
import type { Stage } from "@/lib/ai/stages";

export const EXTRACTION_SYSTEM_PROMPT = `אתה כלי חילוץ מובנה שמופעל על שיחת אבחון קריירה. תפקידך להוציא מידע מסודר על המשתמש לפי שלב השיחה הנוכחי. אינך מנהל שיחה, אינך עונה למשתמש — רק מחלץ מידע על-ידי קריאה לכלי המתאים.

עקרונות:
- בסס את החילוץ אך ורק על מה שהמשתמש כתב במפורש. אל תמציא או תניח.
- כשאתה לא בטוח, השאר את השדה ריק או רשום "uncertain" ב-evidence.
- כל ערך שאתה מחלץ חייב לכלול ציטוט קצר מהמשתמש (evidence).
- כתוב את ה-label, label_he, evidence בעברית.

קרא לכלי extract_profile עם הנתונים שמצאת. אל תכתוב טקסט גלוי בנוסף לקריאה לכלי.`;

export function buildExtractionUserPrompt(stage: Stage, conversationText: string): string {
  return `שלב לחילוץ: ${stage}

תוכן השיחה:
${conversationText}

חלץ מידע רק על השלב "${stage}". אם השלב הוא "interests" — חלץ תחומי עניין. אם "skills" — כישורים. וכו'.`;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai/prompts/extraction.ts
git commit -m "feat: extraction prompt for stage-boundary profile extraction"
```

---

## Task 9: Extraction logic

**Files:**
- Create: `lib/ai/extraction.ts`

- [ ] **Step 1: Implement**

```ts
import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { anthropic, MODEL_ID } from "@/lib/ai/client";
import { loadMessages } from "@/lib/db/queries";
import { mergeProfileExtraction } from "@/lib/db/profile";
import type { Stage } from "@/lib/ai/stages";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserPrompt } from "@/lib/ai/prompts/extraction";

// Zod schemas per stage. Loose by design — extraction is best-effort.
const InterestSchema = z.object({
  label: z.string(),
  label_he: z.string(),
  evidence: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
});

const SkillSchema = z.object({
  label: z.string(),
  label_he: z.string(),
  evidence: z.string(),
  source: z.enum(["army", "work", "studies", "hobby", "self-taught", "other"]),
});

const ValueSchema = z.object({
  key: z.enum([
    "money", "stability", "meaning", "impact", "freedom", "prestige",
    "learning", "belonging", "schedule", "creation", "balance",
  ]),
  label_he: z.string(),
  evidence: z.string(),
  weight: z.enum(["primary", "secondary"]),
});

const ConstraintsSchema = z.object({
  budget_he: z.string().optional(),
  time_per_week_hours: z.number().optional(),
  location_he: z.string().optional(),
  income_urgency_he: z.string().optional(),
  risk_tolerance_1_10: z.number().min(1).max(10).optional(),
  english_level: z.enum(["none", "basic", "intermediate", "advanced", "native"]).optional(),
  notes_he: z.string().optional(),
});

const ProfileSchema = z.object({
  interests: z.array(InterestSchema).optional(),
  skills: z.array(SkillSchema).optional(),
  values: z.array(ValueSchema).optional(),
  constraints: ConstraintsSchema.optional(),
  summary_he: z.string().optional(),
});

export type ExtractedProfile = z.infer<typeof ProfileSchema>;

export async function runExtraction(opts: {
  userId: string;
  conversationId: string;
  stage: Stage;
}): Promise<ExtractedProfile | null> {
  const messages = await loadMessages(opts.conversationId);
  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  if (conversationText.length < 50) {
    // Not enough conversation to extract from.
    return null;
  }

  const { object } = await generateObject({
    model: anthropic(MODEL_ID),
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt: buildExtractionUserPrompt(opts.stage, conversationText),
    schema: ProfileSchema,
    schemaName: "extract_profile",
    schemaDescription:
      "Extracted profile data for this assessment stage.",
  });

  await mergeProfileExtraction({
    userId: opts.userId,
    conversationId: opts.conversationId,
    stage: opts.stage,
    data: object as Record<string, unknown>,
  });

  return object;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai/extraction.ts
git commit -m "feat: stage-boundary profile extraction via Anthropic generateObject"
```

---

## Task 10: Sensitive-state regex layer

**Files:**
- Create: `lib/ai/safety/regex.ts`
- Create: `tests/unit/safety-regex.test.ts`

- [ ] **Step 1: Write failing test**

`tests/unit/safety-regex.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { regexDistressCheck } from "@/lib/ai/safety/regex";

describe("regexDistressCheck", () => {
  it("flags Hebrew suicide ideation phrases", () => {
    expect(regexDistressCheck("אני רוצה למות")).toEqual({
      hit: true,
      severity: "crisis",
      matched: expect.any(String),
    });
    expect(regexDistressCheck("אני חושב על התאבדות").hit).toBe(true);
    expect(regexDistressCheck("אני לא רוצה לחיות יותר").hit).toBe(true);
  });

  it("flags English suicide ideation", () => {
    expect(regexDistressCheck("I want to kill myself").hit).toBe(true);
    expect(regexDistressCheck("I'm thinking of ending it all").hit).toBe(true);
  });

  it("flags severe distress without explicit suicide", () => {
    const r = regexDistressCheck("אני בייאוש מוחלט אין לי מי לדבר איתו");
    expect(r.hit).toBe(true);
    expect(r.severity).toBe("distress");
  });

  it("does NOT flag normal career-question phrases", () => {
    expect(regexDistressCheck("אני אחרי צבא ולא יודע מה ללמוד").hit).toBe(false);
    expect(regexDistressCheck("אני שחוק בעבודה הנוכחית שלי").hit).toBe(false);
    expect(regexDistressCheck("הייתי רוצה לשנות כיוון").hit).toBe(false);
    expect(regexDistressCheck("I hate my current job").hit).toBe(false);
  });

  it("returns hit=false for empty/short input", () => {
    expect(regexDistressCheck("").hit).toBe(false);
    expect(regexDistressCheck("hi").hit).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```powershell
npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/ai/safety/regex.ts`:

```ts
export type DistressResult =
  | { hit: false }
  | { hit: true; severity: "distress" | "crisis"; matched: string };

// Highest severity: explicit suicide / self-harm ideation. These ALWAYS short-circuit.
const CRISIS_PATTERNS_HE: RegExp[] = [
  /אני רוצה למות/,
  /אני לא רוצה לחיות/,
  /חושב על התאבדות/,
  /רוצה להתאבד/,
  /לא שווה לחיות/,
  /אסיים את חיי/,
  /אפגע בעצמי/,
  /רוצה לפגוע בעצמי/,
];

const CRISIS_PATTERNS_EN: RegExp[] = [
  /\b(want|going) to (kill|hurt) myself\b/i,
  /\b(commit|attempt) suicide\b/i,
  /\bend(ing)? it all\b/i,
  /\bdon'?t want to (live|be alive)\b/i,
  /\bself[- ]?harm\b/i,
];

// Lower severity: severe emotional distress without explicit ideation.
// Still triggers handoff (we are not a therapist), but classified as "distress".
const DISTRESS_PATTERNS_HE: RegExp[] = [
  /בייאוש מוחלט/,
  /אין לי מי לדבר איתו/,
  /אני שבור לחלוטין/,
  /כבר לא יכול יותר/,
  /אני קורס נפשית/,
];

const DISTRESS_PATTERNS_EN: RegExp[] = [
  /\b(complete|total) despair\b/i,
  /\bcan'?t (take|do) (it|this) any ?more\b/i,
  /\bno one to talk to\b/i,
  /\bbreaking down\b/i,
];

export function regexDistressCheck(input: string): DistressResult {
  if (!input || input.length < 3) return { hit: false };

  for (const re of CRISIS_PATTERNS_HE) {
    const m = input.match(re);
    if (m) return { hit: true, severity: "crisis", matched: m[0] };
  }
  for (const re of CRISIS_PATTERNS_EN) {
    const m = input.match(re);
    if (m) return { hit: true, severity: "crisis", matched: m[0] };
  }
  for (const re of DISTRESS_PATTERNS_HE) {
    const m = input.match(re);
    if (m) return { hit: true, severity: "distress", matched: m[0] };
  }
  for (const re of DISTRESS_PATTERNS_EN) {
    const m = input.match(re);
    if (m) return { hit: true, severity: "distress", matched: m[0] };
  }

  return { hit: false };
}
```

- [ ] **Step 4: Tests pass**

```powershell
npm test
```

- [ ] **Step 5: Commit**

```bash
git add lib/ai/safety/regex.ts tests/unit/safety-regex.test.ts
git commit -m "feat: regex distress pre-filter (Hebrew + English crisis and distress patterns)"
```

---

## Task 11: Sensitive-state LLM classifier

**Files:**
- Create: `lib/ai/safety/classifier.ts`

- [ ] **Step 1: Implement**

```ts
import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { anthropic, MODEL_ID } from "@/lib/ai/client";

const ClassificationSchema = z.object({
  category: z.enum(["safe", "distress", "crisis"]).describe(
    "safe = normal career question. distress = severe emotional pain without explicit ideation. crisis = explicit suicide / self-harm ideation.",
  ),
  reasoning: z.string().min(5).max(200),
});

export type Classification = z.infer<typeof ClassificationSchema>;

const SYSTEM = `You are a safety classifier for a Hebrew career-guidance chat app. You receive a single user message and classify whether it indicates emotional distress requiring handoff to mental-health resources, or it is a normal career question. Output structured JSON only.

Rules:
- "crisis" = the user expresses explicit ideation about suicide, self-harm, or wanting to die.
- "distress" = the user expresses severe emotional pain, hopelessness, or is in a clearly bad mental state, even without explicit ideation.
- "safe" = a normal career question, frustration with work, or general venting that is not severe.

When uncertain between safe and distress, lean toward distress. When uncertain between distress and crisis, lean toward crisis. Better a false positive than a missed signal.`;

export async function classifyMessage(userMessage: string): Promise<Classification> {
  const { object } = await generateObject({
    model: anthropic(MODEL_ID),
    system: SYSTEM,
    prompt: `User message:\n\n${userMessage}\n\nClassify.`,
    schema: ClassificationSchema,
    schemaName: "classify_safety",
  });
  return object;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai/safety/classifier.ts
git commit -m "feat: LLM-based safety classifier as backstop to regex"
```

---

## Task 12: Combined safety detector

**Files:**
- Create: `lib/ai/safety/index.ts`

- [ ] **Step 1: Implement**

```ts
import "server-only";
import { regexDistressCheck, type DistressResult } from "./regex";
import { classifyMessage, type Classification } from "./classifier";

export type SafetyDecision =
  | { allow: true; flag: null }
  | { allow: false; flag: "distress" | "crisis"; reason: string };

const FALSE_NEGATIVE_HEURISTIC_LENGTH = 80;

/**
 * Two-layer safety detector. Regex is the floor (legal protection). The LLM
 * classifier runs only when:
 *  - Regex is clean AND the message is unusually long (≥80 chars), giving more
 *    surface for the LLM to find missed signals; OR
 *  - Regex hit at "distress" severity (the LLM may upgrade to "crisis").
 *
 * Short messages with no regex hit are presumed safe and skip the LLM call
 * to avoid spending $0.001 on every "yes"/"כן" reply.
 */
export async function checkUserMessage(message: string): Promise<SafetyDecision> {
  const regex = regexDistressCheck(message);

  // Crisis from regex → done. Always block.
  if (regex.hit && regex.severity === "crisis") {
    return { allow: false, flag: "crisis", reason: `regex: ${regex.matched}` };
  }

  // Distress from regex → LLM classifier may upgrade.
  if (regex.hit && regex.severity === "distress") {
    const cls = await classifyMessage(message).catch(() => null);
    if (cls?.category === "crisis") {
      return { allow: false, flag: "crisis", reason: `regex+llm: ${regex.matched}` };
    }
    return { allow: false, flag: "distress", reason: `regex: ${regex.matched}` };
  }

  // No regex hit on a long enough message → check with LLM.
  if (message.length >= FALSE_NEGATIVE_HEURISTIC_LENGTH) {
    const cls = await classifyMessage(message).catch(() => null);
    if (cls?.category === "crisis") {
      return { allow: false, flag: "crisis", reason: `llm: ${cls.reasoning}` };
    }
    if (cls?.category === "distress") {
      return { allow: false, flag: "distress", reason: `llm: ${cls.reasoning}` };
    }
  }

  return { allow: true, flag: null };
}

export type { DistressResult, Classification };
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai/safety/index.ts
git commit -m "feat: combined safety detector — regex floor + LLM backstop"
```

---

## Task 13: Integrate stage tool + safety + extraction in chat route

**Files:**
- Modify: `app/api/chat/route.ts`

This is the integration step where everything connects. It's the largest change in Phase 2.

- [ ] **Step 1: Replace `app/api/chat/route.ts` content**

```ts
import { cookies } from "next/headers";
import { streamText, type UIMessage, type ModelMessage } from "ai";
import {
  anthropic,
  MODEL_ID,
  getCachedSystemMessage,
  extractAnthropicCacheUsage,
} from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getOrCreateConversation, appendMessage, loadMessages } from "@/lib/db/queries";
import { isValidStage, type Stage, EXTRACTION_STAGES } from "@/lib/ai/stages";
import { makeSetStageTool } from "@/lib/ai/tools";
import { updateConversationStage } from "@/lib/db/profile";
import { runExtraction } from "@/lib/ai/extraction";
import { checkUserMessage } from "@/lib/ai/safety";
import { he } from "@/lib/i18n/he";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACTIVE_CONVERSATION_COOKIE = "co_conv";
const ACTIVE_CONVERSATION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    conversationId?: string;
  };

  const cookieStore = await cookies();
  const cookieConversationId = cookieStore.get(ACTIVE_CONVERSATION_COOKIE)?.value;
  const incomingConversationId = body.conversationId ?? cookieConversationId;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);
  const conversation = await getOrCreateConversation(internalUserId, incomingConversationId);

  // Extract last user message
  const lastUserMessage = body.messages[body.messages.length - 1];
  const userText =
    lastUserMessage?.role === "user"
      ? lastUserMessage.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
      : "";

  // === SAFETY CHECK (must run on every user turn before any LLM call) ===
  if (userText) {
    const safety = await checkUserMessage(userText);
    if (!safety.allow) {
      // Persist the user's message + a system-routed assistant response with the safety flag.
      await appendMessage({
        conversationId: conversation.id,
        role: "user",
        content: userText,
        safetyFlag: safety.flag,
      });
      await appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: he.safety.distressFallback,
        safetyFlag: safety.flag,
      });
      console.warn("[chat] safety short-circuit", {
        conversationId: conversation.id,
        flag: safety.flag,
        reason: safety.reason,
      });

      // Manual SSE response — bypass streamText entirely.
      const text = he.safety.distressFallback;
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(`data: {"type":"start"}\n\n`));
          controller.enqueue(enc.encode(`data: {"type":"start-step"}\n\n`));
          controller.enqueue(enc.encode(`data: {"type":"text-start","id":"0"}\n\n`));
          controller.enqueue(
            enc.encode(`data: ${JSON.stringify({ type: "text-delta", id: "0", delta: text })}\n\n`),
          );
          controller.enqueue(enc.encode(`data: {"type":"text-end","id":"0"}\n\n`));
          controller.enqueue(enc.encode(`data: {"type":"finish-step"}\n\n`));
          controller.enqueue(enc.encode(`data: {"type":"finish"}\n\n`));
          controller.enqueue(enc.encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "x-conversation-id": conversation.id,
          "x-safety-flag": safety.flag,
        },
      });
    }

    // Safe — persist the user's message normally.
    await appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: userText,
    });
  }

  // === STAGE-AWARE LLM CALL ===
  const currentStage = isValidStage(conversation.stage) ? (conversation.stage as Stage) : "onboarding";

  // Track stage advancement triggered by tool use during this request.
  let advancedToStage: Stage | null = null;

  const setStageTool = makeSetStageTool({
    onAdvance: async (nextStage, reason) => {
      advancedToStage = nextStage;
      await updateConversationStage(conversation.id, nextStage);
      console.log("[chat] stage advanced", {
        conversationId: conversation.id,
        from: currentStage,
        to: nextStage,
        reason,
      });
    },
  });

  // Load full history from DB and build ModelMessages.
  const history = await loadMessages(conversation.id);
  const historyAsModelMessages: ModelMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const messages: ModelMessage[] = [
    getCachedSystemMessage(currentStage),
    ...historyAsModelMessages,
  ];

  const result = streamText({
    model: anthropic(MODEL_ID),
    messages,
    tools: { set_stage: setStageTool },
    onFinish: async ({ text, usage, providerMetadata }) => {
      const cache = extractAnthropicCacheUsage(providerMetadata);

      // Visibility: log token + cache usage once per turn so we know when caching engages.
      console.log("[chat] turn finished", {
        conversationId: conversation.id,
        stage: currentStage,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheRead: cache.cacheReadInputTokens ?? 0,
        cacheWrite: cache.cacheCreationInputTokens ?? 0,
      });

      await appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: text,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: cache.cacheReadInputTokens,
        cacheWriteTokens: cache.cacheCreationInputTokens,
      });

      // If the tool advanced the stage, kick off extraction asynchronously.
      // We do NOT await this — extraction shouldn't block the response.
      // The completed-from-stage is the one we extract for (the stage that just ended).
      if (advancedToStage && EXTRACTION_STAGES.has(currentStage)) {
        const stageJustCompleted = currentStage;
        runExtraction({
          userId: internalUserId,
          conversationId: conversation.id,
          stage: stageJustCompleted,
        })
          .then(() =>
            console.log("[chat] extraction done", {
              conversationId: conversation.id,
              stage: stageJustCompleted,
            }),
          )
          .catch((err) =>
            console.error("[chat] extraction failed", {
              conversationId: conversation.id,
              stage: stageJustCompleted,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
      }
    },
    onError: async ({ error }) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[chat] streamText error", { conversationId: conversation.id, error: message });
      await appendMessage({
        conversationId: conversation.id,
        role: "system",
        content: `[stream-error] ${message}`,
        safetyFlag: "stream-error",
      }).catch((err) => console.error("[chat] failed to persist error row", err));
    },
  });

  const setCookie = `${ACTIVE_CONVERSATION_COOKIE}=${conversation.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ACTIVE_CONVERSATION_MAX_AGE_SECONDS}${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;

  return result.toUIMessageStreamResponse({
    headers: {
      "x-conversation-id": conversation.id,
      "x-stage": currentStage,
      "Set-Cookie": setCookie,
    },
  });
}
```

- [ ] **Step 2: Verify**

```powershell
npx tsc --noEmit
npm test
```

Build + test must pass. Manual smoke test (with dev server): send a Hebrew distress message and verify the safety handoff fires (no LLM call, predefined fallback).

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: chat route — safety pre-check, stage tool-use, extraction trigger, cache logging"
```

---

## Task 14: Live verification — multi-turn with stage advancement

This is a smoke test, not a code change. Run by hand or have the controller dispatch.

- [ ] **Step 1: Start dev server**

```powershell
npm run dev
```

- [ ] **Step 2: Send a 5-turn Hebrew conversation via curl**

Use a cookie jar so all 5 turns share the same conversation. Sample turns to drive through 2 stage transitions:

1. "שלום, אני אריאל בן 23 אחרי שירות קרבי, מתלבט מה ללמוד" (onboarding)
2. "יש לי שנה לפני שאני מתחיל לעבוד" (still onboarding — should trigger transition to interests)
3. "מאוד אוהב טכנולוגיה אבל גם לעבוד עם אנשים, נמשך לפתרון בעיות" (interests)
4. "טוב במשא ומתן, מסדר אנשים, מבין מערכות מורכבות, סבלנות אפס לעבודה משעממת" (skills — should trigger interests→skills if turn 3 collected enough)
5. "כסף חשוב אבל גם משמעות. עצמאות חשובה לי. שייכות לצוות לא מאוד" (values)

After each turn, check Supabase to see if `conversations.stage` advanced and if `career_profile.data` got populated.

- [ ] **Step 3: Verify in Supabase via MCP**

Expected after turn ~5:
- `conversations.stage` ∈ {"interests", "skills", "values"}
- `career_profile.extraction_count` ≥ 1
- `career_profile.data.interests` is a populated array

- [ ] **Step 4: Test the safety path**

Send a Hebrew distress message:

```
"אני בייאוש מוחלט אין לי מי לדבר איתו, אני לא יודע מה לעשות יותר עם החיים שלי"
```

Expected:
- HTTP response includes `x-safety-flag` header set to `distress` or `crisis`
- Response body is the predefined `he.safety.distressFallback` text (not a real Claude call)
- `messages` table has the user row + assistant row both tagged `safety_flag = 'distress'`/'crisis'`
- Server log shows `[chat] safety short-circuit`

- [ ] **Step 5: Document findings in commit**

```bash
git commit --allow-empty -m "test: live verification of stage advancement + safety short-circuit (Phase 2 Task 14)"
```

(Empty commit just to anchor the verification in git history.)

---

## Task 15: Update CLAUDE.md with Phase 2 architecture

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "Phase 2 architecture" subsection** to CLAUDE.md describing:

- The 7-stage state machine and how transitions happen via `set_stage` tool-use
- The two-layer safety detector and that regex is the legal floor
- The extraction flow (separate Anthropic call at stage boundaries via `generateObject`)
- The `co_conv` cookie pattern (already documented if you read carefully — re-emphasize)
- The `career_profile` table schema and the `merge_career_profile` RPC
- New rule: "Never bypass the safety pre-check. If you're touching the chat route, the `checkUserMessage` call MUST run before any streamText call."

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md updated with Phase 2 architecture (stages, safety, extraction)"
```

---

## Phase 2 Definition of Done

- [ ] All 15 tasks complete; CI green
- [ ] Live test (Task 14) shows:
  - Conversation advances through at least 3 stages with one continuous cookie jar
  - `career_profile.data` has populated `interests` array after stage advancement
  - Safety handoff fires for an obvious distress message and no Claude call is made
  - Server log shows token + cache stats per turn
- [ ] At some point during testing, `cache_read_tokens > 0` is observed on at least one assistant turn (proves caching engages once we cross Sonnet 4.6's actual threshold)
- [ ] `npm test` passes (3+ test files, ≥ 12 tests passing)
- [ ] No `safety_flag = 'stream-error'` rows in normal usage
- [ ] CLAUDE.md updated

---

## Outlined for Phase 2.5 (UI polish — write detailed plan when we get there)

These are intentionally not bite-sized in this plan. Pre-writing them now will produce work that ages badly because we'll learn what users actually need from running the engine core in production.

- **"What I heard from you" mirror screen**: a sidebar or panel that renders `career_profile.data` live as it accrues, so users can see what the agent thinks it knows about them and correct misunderstandings.
- **5 tone presets**: dropdown in chat header that maps to a tone modifier appended to the system prompt (gentle / balanced / direct / mentor / pure-tachles).
- **Tachles / Support mode toggle**: a single boolean that toggles between two operating modes (concise/practical vs. supportive/exploratory).
- **Stage progress indicator**: a small visual showing onboarding → interests → ... → wrap, with the current stage highlighted.
- **"New chat" button**: clears the `co_conv` cookie and starts a fresh conversation.
- **Conversation history list**: shows the user's prior conversations (signed-in users only — anonymous users see only their current cookie-tracked conversation).

---

## Risks specific to Phase 2

| Risk | Mitigation |
|---|---|
| Claude calls `set_stage` too aggressively (after 1-2 turns per stage) | Stage prompts include explicit "don't transition before [N criteria met]"; spot-check via Task 14 live test; add per-stage minimum-turn gate if needed |
| Claude never calls `set_stage` (gets stuck in onboarding forever) | Stage prompts include explicit transition criteria + "after [N turns] consider whether the stage is complete"; if still stuck, add fallback transition heuristic |
| Extraction returns garbage JSON or doesn't fit schema | `generateObject` with zod schema rejects bad output; Anthropic retries internally; if persistent, log the raw text and skip the extraction (don't block the user's chat) |
| Safety regex false positives — flag normal career complaints as distress | Tests cover known false positives; severity tiering means low-severity matches go through LLM classifier which can downgrade |
| Safety regex false negatives — miss distress phrasings the user uses | LLM backstop on long messages catches some; expand regex over time as we see misses; the LLM call is the safety net |
| Tool-use latency adds noticeable delay vs. simple text response | Tool-use only fires when Claude judges stage complete (not every turn); extraction runs async after stream finishes |
| Cookie-based active conversation surprises users on new tab | Acceptable for v1; "new chat" button is Phase 2.5 |

---

## When Phase 2 is done

Open `2026-05-10-career-os-00-master-roadmap.md` §4 Phase 3 and ask me to write `2026-05-10-career-os-03-formal-assessments.md`. By then we'll have engine + extraction running, which makes Phase 3's RIASEC/Big5 questionnaires dramatically easier to design (we know what data we already have and what gaps remain).
