# CareerOS — Phase 5b: 30-Day Action Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Turn a user's 3-paths recommendation into a checkable 30-day action plan. Picks an archetype (research / taste-test / project / network / apply) based on the user's profile, customizes the day-by-day tasks via one LLM call, persists them, and renders a `/plan` page where the user can check off completed tasks. The plan is the **behavior-change tool** — recommendations alone don't change anything; a checklist with specific actions per day does.

**Architecture:** Plan generation triggers from `/recommendations` ("צור תוכנית 30 יום" button next to Download PDF). On-demand: server picks the right archetype based on the user's top-1 path (safe → "apply", growth → "taste-test", wildcard → "research"), feeds the template + user's profile + top-1 path to Claude via `generateObject` with a zod schema, persists the 30 tasks into a `plan_tasks` table (one row per task), returns the plan. The `/plan` page lists tasks grouped by week with checkboxes; each toggle is an optimistic UI update + `POST /api/plan/tasks/[id]/toggle`.

**Tech Stack:** Builds on Phase 5a (PDF) + Phase 4 (recommendations). New: nothing — reuses Anthropic via `lib/ai/client.ts`, Supabase, zod, shadcn checkbox.

---

## 1. Decisions baked into this plan

| Decision | Choice | Why |
|---|---|---|
| Granularity | **30 tasks, one per day** | Not "weekly buckets" — daily tasks feel actionable, even if most days are 10-min check-ins. |
| Task storage | **Separate `plan_tasks` table** (one row per task) | Toggling completion is an UPDATE on one row — atomic, no race conditions. JSONB would force read-modify-write of a 30-item array per toggle. |
| Plan-to-recommendation FK | **`plans` table has `recommendation_id`** | One plan per recommendation. If user regenerates recommendations, they need to regenerate the plan (the old one is stale anyway). |
| Trigger | **On-demand from `/recommendations`** | Same pattern as PDF download. Don't pre-generate — most users won't ask for a plan in the first session. |
| Archetype selection | **Auto-picked from top-1 path** | Safe path → "apply" (refine resume, apply to 5 roles). Growth path → "taste-test" (do a short course, try a project). Wildcard path → "research" (read 3 books, talk to 5 people). Deterministic; user can re-roll later if Phase 5b.5 polish adds that. |
| LLM call | **`generateObject` with zod, 30-task schema** | Same pattern as profile extraction (Phase 2) and prose generator (Phase 4). Prompt-cached system message. |
| Task fields | **`day`, `title_he`, `description_he`, `category`, `estimated_minutes`, `done`** | `category` = action / research / network / reflection. Used to filter UI views. |
| Authorization | **Anonymous-OK** | Same anon-first principle. Plans stored against internal `user_id`. |
| UI | **`/plan` page**, week-grouped lists | 4 weeks of 7 tasks + 2 final tasks. Renders as 5 cards/sections. Checkbox + optimistic toggle. |
| Empty state | **If no recommendation, redirect to `/recommendations`** | Can't generate plan without paths to plan toward. |
| Regenerate behavior | **Discards old plan, generates fresh** | When recommendations regenerate (new profile_hash), the old plan is invalid. User confirms via toast before regenerate. |

**Out of scope (Phase 5c / later):**
- Email reminders ("today's task: ...")
- Plan version history (we keep the latest only)
- Custom task add/edit by user
- Sharing the plan
- Plan included in the PDF report (Phase 5c polish)
- Multiple archetypes per plan (currently single archetype per plan)

---

## 2. Architectural notes

### 2.1 Why one-row-per-task and not JSONB
A 30-item JSONB array can't be atomically toggled. UPDATE one task = read full row, modify array, write full row. Two concurrent toggles race. Separate rows make each toggle an `UPDATE plan_tasks SET done = $1 WHERE id = $2 AND user_id = $3` — atomic, fast, RLS-clean.

### 2.2 Archetype selection logic
- If `paths.safe` is non-null → user has a low-risk close-fit role available → **"apply"** archetype: refine resume, prepare for interviews, apply to 5 roles, network within the field.
- Else if `paths.growth` is non-null → user wants stretch with a moderate runway → **"taste-test"** archetype: take a short course, do a hands-on project, interview 5 practitioners.
- Else (only wildcard or nothing) → user is exploring → **"research"** archetype: read 3 books in the field, talk to 5 people, attend 2 events, write a reflection.

Edge case: all paths null → no plan generated, route returns 400. (Shouldn't happen if user came from `/recommendations` which only renders when paths exist.)

### 2.3 LLM prompt structure
System prompt is cached (per Phase 4's mandatory pattern). It describes the archetype, the constraint that each task is 1-day with a clear action, Hebrew tone, no clinical language. User message contains: the archetype name, the user's top-1 path (occupation title + Hebrew prose from Phase 4), the user's profile summary, and the user's constraints (so tasks respect their time/budget). The model returns 30 tasks via zod schema.

### 2.4 Why no LLM call on toggle
Toggling completion is pure state. No regeneration. Phase 5b.5 polish could add "I'm stuck on this task" → LLM suggests an alternative, but not Phase 5b.

### 2.5 Cache strategy
- The 30 generated tasks live in `plan_tasks`, keyed by `plan_id` (and a `plans` row references the `recommendation_id`).
- If the user's `recommendation_id` is the same on next visit → plan reused. UI shows the existing plan, not "generate".
- If user regenerates recommendations → new `recommendation_id` → old plan is no longer linked to current recommendation → UI prompts "your plan is from older recommendations, generate a fresh one?".

### 2.6 Disclaimer
The plan is "אינו תחליף לייעוץ מקצועי". Disclaimer footer on `/plan` matches the rest of the project.

---

## 3. File structure (target end-state)

```
lib/plan/                                   # NEW
├── archetypes.ts                           # 5 archetype constants + Hebrew descriptions
├── templates.ts                            # archetype → 30-task scaffold (titles only, LLM customizes)
├── compose.ts                              # LLM call: archetype + profile + path → 30 tasks
├── types.ts                                # PlanTask, Plan, Archetype types
└── selectArchetype.ts                      # pure function: paths → archetype

lib/db/
└── plans.ts                                # createPlan, getLatestPlan, toggleTask

app/api/plan/                               # NEW directory
├── generate/route.ts                       # POST: generate fresh plan
├── route.ts                                # GET: latest plan for user
└── tasks/[id]/toggle/route.ts              # POST: toggle a task's done state

app/(app)/plan/page.tsx                     # NEW: checkable task list

components/plan/                            # NEW
├── PlanClient.tsx                          # client component: fetches, renders, toggles
├── WeekSection.tsx                         # one week of tasks
├── PlanTaskRow.tsx                         # single task with checkbox
└── PlanEmptyState.tsx

components/recommendations/
└── RecommendationsClient.tsx               # MODIFIED: add "צור תוכנית 30 יום" button

lib/i18n/he.ts                              # MODIFIED: + plan.* section

supabase/migrations/
└── <timestamp>_plans.sql                   # plans + plan_tasks tables
```

---

## 4. Pre-flight

- [ ] Confirm Phase 5a is on `feat/phase-5a-pdf-report` and PR #3 is open
- [ ] Branch from `feat/phase-5a-pdf-report`: `git checkout -b feat/phase-5b-30-day-plan`
- [ ] A recommendation exists in DB to test against

---

## Task 1: Migration — `plans` + `plan_tasks`

**Files:**
- Create: `supabase/migrations/<timestamp>_plans.sql`

- [ ] **Step 1: Generate migration**

```powershell
npx supabase migration new plans
```

- [ ] **Step 2: SQL**

```sql
create type public.plan_archetype as enum ('apply', 'taste_test', 'research');

create type public.plan_task_category as enum ('action', 'research', 'network', 'reflection');

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  recommendation_id uuid not null references public.recommendations(id) on delete cascade,
  archetype public.plan_archetype not null,
  generated_at timestamptz not null default now()
);

create index plans_user_generated_idx on public.plans(user_id, generated_at desc);
create index plans_recommendation_idx on public.plans(recommendation_id);

create table public.plan_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  day int not null check (day between 1 and 30),
  title_he text not null,
  description_he text not null,
  category public.plan_task_category not null,
  estimated_minutes int not null check (estimated_minutes > 0 and estimated_minutes <= 480),
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index plan_tasks_plan_day_idx on public.plan_tasks(plan_id, day);
create index plan_tasks_plan_done_idx on public.plan_tasks(plan_id, done);

alter table public.plans enable row level security;
alter table public.plan_tasks enable row level security;

create policy plans_self on public.plans
  for all using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );

create policy plan_tasks_self on public.plan_tasks
  for all using (
    plan_id in (
      select id from public.plans p
      where p.user_id in (select id from public.users where auth_id = auth.uid())
    )
  );
```

- [ ] **Step 3: Apply via Supabase MCP** (use `mcp__claude_ai_Supabase__apply_migration` with project_id `wqswamtcppjmkwykukjp`).

- [ ] **Step 4: Regenerate types** via MCP, overwrite `lib/db/types.gen.ts`.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations lib/db/types.gen.ts
git commit -m "feat(db): plans + plan_tasks tables with per-user RLS"
```

---

## Task 2: Archetype + types + selector

**Files:**
- Create: `lib/plan/types.ts`
- Create: `lib/plan/archetypes.ts`
- Create: `lib/plan/selectArchetype.ts`

- [ ] **Step 1: `lib/plan/types.ts`**

```ts
export const ARCHETYPES = ["apply", "taste_test", "research"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const TASK_CATEGORIES = ["action", "research", "network", "reflection"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export type PlanTask = {
  id: string;
  day: number;             // 1..30
  title_he: string;
  description_he: string;
  category: TaskCategory;
  estimated_minutes: number;
  done: boolean;
  done_at: string | null;
};

export type Plan = {
  id: string;
  recommendation_id: string;
  archetype: Archetype;
  generated_at: string;
  tasks: PlanTask[];
};
```

- [ ] **Step 2: `lib/plan/archetypes.ts`**

```ts
import type { Archetype } from "./types";

export const ARCHETYPE_INTENT_HE: Record<Archetype, string> = {
  apply: "אתה מוכן להתחיל לעבוד בכיוון. ב-30 הימים האלה תחזק את הנכסים, תתחיל למפות הזדמנויות אמיתיות, ותגיש מועמדות.",
  taste_test: "אתה רוצה לטעום מהכיוון לפני שמשקיעים בגדול. ב-30 הימים האלה תרכוש ידע ראשוני, תעשה פרויקט קטן, ותדבר עם אנשים בתחום.",
  research: "אתה עוד בודק את הכיוון. ב-30 הימים האלה תקרא, תאזין לפודקאסטים, תפגוש אנשים, ותכתוב מה למדת.",
};

export const ARCHETYPE_TITLE_HE: Record<Archetype, string> = {
  apply: "תוכנית מעשית: להתחיל לעבוד",
  taste_test: "תוכנית טעימה: לבדוק את הכיוון",
  research: "תוכנית חקר: ללמוד את הכיוון",
};
```

- [ ] **Step 3: `lib/plan/selectArchetype.ts`**

```ts
import type { Paths } from "@/lib/matching/types";
import type { Archetype } from "./types";

export function selectArchetype(paths: Paths): Archetype | null {
  if (paths.safe) return "apply";
  if (paths.growth) return "taste_test";
  if (paths.wildcard) return "research";
  return null;
}
```

- [ ] **Step 4: TS + commit**

```powershell
npx tsc --noEmit
git add lib/plan
git commit -m "feat(plan): archetypes, types, and selectArchetype helper"
```

---

## Task 3: LLM compose call

**Files:**
- Create: `lib/plan/compose.ts`

- [ ] **Step 1: Write the composer**

```ts
import "server-only";
import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import { anthropic, MODEL_ID } from "@/lib/ai/client";
import type { Archetype, TaskCategory } from "./types";
import { ARCHETYPE_INTENT_HE } from "./archetypes";
import type { Ranking, Occupation, MatchingProfile } from "@/lib/matching/types";
import { TASK_CATEGORIES } from "./types";

const TaskSchema = z.object({
  day: z.number().int().min(1).max(30),
  title_he: z.string().min(8).max(80),
  description_he: z.string().min(20).max(280),
  category: z.enum(TASK_CATEGORIES),
  estimated_minutes: z.number().int().min(10).max(240),
});

const ComposeSchema = z.object({
  tasks: z.array(TaskSchema).length(30),
});

export type ComposedTask = z.infer<typeof TaskSchema>;

const SYSTEM_PROMPT = `אתה כותב תוכנית פעולה של 30 יום בעברית עבור משתמש שקיבל המלצת קריירה. הוא בחר מסלול מסוים, ואתה מקבל את הפרופיל שלו ואת המקצוע הראשי.

החוקים שלך:
1. בדיוק 30 משימות, יום אחד לכל משימה.
2. כל משימה היא פעולה ספציפית שאפשר לסיים ביום אחד. לא "תחקור" — אלא "צפה ב-2 ראיונות בפודקאסט X" או "כתוב פסקה על מה שעניין אותך".
3. כל משימה מקבלת estimated_minutes (10-240).
4. category: action / research / network / reflection.
5. בנה התקדמות: השבוע הראשון בעיקר research/reflection, אמצע research/action, סוף בעיקר action/network.
6. השתמש בנתוני המשתמש (כישורים, ערכים, אילוצים) כדי להפוך את המשימות אישיות. עדיף לצטט מילים שלו אם אפשר.
7. אל תהיה גנרי. אל תכתוב "צור CV" — כתוב "עדכן את הסקשן 'ניסיון' ב-CV שלך עם תפקיד אחד מהשירות הצבאי בצורה שמתאימה ל[מקצוע]".
8. אל תכלול עברית רפואית/קלינית. אל תאבחן.`;

export async function composePlan(args: {
  archetype: Archetype;
  topOccupation: Occupation;
  topRanking: Ranking;
  topProse: string | null;
  profile: MatchingProfile;
}): Promise<ComposedTask[]> {
  const userContext = {
    archetype: args.archetype,
    archetype_intent: ARCHETYPE_INTENT_HE[args.archetype],
    top_occupation: {
      id: args.topOccupation.id,
      title_he: args.topOccupation.title_he,
      description_he: args.topOccupation.description_he,
    },
    why_this_role_he: args.topProse,
    profile: args.profile,
  };

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    {
      role: "user",
      content: `בנה לי תוכנית 30 יום עם הנתונים הבאים:\n${JSON.stringify(userContext, null, 2)}`,
    },
  ];

  const result = await generateObject({
    model: anthropic(MODEL_ID),
    schema: ComposeSchema,
    messages,
  });

  return result.object.tasks;
}
```

- [ ] **Step 2: TS + commit**

```powershell
npx tsc --noEmit
git add lib/plan/compose.ts
git commit -m "feat(plan): LLM compose call with archetype-aware 30-task generation"
```

---

## Task 4: DB layer

**Files:**
- Create: `lib/db/plans.ts`

- [ ] **Step 1: Write the queries**

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Plan, PlanTask, Archetype } from "@/lib/plan/types";
import type { ComposedTask } from "@/lib/plan/compose";

export async function createPlan(args: {
  userId: string;
  recommendationId: string;
  archetype: Archetype;
  tasks: ComposedTask[];
}): Promise<Plan> {
  const svc = createServiceClient();

  // Delete any previous plan for this recommendation
  await svc.from("plans").delete().eq("recommendation_id", args.recommendationId);

  const { data: planRow, error: planErr } = await svc
    .from("plans")
    .insert({
      user_id: args.userId,
      recommendation_id: args.recommendationId,
      archetype: args.archetype,
    })
    .select()
    .single();
  if (planErr || !planRow) throw planErr ?? new Error("plan insert failed");

  const taskRows = args.tasks.map((t) => ({
    plan_id: planRow.id,
    day: t.day,
    title_he: t.title_he,
    description_he: t.description_he,
    category: t.category,
    estimated_minutes: t.estimated_minutes,
  }));
  const { data: insertedTasks, error: tasksErr } = await svc
    .from("plan_tasks")
    .insert(taskRows)
    .select();
  if (tasksErr) throw tasksErr;

  return {
    id: planRow.id,
    recommendation_id: planRow.recommendation_id,
    archetype: planRow.archetype as Archetype,
    generated_at: planRow.generated_at,
    tasks: (insertedTasks ?? []).map(rowToTask).sort((a, b) => a.day - b.day),
  };
}

export async function getLatestPlan(userId: string): Promise<Plan | null> {
  const svc = createServiceClient();
  const { data: planRow } = await svc
    .from("plans")
    .select("*")
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!planRow) return null;

  const { data: taskRows, error } = await svc
    .from("plan_tasks")
    .select("*")
    .eq("plan_id", planRow.id)
    .order("day", { ascending: true });
  if (error) throw error;

  return {
    id: planRow.id,
    recommendation_id: planRow.recommendation_id,
    archetype: planRow.archetype as Archetype,
    generated_at: planRow.generated_at,
    tasks: (taskRows ?? []).map(rowToTask),
  };
}

export async function toggleTask(args: {
  userId: string;
  taskId: string;
  done: boolean;
}): Promise<{ done: boolean; done_at: string | null }> {
  const svc = createServiceClient();
  // Verify ownership via the plan
  const { data: taskRow, error: readErr } = await svc
    .from("plan_tasks")
    .select("plan_id, plans!inner(user_id)")
    .eq("id", args.taskId)
    .single();
  if (readErr) throw readErr;
  const plan = (taskRow as unknown as { plans: { user_id: string } }).plans;
  if (plan.user_id !== args.userId) throw new Error("forbidden");

  const { data, error } = await svc
    .from("plan_tasks")
    .update({ done: args.done, done_at: args.done ? new Date().toISOString() : null })
    .eq("id", args.taskId)
    .select("done, done_at")
    .single();
  if (error) throw error;
  return { done: data.done, done_at: data.done_at };
}

function rowToTask(row: {
  id: string; day: number; title_he: string; description_he: string;
  category: string; estimated_minutes: number; done: boolean; done_at: string | null;
}): PlanTask {
  return {
    id: row.id,
    day: row.day,
    title_he: row.title_he,
    description_he: row.description_he,
    category: row.category as PlanTask["category"],
    estimated_minutes: row.estimated_minutes,
    done: row.done,
    done_at: row.done_at,
  };
}
```

- [ ] **Step 2: TS + commit**

```powershell
npx tsc --noEmit
git add lib/db/plans.ts
git commit -m "feat(db): plans queries — createPlan, getLatestPlan, toggleTask"
```

---

## Task 5: API — POST /api/plan/generate

**Files:**
- Create: `app/api/plan/generate/route.ts`

```ts
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { loadAllOccupations } from "@/lib/db/occupations";
import { selectArchetype } from "@/lib/plan/selectArchetype";
import { composePlan } from "@/lib/plan/compose";
import { createPlan } from "@/lib/db/plans";
import { getProfile } from "@/lib/db/profile";
import { buildMatchingProfile } from "@/lib/matching/profile";
import type { Ranking, Paths } from "@/lib/matching/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const internalUserId = await getOrCreateAnonymousUserId(user?.id);

    const svc = createServiceClient();
    const { data: rec } = await svc
      .from("recommendations")
      .select("id, rankings, paths")
      .eq("user_id", internalUserId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!rec) {
      return Response.json({ error: "no_recommendation" }, { status: 400 });
    }

    const rankings = rec.rankings as unknown as Ranking[];
    const paths = rec.paths as unknown as Paths;
    const archetype = selectArchetype(paths);
    if (!archetype) {
      return Response.json({ error: "no_path_available" }, { status: 400 });
    }

    // Top occupation = the one matching the chosen archetype's path slot,
    // not necessarily the highest-ranked overall.
    const targetSlotId =
      archetype === "apply" ? paths.safe :
      archetype === "taste_test" ? paths.growth :
      paths.wildcard;
    const topRanking = rankings.find((r) => r.occupation_id === targetSlotId) ?? rankings[0];
    if (!topRanking) {
      return Response.json({ error: "no_ranking" }, { status: 400 });
    }

    const occupations = await loadAllOccupations();
    const topOccupation = occupations.find((o) => o.id === topRanking.occupation_id);
    if (!topOccupation) {
      return Response.json({ error: "occupation_not_found" }, { status: 400 });
    }

    // Load profile for personalization (mirrors loadReportData)
    const { data: convs } = await svc
      .from("conversations")
      .select("id")
      .eq("user_id", internalUserId)
      .order("updated_at", { ascending: false })
      .limit(1);
    const conversationId = convs?.[0]?.id;
    let rawProfile = null as Awaited<ReturnType<typeof getProfile>> | null;
    if (conversationId) {
      rawProfile = await getProfile(internalUserId, conversationId).catch(() => null);
    }
    type RawProfileParam = Parameters<typeof buildMatchingProfile>[0];
    const profile = buildMatchingProfile(rawProfile as RawProfileParam);

    // Look up the prose for the top role from the recommendation
    const { data: recProse } = await svc
      .from("recommendations")
      .select("prose")
      .eq("id", rec.id)
      .single();
    const proseMap = (recProse?.prose as unknown as Record<string, string> | null) ?? null;
    const topProse = proseMap?.[topOccupation.id] ?? null;

    const tasks = await composePlan({
      archetype,
      topOccupation,
      topRanking,
      topProse,
      profile,
    });

    const plan = await createPlan({
      userId: internalUserId,
      recommendationId: rec.id,
      archetype,
      tasks,
    });

    return Response.json(plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[plan/generate] error", { message });
    return Response.json({ error: "generate_failed", message }, { status: 500 });
  }
}
```

- [ ] **Step 2: TS + build + commit**

```powershell
npx tsc --noEmit
npm run build
git add app/api/plan/generate/route.ts
git commit -m "feat(api): POST /api/plan/generate composes archetype-driven 30-task plan"
```

---

## Task 6: API — GET /api/plan + POST /api/plan/tasks/[id]/toggle

**Files:**
- Create: `app/api/plan/route.ts`
- Create: `app/api/plan/tasks/[id]/toggle/route.ts`

- [ ] **Step 1: GET route**

`app/api/plan/route.ts`:
```ts
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getLatestPlan } from "@/lib/db/plans";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);
  const plan = await getLatestPlan(internalUserId);
  return Response.json(plan);
}
```

- [ ] **Step 2: Toggle route**

`app/api/plan/tasks/[id]/toggle/route.ts`:
```ts
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { toggleTask } from "@/lib/db/plans";

export const runtime = "nodejs";

const BodySchema = z.object({ done: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const internalUserId = await getOrCreateAnonymousUserId(user?.id);
    const result = await toggleTask({ userId: internalUserId, taskId: id, done: parsed.data.done });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
    return Response.json({ error: "toggle_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: TS + build + commit**

```powershell
npx tsc --noEmit
npm run build
git add app/api/plan
git commit -m "feat(api): GET /api/plan and POST /api/plan/tasks/[id]/toggle"
```

---

## Task 7: i18n strings for plan

**Files:**
- Modify: `lib/i18n/he.ts` — add `plan` section after `report`:

```ts
  plan: {
    title: "תוכנית 30 יום",
    subtitle: "המסלול שבחרת מתורגם לפעולות יומיות. סמן מה שעשית, חזור מתי שצריך.",
    archetypeTitles: {
      apply: "תוכנית מעשית: להתחיל לעבוד",
      taste_test: "תוכנית טעימה: לבדוק את הכיוון",
      research: "תוכנית חקר: ללמוד את הכיוון",
    },
    weekHeading: "שבוע {n}",
    dayLabel: "יום {n}",
    minutesLabel: "{n} דקות",
    categoryLabels: {
      action: "פעולה",
      research: "מחקר",
      network: "נטוורקינג",
      reflection: "חשיבה",
    },
    generate: "צור תוכנית 30 יום",
    generating: "יוצר תוכנית… (עד דקה)",
    regenerate: "צור תוכנית חדשה",
    regenerateConfirm: "התוכנית הקיימת תוחלף בחדשה. להמשיך?",
    emptyState: {
      title: "אין עוד תוכנית",
      body: "כדי לקבל תוכנית 30 יום, קבל קודם המלצות.",
      cta: "עבור להמלצות",
    },
    error: {
      generic: "לא הצלחנו ליצור תוכנית כרגע. נסה שוב בעוד רגע.",
      noRecommendation: "אין המלצות. עבור קודם להמלצות.",
    },
    completed: "הושלם",
  },
```

- [ ] **Commit**

```powershell
git add lib/i18n/he.ts
git commit -m "feat(i18n): plan Hebrew strings"
```

---

## Task 8: UI — components

**Files:**
- Create: `components/plan/PlanTaskRow.tsx`
- Create: `components/plan/WeekSection.tsx`
- Create: `components/plan/PlanEmptyState.tsx`
- Create: `components/plan/PlanClient.tsx`

### `PlanTaskRow.tsx`
```tsx
"use client";
import { useState } from "react";
import { he } from "@/lib/i18n/he";
import type { PlanTask } from "@/lib/plan/types";

export function PlanTaskRow({ task, onToggle }: { task: PlanTask; onToggle: (done: boolean) => Promise<void> }) {
  const [done, setDone] = useState(task.done);
  const [pending, setPending] = useState(false);
  const categoryLabel = he.plan.categoryLabels[task.category];
  const minutesLabel = he.plan.minutesLabel.replace("{n}", String(task.estimated_minutes));
  const dayLabel = he.plan.dayLabel.replace("{n}", String(task.day));

  const handleToggle = async () => {
    const next = !done;
    setDone(next);
    setPending(true);
    try {
      await onToggle(next);
    } catch {
      setDone(!next); // rollback on error
    } finally {
      setPending(false);
    }
  };

  return (
    <li className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${done ? "bg-muted/50 text-muted-foreground" : "bg-card"}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? he.plan.completed : task.title_he}
        onClick={handleToggle}
        disabled={pending}
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
          done ? "border-primary bg-primary text-primary-foreground" : "border-input hover:border-primary"
        }`}
      >
        {done && <span aria-hidden>✓</span>}
      </button>
      <div className="flex-1 space-y-1">
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>{dayLabel}</span>
          <span>{categoryLabel} · {minutesLabel}</span>
        </div>
        <div className={`text-base font-medium ${done ? "line-through" : ""}`} dir="auto">{task.title_he}</div>
        <p className="text-sm" dir="auto">{task.description_he}</p>
      </div>
    </li>
  );
}
```

### `WeekSection.tsx`
```tsx
"use client";
import { he } from "@/lib/i18n/he";
import { PlanTaskRow } from "./PlanTaskRow";
import type { PlanTask } from "@/lib/plan/types";

export function WeekSection({
  weekNumber,
  tasks,
  onToggle,
}: {
  weekNumber: number;
  tasks: PlanTask[];
  onToggle: (taskId: string, done: boolean) => Promise<void>;
}) {
  const heading = he.plan.weekHeading.replace("{n}", String(weekNumber));
  const completed = tasks.filter((t) => t.done).length;
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between border-b pb-2">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <span className="text-sm text-muted-foreground">{completed} / {tasks.length}</span>
      </header>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <PlanTaskRow key={t.id} task={t} onToggle={(done) => onToggle(t.id, done)} />
        ))}
      </ul>
    </section>
  );
}
```

### `PlanEmptyState.tsx`
```tsx
import Link from "next/link";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";

export function PlanEmptyState() {
  const t = he.plan.emptyState;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center">
      <h2 className="text-xl font-semibold">{t.title}</h2>
      <p className="text-sm text-muted-foreground">{t.body}</p>
      <Button asChild><Link href="/recommendations">{t.cta}</Link></Button>
    </div>
  );
}
```

### `PlanClient.tsx`
```tsx
"use client";
import { useEffect, useState } from "react";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";
import { WeekSection } from "./WeekSection";
import { PlanEmptyState } from "./PlanEmptyState";
import { toast } from "sonner";
import type { Plan } from "@/lib/plan/types";

export function PlanClient() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchPlan = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/plan");
      if (res.ok) {
        const json = await res.json();
        setPlan(json);
      }
    } finally {
      setLoading(false);
    }
  };

  const generate = async (confirm = true) => {
    if (plan && confirm && !window.confirm(he.plan.regenerateConfirm)) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/plan/generate", { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error === "no_recommendation" ? he.plan.error.noRecommendation : he.plan.error.generic);
        setGenerating(false);
        return;
      }
      const json = await res.json();
      setPlan(json);
    } catch {
      toast.error(he.plan.error.generic);
    }
    setGenerating(false);
  };

  const toggleTask = async (taskId: string, done: boolean): Promise<void> => {
    const res = await fetch(`/api/plan/tasks/${taskId}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    if (!res.ok) throw new Error("toggle failed");
    if (plan) {
      setPlan({
        ...plan,
        tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, done } : t)),
      });
    }
  };

  useEffect(() => { fetchPlan(); }, []);

  if (loading) return <div className="py-16 text-center text-muted-foreground">…</div>;

  if (!plan) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border bg-card p-6 text-center">
          <p className="mb-4 text-base text-muted-foreground">{he.plan.subtitle}</p>
          <Button size="lg" onClick={() => generate(false)} disabled={generating}>
            {generating ? he.plan.generating : he.plan.generate}
          </Button>
        </div>
      </div>
    );
  }

  // Group tasks into weeks of 7 (days 1-7, 8-14, 15-21, 22-28, 29-30)
  const weeks: { number: number; tasks: typeof plan.tasks }[] = [
    { number: 1, tasks: plan.tasks.filter((t) => t.day >= 1 && t.day <= 7) },
    { number: 2, tasks: plan.tasks.filter((t) => t.day >= 8 && t.day <= 14) },
    { number: 3, tasks: plan.tasks.filter((t) => t.day >= 15 && t.day <= 21) },
    { number: 4, tasks: plan.tasks.filter((t) => t.day >= 22 && t.day <= 28) },
    { number: 5, tasks: plan.tasks.filter((t) => t.day >= 29 && t.day <= 30) },
  ];

  const archetypeTitle = he.plan.archetypeTitles[plan.archetype];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{archetypeTitle}</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => generate(true)} disabled={generating}>
          {generating ? he.plan.generating : he.plan.regenerate}
        </Button>
      </div>
      {weeks.map((w) => (
        <WeekSection key={w.number} weekNumber={w.number} tasks={w.tasks} onToggle={toggleTask} />
      ))}
    </div>
  );
}
```

- [ ] **TS + commit**

```powershell
npx tsc --noEmit
git add components/plan
git commit -m "feat(ui): plan components (TaskRow, WeekSection, EmptyState, Client)"
```

---

## Task 9: Page — `/plan`

**Files:**
- Create: `app/(app)/plan/page.tsx`

```tsx
import { he } from "@/lib/i18n/he";
import { PlanClient } from "@/components/plan/PlanClient";

export const dynamic = "force-dynamic";

export default function PlanPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{he.plan.title}</h1>
        <p className="text-base text-muted-foreground">{he.plan.subtitle}</p>
      </header>
      <PlanClient />
    </div>
  );
}
```

- [ ] **Build + commit**

```powershell
npx tsc --noEmit
npm run build
git add "app/(app)/plan/page.tsx"
git commit -m "feat(ui): /plan page with PlanClient"
```

---

## Task 10: Link from `/recommendations` to `/plan`

**Files:**
- Modify: `components/recommendations/RecommendationsClient.tsx`

Add a "צור תוכנית 30 יום" button alongside the existing PDF download button. The button is a `<Link href="/plan">` (or `Button asChild`).

The existing PDF download row is:
```tsx
{data.rankings.length > 0 && (
  <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
    <div className="text-muted-foreground">{he.report.title}</div>
    <Button asChild size="sm" variant="outline">
      <a href="/api/report/pdf" download>{he.recommendations.downloadPdf}</a>
    </Button>
  </div>
)}
```

Change to two buttons in the row:
```tsx
{data.rankings.length > 0 && (
  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm">
    <div className="text-muted-foreground">{he.report.title}</div>
    <div className="flex gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href="/plan">{he.plan.generate}</Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href="/api/report/pdf" download>{he.recommendations.downloadPdf}</a>
      </Button>
    </div>
  </div>
)}
```

Add `import Link from "next/link";` at the top if not already present.

- [ ] **TS + commit**

```powershell
npx tsc --noEmit
git add components/recommendations/RecommendationsClient.tsx
git commit -m "feat(ui): add 'Generate 30-day plan' button on /recommendations"
```

---

## Task 11: Final review + manual E2E + push + PR

- [ ] Run final review subagent on the diff against `feat/phase-5a-pdf-report`
- [ ] Manual E2E: visit /recommendations → click "צור תוכנית 30 יום" → /plan loads → click generate → wait ~30-45s → 30 tasks render in 5 week sections → toggle a few tasks → verify persistence (reload, tasks stay toggled)
- [ ] Update CLAUDE.md with Phase 5b architecture notes
- [ ] Push branch + open PR targeting `feat/phase-5a-pdf-report`

---

## Definition of Done

- [ ] Migration applied; `plans` and `plan_tasks` tables exist
- [ ] Generate endpoint produces 30 tasks via Claude
- [ ] /plan page renders weeks with checkable tasks
- [ ] Toggle persists across reload
- [ ] Tasks reference user-specific details (name, occupation, profile facts) rather than generic content
- [ ] `npx tsc --noEmit` clean, `npm run build` succeeds
- [ ] CLAUDE.md updated
- [ ] PR opened

---

## Known follow-ups (Phase 5c / later)

1. **Email reminders**: daily/weekly nudge "today's task: X". Needs email (Resend) + cron.
2. **Plan included in PDF**: Phase 5c polish.
3. **Plan re-roll without losing existing progress**: regen creates new plan, can show both?
4. **Custom tasks**: user can add or edit a task.
5. **Multiple plans per user** (e.g., one per path slot): currently single plan.
6. **Task quality review**: first batch of generated plans needs Hebrew expert review for tone and concreteness.
