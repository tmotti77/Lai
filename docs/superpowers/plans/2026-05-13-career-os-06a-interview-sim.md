# Phase 6a Implementation Plan — Interview Simulator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/interview` surface — three persona-driven Hebrew interview simulators on top of a shared engine extracted from `/chat`. End-of-session feedback via `wrap_up` tool; sessions and messages persist in dedicated tables; safety pre-check reused as-is.

**Architecture:** Extract `lib/ai/engine.ts` as a thin shared LLM-turn helper (safety pre-check → either safe SSE short-circuit or `streamText` with persistence callbacks). Refactor `/api/chat/route.ts` to use it. Build `/api/interview/*` routes + `/interview` UI on top of the same helper with separate tables and prompts. No stage machine, no profile extraction.

**Tech Stack:** Next.js 16 App Router • AI SDK v6 (`streamText`, `generateObject`, `tool`) • `@ai-sdk/anthropic` • Supabase (Postgres + RLS + service role) • Vitest (unit/integration) • Tailwind + shadcn/ui (RTL).

**Spec:** `docs/superpowers/specs/2026-05-13-career-os-06a-interview-sim-design.md` (commit `899428d`).

---

## File map

### New files
```
lib/ai/engine.ts                                Shared streamLlmTurn helper (safety + streamText + persistence callbacks)
tests/unit/ai/engine.test.ts                    Unit tests for the helper

supabase/migrations/20260513120000_interview.sql Interview tables + RLS

lib/interview/types.ts                          Shared types
lib/interview/personas.ts                       3 frozen persona definitions
lib/interview/prompt.ts                         composeSystemPrompt + composeTurnPreamble (Mode A/B)
lib/interview/tools.ts                          makeWrapUpTool + makeRepairCall
lib/interview/types.ts                          Types

lib/db/interview.ts                             Service-role queries

tests/unit/interview/personas.test.ts
tests/unit/interview/prompt.test.ts
tests/unit/interview/tools.test.ts
tests/integration/interview-flow.test.ts        Gated on ANTHROPIC_API_KEY

app/api/interview/route.ts                      Start session + send turn
app/api/interview/wrap/route.ts                 Explicit user-triggered wrap
app/api/interview/history/route.ts              GET latest sessions

app/(app)/interview/page.tsx                    Landing (picker + history)
app/(app)/interview/[sessionId]/page.tsx        Live OR read-only transcript+feedback

components/interview/InterviewLanding.tsx
components/interview/PersonaSelector.tsx
components/interview/TargetRolePicker.tsx
components/interview/HistoryList.tsx
components/interview/InterviewChat.tsx
components/interview/InterviewMessage.tsx
components/interview/QuestionCounter.tsx
components/interview/WrapUpScreen.tsx

scripts/e2e-test-interview.ts                   Ad-hoc E2E runner
```

### Modified files
```
app/api/chat/route.ts                           Refactored to call lib/ai/engine.ts
lib/i18n/he.ts                                  Append he.interview.* block
CLAUDE.md                                       Append Phase 6a architecture section
```

---

## Task 1: Extract `lib/ai/engine.ts` (TDD)

**Files:**
- Create: `lib/ai/engine.ts`
- Create: `tests/unit/ai/engine.test.ts`

This is the foundation. The helper owns safety pre-check + the safe SSE short-circuit + the `streamText` call structure with persistence callbacks. It is domain-agnostic — knows nothing about conversations, sessions, stages, or interview personas. Callers pass their own system message, history, tools, and persistence callbacks.

- [ ] **Step 1: Write failing tests for the helper**

```ts
// tests/unit/ai/engine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelMessage } from "ai";

// We mock the AI SDK + safety + Anthropic client at the module boundary.
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn(),
  };
});
vi.mock("@/lib/ai/safety", () => ({
  checkUserMessage: vi.fn(),
}));
vi.mock("@/lib/ai/client", () => ({
  anthropic: vi.fn(() => "mock-model"),
  MODEL_ID: "claude-test",
  extractAnthropicCacheUsage: vi.fn(() => ({ cacheReadInputTokens: 0, cacheCreationInputTokens: 0 })),
}));

import { streamText } from "ai";
import { checkUserMessage } from "@/lib/ai/safety";
import { he } from "@/lib/i18n/he";
import { streamLlmTurn } from "@/lib/ai/engine";

const baseInput = () => ({
  userText: "שלום",
  systemMessage: { role: "system" as const, content: "you are a test" },
  history: [] as ModelMessage[],
  contextLabel: "test",
  contextId: "ctx-1",
  onUserPersist: vi.fn(async () => {}),
  onAssistantFinish: vi.fn(async () => {}),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("streamLlmTurn", () => {
  it("short-circuits with a safety-flagged SSE stream when checkUserMessage blocks", async () => {
    (checkUserMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      allow: false,
      flag: "distress",
      reason: "regex-hit",
    });
    const input = baseInput();
    const response = await streamLlmTurn(input);

    expect(response.headers.get("x-safety-flag")).toBe("distress");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(input.onUserPersist).toHaveBeenCalledWith("שלום", "distress");
    expect(input.onAssistantFinish).toHaveBeenCalledWith(
      expect.objectContaining({ text: he.safety.distressFallback, safetyFlag: "distress" }),
    );
    expect(streamText).not.toHaveBeenCalled();
  });

  it("calls streamText on the safe path and wires onFinish to onAssistantFinish", async () => {
    (checkUserMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ allow: true });

    let capturedOnFinish: ((args: unknown) => Promise<void>) | undefined;
    (streamText as ReturnType<typeof vi.fn>).mockImplementation((opts: Record<string, unknown>) => {
      capturedOnFinish = opts.onFinish as typeof capturedOnFinish;
      return {
        toUIMessageStreamResponse: (init: ResponseInit) =>
          new Response("ok", { ...init, headers: { ...init.headers, "x-stream": "yes" } }),
      };
    });

    const input = baseInput();
    const response = await streamLlmTurn(input);

    expect(streamText).toHaveBeenCalledOnce();
    expect(input.onUserPersist).toHaveBeenCalledWith("שלום", undefined);
    expect(response.headers.get("x-stream")).toBe("yes");

    // Simulate streamText completing.
    await capturedOnFinish!({
      text: "תשובה",
      usage: { inputTokens: 100, outputTokens: 50 },
      providerMetadata: {},
    });
    expect(input.onAssistantFinish).toHaveBeenCalledWith(
      expect.objectContaining({ text: "תשובה" }),
    );
  });

  it("skips safety pre-check when skipSafetyCheck is true (sentinel turns)", async () => {
    (checkUserMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ allow: false, flag: "distress" });
    (streamText as ReturnType<typeof vi.fn>).mockReturnValue({
      toUIMessageStreamResponse: () => new Response("ok"),
    });

    await streamLlmTurn({ ...baseInput(), skipSafetyCheck: true });

    expect(checkUserMessage).not.toHaveBeenCalled();
    expect(streamText).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npx vitest run tests/unit/ai/engine.test.ts`
Expected: FAIL (`Cannot find module '@/lib/ai/engine'`)

- [ ] **Step 3: Write the engine helper**

```ts
// lib/ai/engine.ts
import {
  streamText,
  stepCountIs,
  type ModelMessage,
  type SystemModelMessage,
  type ToolSet,
  type StopCondition,
} from "ai";
import { anthropic, MODEL_ID, extractAnthropicCacheUsage } from "@/lib/ai/client";
import { checkUserMessage } from "@/lib/ai/safety";
import { he } from "@/lib/i18n/he";

export interface FinishArgs {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  safetyFlag?: string;
}

export interface StreamLlmTurnInput {
  userText: string;
  systemMessage: SystemModelMessage | string;
  history: ModelMessage[];
  tools?: ToolSet;
  stopWhen?: StopCondition;
  skipSafetyCheck?: boolean;
  contextLabel: string;
  contextId: string;
  onUserPersist: (text: string, safetyFlag?: string) => Promise<void>;
  onAssistantFinish: (args: FinishArgs) => Promise<void>;
  onError?: (error: unknown) => Promise<void>;
  responseHeaders?: Record<string, string>;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

function buildSafetyShortCircuitResponse(text: string, headers: Record<string, string>): Response {
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
  return new Response(stream, { headers: { ...SSE_HEADERS, ...headers } });
}

export async function streamLlmTurn(input: StreamLlmTurnInput): Promise<Response> {
  const {
    userText,
    systemMessage,
    history,
    tools,
    stopWhen,
    skipSafetyCheck,
    contextLabel,
    contextId,
    onUserPersist,
    onAssistantFinish,
    onError,
    responseHeaders = {},
  } = input;

  // === Safety pre-check ===
  if (userText && !skipSafetyCheck) {
    const safety = await checkUserMessage(userText);
    if (!safety.allow) {
      await onUserPersist(userText, safety.flag);
      await onAssistantFinish({
        text: he.safety.distressFallback,
        safetyFlag: safety.flag,
      });
      console.warn(
        `[${contextLabel}] safety short-circuit id=${contextId} flag=${safety.flag} reason=${safety.reason}`,
      );
      return buildSafetyShortCircuitResponse(he.safety.distressFallback, {
        ...responseHeaders,
        "x-safety-flag": safety.flag,
      });
    }
  }

  // Safe (or sentinel) path — persist the user msg if any.
  if (userText) {
    await onUserPersist(userText, undefined);
  }

  const result = streamText({
    model: anthropic(MODEL_ID),
    system: systemMessage,
    messages: history,
    ...(tools ? { tools } : {}),
    ...(stopWhen ? { stopWhen } : { stopWhen: stepCountIs(2) }),
    onFinish: async ({ text, usage, providerMetadata }) => {
      const cache = extractAnthropicCacheUsage(usage, providerMetadata);
      console.log(
        `[${contextLabel}] turn finished id=${contextId} in=${usage.inputTokens ?? 0} out=${usage.outputTokens ?? 0} cacheRead=${cache.cacheReadInputTokens ?? 0} cacheWrite=${cache.cacheCreationInputTokens ?? 0}`,
      );
      await onAssistantFinish({
        text,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: cache.cacheReadInputTokens,
        cacheWriteTokens: cache.cacheCreationInputTokens,
      });
    },
    onError: async ({ error }) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${contextLabel}] streamText error id=${contextId} error=${message}`);
      if (onError) await onError(error);
    },
  });

  return result.toUIMessageStreamResponse({ headers: responseHeaders });
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/unit/ai/engine.test.ts`
Expected: PASS (3 tests pass)

- [ ] **Step 5: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add lib/ai/engine.ts tests/unit/ai/engine.test.ts
git commit -m "feat(ai): extract streamLlmTurn engine helper

Shared safety pre-check + streamText scaffolding so /chat and the
upcoming /interview route can share hardening (safety, cache
observability, error logging) without duplicating it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Refactor `/api/chat/route.ts` to use the engine

**Files:**
- Modify: `app/api/chat/route.ts`

Pure refactor — no behavior change. Existing chat tests + `scripts/e2e-test-chat.ts` are the regression gate. The chat route shrinks to ~80 lines: it does conversation resolution + cookie + stage bookkeeping + tool wiring + extraction kickoff; the engine owns safety + streamText + persistence.

- [ ] **Step 1: Read current chat route to make sure no behavior changes**

Run: `git diff app/api/chat/route.ts` (should be empty before this task).

- [ ] **Step 2: Replace chat route implementation**

Write the entire file:

```ts
// app/api/chat/route.ts
import { cookies } from "next/headers";
import type { UIMessage, ModelMessage } from "ai";
import { getCachedSystemMessage } from "@/lib/ai/client";
import { streamLlmTurn } from "@/lib/ai/engine";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getOrCreateConversation, appendMessage, loadMessages } from "@/lib/db/queries";
import { isValidStage, EXTRACTION_STAGES, type Stage } from "@/lib/ai/stages";
import { makeSetStageTool } from "@/lib/ai/tools";
import { updateConversationStage } from "@/lib/db/profile";
import { runExtraction } from "@/lib/ai/extraction";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACTIVE_CONVERSATION_COOKIE = "co_conv";
const ACTIVE_CONVERSATION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function POST(req: Request) {
  const body = (await req.json()) as { messages: UIMessage[]; conversationId?: string };

  const cookieStore = await cookies();
  const cookieConversationId = cookieStore.get(ACTIVE_CONVERSATION_COOKIE)?.value;
  const incomingConversationId = body.conversationId ?? cookieConversationId;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);
  const conversation = await getOrCreateConversation(internalUserId, incomingConversationId);

  const lastUserMessage = body.messages[body.messages.length - 1];
  const userText =
    lastUserMessage?.role === "user"
      ? lastUserMessage.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
      : "";

  const currentStage: Stage = isValidStage(conversation.stage) ? conversation.stage : "onboarding";

  let advancedToStage: Stage | null = null;
  const setStageTool = makeSetStageTool({
    onAdvance: async (nextStage, reason) => {
      advancedToStage = nextStage;
      await updateConversationStage(conversation.id, nextStage);
      console.log(
        `[chat] stage advanced conv=${conversation.id} from=${currentStage} to=${nextStage} reason=${reason}`,
      );
    },
  });

  const history = await loadMessages(conversation.id);
  const historyAsModelMessages: ModelMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const setCookie = `${ACTIVE_CONVERSATION_COOKIE}=${conversation.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ACTIVE_CONVERSATION_MAX_AGE_SECONDS}${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;

  return streamLlmTurn({
    userText,
    systemMessage: getCachedSystemMessage(currentStage),
    history: historyAsModelMessages,
    tools: { set_stage: setStageTool },
    contextLabel: "chat",
    contextId: conversation.id,
    responseHeaders: {
      "x-conversation-id": conversation.id,
      "x-stage": currentStage,
      "Set-Cookie": setCookie,
    },
    onUserPersist: async (text, safetyFlag) => {
      await appendMessage({
        conversationId: conversation.id,
        role: "user",
        content: text,
        safetyFlag,
      });
    },
    onAssistantFinish: async (args) => {
      await appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: args.text,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        cacheReadTokens: args.cacheReadTokens,
        cacheWriteTokens: args.cacheWriteTokens,
        safetyFlag: args.safetyFlag,
      });

      if (advancedToStage && EXTRACTION_STAGES.has(currentStage)) {
        const stageJustCompleted = currentStage;
        runExtraction({
          userId: internalUserId,
          conversationId: conversation.id,
          stage: stageJustCompleted,
        })
          .then(() =>
            console.log(`[chat] extraction done conv=${conversation.id} stage=${stageJustCompleted}`),
          )
          .catch((err) =>
            console.error(
              `[chat] extraction failed conv=${conversation.id} stage=${stageJustCompleted} error=${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }
    },
    onError: async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await appendMessage({
        conversationId: conversation.id,
        role: "system",
        content: `[stream-error] ${message}`,
        safetyFlag: "stream-error",
      }).catch((err) => console.error("[chat] failed to persist error row", err));
    },
  });
}
```

- [ ] **Step 3: Run all chat tests + type-check**

Run: `npx vitest run tests/unit/ai && npx vitest run tests/unit/chat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run the e2e chat script to verify stage transitions still work**

Run: `npx tsx scripts/e2e-test-chat.ts stage`
Expected: stage advances from `onboarding` to `interests` exactly as before. Cache read >0 on turn 2.

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "refactor(chat): route uses streamLlmTurn engine helper

No behavior change. Verifies the engine-helper extraction by running
the existing /chat surface on top of it. The route is now thin
glue: conversation resolution + stage tool wiring + extraction
kickoff; safety + streamText + persistence are in lib/ai/engine.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: DB migration — `interview_sessions` + `interview_messages`

**Files:**
- Create: `supabase/migrations/20260513120000_interview.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260513120000_interview.sql

create table interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  persona text not null check (persona in ('hr','technical','first_job')),
  target_occupation_id text,
  target_role_he text not null,
  question_count int not null default 0,
  max_questions int not null default 8,
  completed_at timestamptz,
  feedback_summary_he text,
  feedback_per_question jsonb,
  feedback_strengths_he jsonb,
  feedback_improvements_he jsonb,
  feedback_next_practice_focus_he text,
  forced_wrap boolean not null default false,
  created_at timestamptz not null default now()
);

create index interview_sessions_user_idx on interview_sessions (user_id, created_at desc);

alter table interview_sessions enable row level security;

create policy "interview_sessions_select_own" on interview_sessions
  for select using (
    user_id in (select id from users where auth_id = auth.uid())
  );

create table interview_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references interview_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  safety_flag text,
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

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: applies cleanly

- [ ] **Step 3: Regenerate Supabase types**

Run: `npm run db:types`
Expected: `lib/db/types.gen.ts` now has `interview_sessions` and `interview_messages` types

- [ ] **Step 4: Commit migration + regenerated types**

```bash
git add supabase/migrations/20260513120000_interview.sql lib/db/types.gen.ts
git commit -m "feat(db): interview_sessions + interview_messages tables

Mirrors conversations/messages shape but with persona, target_role,
max_questions, and structured feedback columns. Service-role inserts;
RLS lets the owner SELECT via users.auth_id = auth.uid().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `lib/interview/types.ts`

**Files:**
- Create: `lib/interview/types.ts`

- [ ] **Step 1: Write types**

```ts
// lib/interview/types.ts
import "server-only";

export const PERSONA_IDS = ["hr", "technical", "first_job"] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

export interface Persona {
  id: PersonaId;
  label_he: string;
  description_he: string;
  system_prompt_overlay: string;
}

export interface InterviewSession {
  id: string;
  user_id: string;
  persona: PersonaId;
  target_occupation_id: string | null;
  target_role_he: string;
  question_count: number;
  max_questions: number;
  completed_at: string | null;
  feedback_summary_he: string | null;
  feedback_per_question: Array<{ question_number: number; note_he: string }> | null;
  feedback_strengths_he: string[] | null;
  feedback_improvements_he: string[] | null;
  feedback_next_practice_focus_he: string | null;
  forced_wrap: boolean;
  created_at: string;
}

export interface InterviewMessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  safety_flag: string | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  created_at: string;
}

export interface WrapUpPayload {
  summary_he: string;
  strengths_he: string[];
  improvements_he: string[];
  next_practice_focus_he: string;
  per_question: Array<{ question_number: number; note_he: string }>;
}
```

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add lib/interview/types.ts
git commit -m "feat(interview): types module

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `lib/interview/personas.ts` (frozen definitions, TDD)

**Files:**
- Create: `lib/interview/personas.ts`
- Create: `tests/unit/interview/personas.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/interview/personas.test.ts
import { describe, it, expect } from "vitest";
import { PERSONAS, getPersona } from "@/lib/interview/personas";
import { PERSONA_IDS } from "@/lib/interview/types";

describe("interview personas", () => {
  it("exposes exactly 3 personas matching PERSONA_IDS", () => {
    const ids = PERSONAS.map((p) => p.id).sort();
    expect(ids).toEqual([...PERSONA_IDS].sort());
    expect(PERSONAS).toHaveLength(3);
  });

  it("each persona has non-empty label, description, and overlay", () => {
    for (const p of PERSONAS) {
      expect(p.label_he.trim().length).toBeGreaterThan(0);
      expect(p.description_he.trim().length).toBeGreaterThan(0);
      expect(p.system_prompt_overlay.trim().length).toBeGreaterThan(50);
    }
  });

  it("no proper-noun first names in any overlay (no interviewer names)", () => {
    // Common Israeli first names we explicitly decided not to use.
    const bannedNames = ["אורית", "דניאל", "מיכל", "רוני", "טל", "עמית", "יוסי", "שירה"];
    for (const p of PERSONAS) {
      for (const name of bannedNames) {
        expect(p.system_prompt_overlay).not.toContain(name);
      }
    }
  });

  it("getPersona returns the right one and throws on unknown id", () => {
    expect(getPersona("hr").id).toBe("hr");
    expect(getPersona("technical").id).toBe("technical");
    // @ts-expect-error — testing runtime guard
    expect(() => getPersona("salary_negotiation")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npx vitest run tests/unit/interview/personas.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write personas.ts**

```ts
// lib/interview/personas.ts
import "server-only";
import type { Persona, PersonaId } from "./types";

const HR: Persona = {
  id: "hr",
  label_he: "ראיון משאבי אנוש",
  description_he: "ראיון התנהגותי. שאלות על העבר, התמודדויות, יחסי עבודה.",
  system_prompt_overlay: `סוג הראיון: משאבי אנוש (HR).
השאלות צריכות להיות התנהגותיות בסגנון STAR — "ספר/י לי על מקרה שבו…", "איך את/ה מתמודד/ת עם…". כסה/י נושאים כמו: עבודת צוות, התמודדות עם קונפליקט, ניהול עומסים, מוטיבציה, התאמה לתרבות.

מאגר שאלות זרע (בחר/י וגוון/י, אל תקרא/י אותן כתסריט):
1. ספר/י לי על מקרה שבו עבדת בצוות שלא הסתדר.
2. ספר/י לי על אתגר שדרש ממך לצאת מאזור הנוחות.
3. איך את/ה מתמודד/ת עם משוב שלילי?
4. ספר/י לי על מקרה שבו טעית — איך הגבת?
5. מה מניע אותך בעבודה?
6. ספר/י לי על מקרה שבו היה עליך לנהל קונפליקט.
7. איך את/ה מסדר/ת סדרי עדיפויות כשיש לחץ זמן?
8. ספר/י לי על מקרה שבו לקחת יוזמה ללא שביקשו ממך.
9. ספר/י לי על פרויקט שאת/ה גאה בו במיוחד — ולמה.
10. איך נראית לך עבודה בצוות "טוב"?
11. ספר/י לי על מצב שדרש ממך ללמוד משהו חדש מהר.
12. מה ציפיותיך מהמנהל/ת הישיר/ה?

חובה: כשתגיע למכסת השאלות, קרא לכלי wrap_up. אל תמשיך לשאול.`,
};

const TECHNICAL: Persona = {
  id: "technical",
  label_he: "ראיון טכני",
  description_he: "ראיון מקצועי. שאלות מתחומי הידע של התפקיד, גישות לפתרון בעיות.",
  system_prompt_overlay: `סוג הראיון: טכני/מקצועי.
השאלות צריכות להיות ממוקדות בתחום של {target_role_he}. אם סופקה רשימת כישורי-יעד, השתמש/י בהם כזרע לנושאים (2-3 מתוכם), אל תהפך/י את הראיון לבחינה.
כלול/י לפחות שאלה אחת בסגנון "תאר/י איך היית מתקרב/ת לפתרון של…" — שאלת חשיבה, לא רק זיכרון.

סגנון: מדויק, ענייני, ללא small talk. בקש/י דוגמאות קונקרטיות. הקשב/י לאופן שבו המרואיינ/ת חושב/ת, לא רק לתשובה הסופית.

חובה: כשתגיע למכסת השאלות, קרא לכלי wrap_up. אל תמשיך לשאול.`,
};

const FIRST_JOB: Persona = {
  id: "first_job",
  label_he: "ראיון לעבודה ראשונה",
  description_he: "ראיון התומך במתחילים. דגש על מוטיבציה, סקרנות ולמידה.",
  system_prompt_overlay: `סוג הראיון: עבודה ראשונה / כניסה לתחום.
המרואיינ/ת אולי ללא ניסיון תעסוקתי קודם — אל תניח/י שיש לו/ה. אל תוריד/י את הרף, אבל התאם/י את הנושאים: מוטיבציה ("מה מושך אותך לתחום הזה?"), סגנון למידה ("איך את/ה לומד/ת משהו חדש?"), פרויקטים אישיים (כל פרויקט נחשב — צבא, אקדמיה, עצמאי).

טון: חם יותר ממשאבי אנוש סטנדרטי, אבל לא מתנשא/ת. שאלות אמיתיות, לא "קלות בגלל שאת/ה מתחיל/ה".

חובה: כשתגיע למכסת השאלות, קרא לכלי wrap_up. אל תמשיך לשאול.`,
};

export const PERSONAS: ReadonlyArray<Persona> = [HR, TECHNICAL, FIRST_JOB] as const;

const PERSONA_BY_ID: Record<PersonaId, Persona> = {
  hr: HR,
  technical: TECHNICAL,
  first_job: FIRST_JOB,
};

export function getPersona(id: PersonaId): Persona {
  const p = PERSONA_BY_ID[id];
  if (!p) throw new Error(`Unknown persona id: ${id}`);
  return p;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run tests/unit/interview/personas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/interview/personas.ts tests/unit/interview/personas.test.ts
git commit -m "feat(interview): 3 persona definitions (HR, Technical, First-job)

No interviewer names — personas self-identify by role only. Gender-
neutral Hebrew throughout (את/ה, ספר/י). Each overlay ends with the
mandatory wrap_up reminder.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `lib/interview/prompt.ts` (TDD)

**Files:**
- Create: `lib/interview/prompt.ts`
- Create: `tests/unit/interview/prompt.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/interview/prompt.test.ts
import { describe, it, expect } from "vitest";
import { composeSystemPrompt, composeTurnPreamble } from "@/lib/interview/prompt";

describe("composeSystemPrompt", () => {
  it("substitutes target_role_he and includes persona overlay", () => {
    const s = composeSystemPrompt({
      persona: "hr",
      targetRoleHe: "מהנדס/ת תוכנה",
      occupationSkills: null,
    });
    expect(s).toContain("מהנדס/ת תוכנה");
    expect(s).toContain("משאבי אנוש"); // HR persona label
    expect(s).toContain("עברית ניטרלית מגדרית"); // base rule 7
  });

  it("technical persona injects occupation skills when provided", () => {
    const s = composeSystemPrompt({
      persona: "technical",
      targetRoleHe: "מהנדס/ת תוכנה",
      occupationSkills: ["Python", "מערכות מבוזרות", "SQL"],
    });
    expect(s).toContain("Python");
    expect(s).toContain("מערכות מבוזרות");
    expect(s).toContain("SQL");
  });

  it("contains NO per-turn variables (cache correctness)", () => {
    const s = composeSystemPrompt({
      persona: "technical",
      targetRoleHe: "מהנדס/ת תוכנה",
      occupationSkills: null,
    });
    // System prompt must not mention "שאלה N" or digit-counter substrings
    // (those live in the per-turn preamble).
    expect(s).not.toMatch(/שאלה\s*\d+/);
    expect(s).not.toMatch(/מתוך\s*\d+/);
  });
});

describe("composeTurnPreamble", () => {
  it("emits Mode A (asking) when question_count < max_questions", () => {
    const a = composeTurnPreamble({ questionCount: 0, maxQuestions: 8 });
    expect(a).toContain("שאלה 1 מתוך 8");

    const b = composeTurnPreamble({ questionCount: 5, maxQuestions: 8 });
    expect(b).toContain("שאלה 6 מתוך 8");

    // Must NOT be wrap mode yet.
    expect(b).not.toContain("wrap_up");
  });

  it("emits Mode B (wrap instruction) when question_count >= max_questions", () => {
    const c = composeTurnPreamble({ questionCount: 8, maxQuestions: 8 });
    expect(c).toContain("wrap_up");
    expect(c).toContain("הראיון הסתיים");
    expect(c).not.toMatch(/שאלה\s*9\s*מתוך/); // no off-by-one!
  });

  it("Mode B applies above max too (defensive)", () => {
    const d = composeTurnPreamble({ questionCount: 12, maxQuestions: 8 });
    expect(d).toContain("wrap_up");
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run tests/unit/interview/prompt.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write prompt.ts**

```ts
// lib/interview/prompt.ts
import "server-only";
import { getPersona } from "./personas";
import type { PersonaId } from "./types";

const BASE_RULES = `אתה מראיין מנוסה בישראל. תפקידך לקיים ראיון עבודה מציאותי בעברית עבור משתמש המתאמן לקראת ראיון אמיתי לתפקיד {target_role_he}.

כללים קריטיים:
1. שאל שאלה אחת בכל הודעה — לעולם לא יותר מאחת.
2. תישאר באופי. אתה מראיין, לא מאמן. אל תיתן משוב, אל תסביר למה שאלת, אל תעזור לנסח. רק שאל ותקשיב.
3. הקשב באמת — שאלת המשך טבעית בהתאם לתשובה אם זה מתאים, או מעבר לנושא הבא.
4. אחרי שמכסת השאלות הסתיימה (תקבל את המספר בכל הודעה), חובה לקרוא לכלי wrap_up עם משוב מובנה.
5. אל תקרא לכלי wrap_up לפני שאלה 5. אל תחכה מעבר למכסה.
6. אל תאשר את התשובה ("מצוין!", "תשובה נהדרת"). מראיין אמיתי לא מתפעל. אישור קצר ("הבנתי", "תודה") ומעבר לשאלה הבאה.
7. עברית ניטרלית מגדרית בלבד: "את/ה", "ספר/י", "התמודד/ת", "תאר/י". לעולם אל תניח מגדר של המרואיין/ת.

פרטי הראיון:
- תפקיד יעד: {target_role_he}
`;

export interface ComposeSystemPromptArgs {
  persona: PersonaId;
  targetRoleHe: string;
  occupationSkills: string[] | null;
}

export function composeSystemPrompt({
  persona,
  targetRoleHe,
  occupationSkills,
}: ComposeSystemPromptArgs): string {
  const personaDef = getPersona(persona);
  const base = BASE_RULES.replace(/\{target_role_he\}/g, targetRoleHe);

  let overlay = personaDef.system_prompt_overlay.replace(/\{target_role_he\}/g, targetRoleHe);

  if (persona === "technical" && occupationSkills && occupationSkills.length > 0) {
    const skillsBlock = `\n\nכישורי-יעד לשאילה (בחר/י 2-3 מהרשימה כזרע לנושאי שאלה — לא רשימת בדיקה):\n${occupationSkills.map((s) => `- ${s}`).join("\n")}\n`;
    overlay = overlay.replace("חובה: כשתגיע", `${skillsBlock}\nחובה: כשתגיע`);
  }

  return `${base}\n${overlay}\n`;
}

export interface ComposeTurnPreambleArgs {
  questionCount: number;
  maxQuestions: number;
}

export function composeTurnPreamble({ questionCount, maxQuestions }: ComposeTurnPreambleArgs): string {
  if (questionCount >= maxQuestions) {
    return `[המשתמש סיים לענות על השאלה האחרונה. הראיון הסתיים. עליך לקרוא לכלי wrap_up עכשיו עם המשוב המובנה. אל תשאל שאלה נוספת.]`;
  }
  return `[שאלה ${questionCount + 1} מתוך ${maxQuestions}]`;
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/unit/interview/prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/interview/prompt.ts tests/unit/interview/prompt.test.ts
git commit -m "feat(interview): composeSystemPrompt + composeTurnPreamble

Function signatures enforce the cache rule by construction: only
per-session-stable inputs flow into the system prompt; per-turn
state (question_count) lives in composeTurnPreamble. The preamble
switches to Mode B (wrap instruction) when question_count >=
max_questions so the model never sees off-by-one counters.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `lib/db/interview.ts` (service-role queries)

**Files:**
- Create: `lib/db/interview.ts`

- [ ] **Step 1: Write the DB module**

```ts
// lib/db/interview.ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { InterviewSession, InterviewMessageRow, PersonaId, WrapUpPayload } from "@/lib/interview/types";

export async function createInterviewSession(input: {
  userId: string;
  persona: PersonaId;
  targetOccupationId: string | null;
  targetRoleHe: string;
  maxQuestions?: number;
}): Promise<{ id: string }> {
  const supa = createServiceClient();
  const { data, error } = await supa
    .from("interview_sessions")
    .insert({
      user_id: input.userId,
      persona: input.persona,
      target_occupation_id: input.targetOccupationId,
      target_role_he: input.targetRoleHe,
      max_questions: input.maxQuestions ?? 8,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createInterviewSession: ${error.message}`);
  return { id: data.id as string };
}

export async function getInterviewSession(sessionId: string): Promise<InterviewSession | null> {
  const supa = createServiceClient();
  const { data, error } = await supa.from("interview_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(`getInterviewSession: ${error.message}`);
  return (data as InterviewSession | null) ?? null;
}

export async function listSessionsForUser(userId: string, limit = 5): Promise<InterviewSession[]> {
  const supa = createServiceClient();
  const { data, error } = await supa
    .from("interview_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listSessionsForUser: ${error.message}`);
  return (data as InterviewSession[]) ?? [];
}

export async function loadInterviewMessages(sessionId: string): Promise<InterviewMessageRow[]> {
  const supa = createServiceClient();
  const { data, error } = await supa
    .from("interview_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`loadInterviewMessages: ${error.message}`);
  return (data as InterviewMessageRow[]) ?? [];
}

export async function appendInterviewMessage(input: {
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  safetyFlag?: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): Promise<void> {
  const supa = createServiceClient();
  const { error } = await supa.from("interview_messages").insert({
    session_id: input.sessionId,
    role: input.role,
    content: input.content,
    safety_flag: input.safetyFlag ?? null,
    cache_read_tokens: input.cacheReadTokens ?? null,
    cache_write_tokens: input.cacheWriteTokens ?? null,
  });
  if (error) throw new Error(`appendInterviewMessage: ${error.message}`);
}

export async function incrementQuestionCount(sessionId: string): Promise<number> {
  const supa = createServiceClient();
  const { data: current, error: readErr } = await supa
    .from("interview_sessions")
    .select("question_count")
    .eq("id", sessionId)
    .single();
  if (readErr) throw new Error(`incrementQuestionCount: ${readErr.message}`);
  const next = (current.question_count as number) + 1;
  const { error } = await supa.from("interview_sessions").update({ question_count: next }).eq("id", sessionId);
  if (error) throw new Error(`incrementQuestionCount update: ${error.message}`);
  return next;
}

export async function completeInterviewSession(
  sessionId: string,
  payload: WrapUpPayload & { forcedWrap?: boolean },
): Promise<void> {
  const supa = createServiceClient();
  const { error } = await supa
    .from("interview_sessions")
    .update({
      completed_at: new Date().toISOString(),
      feedback_summary_he: payload.summary_he,
      feedback_strengths_he: payload.strengths_he,
      feedback_improvements_he: payload.improvements_he,
      feedback_next_practice_focus_he: payload.next_practice_focus_he,
      feedback_per_question: payload.per_question,
      forced_wrap: payload.forcedWrap ?? false,
    })
    .eq("id", sessionId);
  if (error) throw new Error(`completeInterviewSession: ${error.message}`);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add lib/db/interview.ts
git commit -m "feat(interview): service-role DB queries

Mirrors lib/db/cv.ts pattern. Inserts/updates go through service
role; SELECTs callable from anywhere (but RLS gates anon clients).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `lib/interview/tools.ts` — wrap_up tool + repair call (TDD)

**Files:**
- Create: `lib/interview/tools.ts`
- Create: `tests/unit/interview/tools.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/interview/tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/interview", () => ({
  completeInterviewSession: vi.fn(),
}));

import { completeInterviewSession } from "@/lib/db/interview";
import { makeWrapUpTool } from "@/lib/interview/tools";

const validInput = {
  summary_he: "סיכמת את התקופה האחרונה בצורה ברורה ומבוססת על דוגמאות.",
  strengths_he: ["נימוק טוב", "דוגמאות קונקרטיות"],
  improvements_he: ["שאלות הבהרה", "סדר בתשובה"],
  next_practice_focus_he: "תרגל מענה על שאלות התנהגותיות עם מבנה STAR.",
  per_question: [
    { question_number: 1, note_he: "מענה טוב, חסרה דוגמה." },
    { question_number: 2, note_he: "ברור ומדויק." },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("makeWrapUpTool", () => {
  it("rejects when called before question 5 (too_early)", async () => {
    const tool = makeWrapUpTool("session-1", 3);
    const result = await tool.execute!(validInput, { toolCallId: "t1", messages: [] } as never);
    expect(result).toEqual(
      expect.objectContaining({ wrapped: false, error: "too_early" }),
    );
    expect(completeInterviewSession).not.toHaveBeenCalled();
  });

  it("writes feedback and returns wrapped:true when called at or after question 5", async () => {
    const tool = makeWrapUpTool("session-1", 6);
    const result = await tool.execute!(validInput, { toolCallId: "t1", messages: [] } as never);
    expect(result).toEqual({ wrapped: true });
    expect(completeInterviewSession).toHaveBeenCalledWith("session-1", expect.objectContaining(validInput));
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run tests/unit/interview/tools.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write tools.ts**

```ts
// lib/interview/tools.ts
import "server-only";
import { tool, generateObject } from "ai";
import { z } from "zod";
import { anthropic, MODEL_ID } from "@/lib/ai/client";
import { completeInterviewSession } from "@/lib/db/interview";

export const WrapUpSchema = z.object({
  summary_he: z.string().min(20).describe("2-4 sentences of overall feedback in Hebrew"),
  strengths_he: z.array(z.string()).min(1).max(4),
  improvements_he: z.array(z.string()).min(1).max(4),
  next_practice_focus_he: z.string().min(10).describe("ONE concrete actionable thing to practice next. One sentence."),
  per_question: z
    .array(z.object({ question_number: z.number().int().min(1), note_he: z.string() }))
    .max(10),
});

export type WrapUpInput = z.infer<typeof WrapUpSchema>;

export function makeWrapUpTool(sessionId: string, currentQuestionCount: number) {
  return tool({
    description:
      "Call this when the interview is complete (after max_questions, or earlier if the interview reached a natural end ≥ question 5). Provide structured Hebrew feedback. This is the ONLY way to end the interview.",
    inputSchema: WrapUpSchema,
    execute: async (input) => {
      if (currentQuestionCount < 5) {
        return {
          wrapped: false,
          error: "too_early" as const,
          retry_message: "המשך בראיון. אל תקרא ל-wrap_up לפני שאלה 5.",
        };
      }
      await completeInterviewSession(sessionId, input);
      return { wrapped: true as const };
    },
  });
}

/**
 * Repair call: when the model fails to call wrap_up despite Mode B prompting,
 * run a one-shot generateObject against the full transcript to extract feedback.
 * Returns the wrap-up payload or null on failure.
 */
export async function runWrapRepairCall(
  transcript: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  targetRoleHe: string,
): Promise<WrapUpInput | null> {
  try {
    const result = await generateObject({
      model: anthropic(MODEL_ID),
      schema: WrapUpSchema,
      system: `אתה מסכם ראיון עבודה שהסתיים. עבור על התמליל וייצר אובייקט wrap_up מובנה בעברית. תפקיד היעד: ${targetRoleHe}. אל תוסיף שאלות חדשות — רק סכם.`,
      messages: transcript.map((m) => ({
        role: m.role === "system" ? "user" : m.role,
        content: m.content,
      })),
    });
    return result.object;
  } catch (err) {
    console.error("[interview] wrap repair call failed", err);
    return null;
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/unit/interview/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/interview/tools.ts tests/unit/interview/tools.test.ts
git commit -m "feat(interview): wrap_up tool + repair-call fallback

Schema validates shape (lengths, types); execute validates timing
(rejects calls before question 5). runWrapRepairCall is the
escalation: when the live tool fails to fire, a one-shot
generateObject against the transcript salvages structured
feedback before falling back to a generic templated message.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: i18n additions for the interview surface

**Files:**
- Modify: `lib/i18n/he.ts`

- [ ] **Step 1: Add `he.interview` block**

Append (above the closing `}` of `he`):

```ts
  interview: {
    landing: {
      title: "סימולטור ראיונות",
      subtitle: "בחר/י סוג ראיון ותפקיד כדי להתחיל.",
      personaSectionTitle: "סוג ראיון",
      targetSectionTitle: "תפקיד יעד",
      targetFromRecs: "בחר מההמלצות שלך",
      targetCustom: "תפקיד אחר",
      historyTitle: "ראיונות קודמים",
      historyEmpty: "עדיין לא קיימת/ ראיון. ההתחלה כאן.",
      start: "התחל ראיון",
      cantStartNoRole: "בחר/י תפקיד כדי להמשיך",
    },
    counter: {
      label: "שאלה {current} מתוך {total}",
      wrappingUp: "מסכם את הראיון…",
    },
    chat: {
      composerPlaceholder: "כתוב/כתבי את התשובה שלך…",
      send: "שלח",
      youSaid: "את/ה",
      interviewer: "המראיין",
    },
    wrap: {
      heading: "סיום הראיון — משוב",
      strengthsTitle: "מה עבד",
      improvementsTitle: "מה אפשר לחדד",
      nextFocusTitle: "להמשך תרגול",
      perQuestionTitle: "הערות לפי שאלה",
      restartCta: "תרגל ראיון נוסף",
      doneCta: "סיים",
      forcedNote: "הראיון הסתיים, אך לא הצלחנו לייצר משוב מפורט. נסה ראיון נוסף.",
    },
    persona: {
      hr: { label: "ראיון משאבי אנוש", description: "ראיון התנהגותי — שאלות על העבר, התמודדויות ויחסי עבודה." },
      technical: { label: "ראיון טכני", description: "ראיון מקצועי — שאלות מתחום התפקיד וגישות לפתרון בעיות." },
      first_job: { label: "ראיון לעבודה ראשונה", description: "ראיון תומך — דגש על מוטיבציה וסקרנות." },
    },
    fallback: {
      modelFailedToWrap: "סיימת את הראיון. לא הצלחנו לייצר משוב מפורט הפעם — נסה ראיון נוסף.",
    },
    errors: {
      sessionNotFound: "לא מצאנו את הראיון הזה.",
      startFailed: "לא הצלחנו להתחיל את הראיון. נסה/י שוב.",
      streamFailed: "שגיאה בזרם הראיון. נסה/י לשלוח שוב.",
    },
  },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/he.ts
git commit -m "feat(i18n): he.interview.* strings for Phase 6a

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `POST /api/interview` — start + turn

**Files:**
- Create: `app/api/interview/route.ts`

This is the main route. It handles two actions: `start` (creates a session, returns id) and `turn` (sends a message, streams a response). It applies Mode A/B preamble, calls the engine helper, increments `question_count` on assistant finish, and runs the repair-call escalation when the model fails to wrap.

- [ ] **Step 1: Write the route**

```ts
// app/api/interview/route.ts
import type { ModelMessage } from "ai";
import { stepCountIs } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { streamLlmTurn } from "@/lib/ai/engine";
import { composeSystemPrompt, composeTurnPreamble } from "@/lib/interview/prompt";
import { makeWrapUpTool, runWrapRepairCall, WrapUpSchema } from "@/lib/interview/tools";
import { getCachedSystemMessage } from "@/lib/ai/client";
import {
  createInterviewSession,
  getInterviewSession,
  loadInterviewMessages,
  appendInterviewMessage,
  incrementQuestionCount,
  completeInterviewSession,
} from "@/lib/db/interview";
import { PERSONA_IDS } from "@/lib/interview/types";
import occupationsCatalog from "@/content/occupations/_index.json";
import type { Occupation } from "@/lib/matching/types";
import { he } from "@/lib/i18n/he";

export const runtime = "nodejs";
export const maxDuration = 60;

const SENTINEL_START = "__start__";

const StartSchema = z.object({
  action: z.literal("start"),
  persona: z.enum(PERSONA_IDS),
  target_occupation_id: z.string().min(1).optional(),
  target_role_he: z.string().min(1).max(120).optional(),
});

const TurnSchema = z.object({
  action: z.literal("turn"),
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(8000),
});

const BodySchema = z.union([StartSchema, TurnSchema]);

function lookupOccupation(id: string): Occupation | null {
  const list = occupationsCatalog as { occupations: Occupation[] };
  return list.occupations.find((o) => o.id === id) ?? null;
}

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return Response.json({ error: "bad_request", detail: String(err) }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  // === START ===
  if (body.action === "start") {
    if (!body.target_occupation_id && !body.target_role_he) {
      return Response.json({ error: "missing_target" }, { status: 400 });
    }
    if (body.target_occupation_id && body.target_role_he) {
      return Response.json({ error: "ambiguous_target" }, { status: 400 });
    }

    let targetRoleHe: string;
    let targetOccupationId: string | null = null;
    if (body.target_occupation_id) {
      const occ = lookupOccupation(body.target_occupation_id);
      if (!occ) return Response.json({ error: "unknown_occupation" }, { status: 400 });
      targetOccupationId = occ.id;
      targetRoleHe = occ.name_he;
    } else {
      targetRoleHe = (body.target_role_he ?? "").trim().slice(0, 120);
    }

    const session = await createInterviewSession({
      userId,
      persona: body.persona,
      targetOccupationId,
      targetRoleHe,
    });
    return Response.json({ sessionId: session.id });
  }

  // === TURN ===
  const session = await getInterviewSession(body.sessionId);
  if (!session) return Response.json({ error: "session_not_found" }, { status: 404 });
  if (session.user_id !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
  if (session.completed_at) return Response.json({ error: "session_already_completed" }, { status: 409 });

  // Compose system message (per-session-stable).
  const occupation = session.target_occupation_id ? lookupOccupation(session.target_occupation_id) : null;
  const occupationSkills =
    occupation?.required_skills?.map((s) => s.name_he ?? s.id) ?? null;
  const systemPromptText = composeSystemPrompt({
    persona: session.persona,
    targetRoleHe: session.target_role_he,
    occupationSkills,
  });
  // Wrap in cached system-message shape for AI SDK v6.
  const systemMessage = getCachedSystemMessage(systemPromptText);

  // Load history.
  const history = await loadInterviewMessages(session.id);
  const historyAsModelMessages: ModelMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Per-turn preamble (Mode A or Mode B).
  const preamble = composeTurnPreamble({
    questionCount: session.question_count,
    maxQuestions: session.max_questions,
  });

  // Sentinel handling: __start__ becomes "" (no user text persisted; preamble only).
  const isSentinel = body.message === SENTINEL_START;
  const userTextForLlm = isSentinel ? "" : body.message;
  const userTextForPersist = isSentinel ? null : body.message;

  // Build the user message the LLM sees (preamble + actual text or just preamble).
  const llmUserMessage: ModelMessage = {
    role: "user",
    content: userTextForPersist ? `${preamble}\n\n${userTextForPersist}` : preamble,
  };

  // Tools depend on current question count.
  const wrapTool = makeWrapUpTool(session.id, session.question_count);

  // Track tool result for post-stream escalation.
  let wrapToolFired = false;
  let wrapToolWrappedSuccessfully = false;

  return streamLlmTurn({
    userText: userTextForLlm,
    skipSafetyCheck: isSentinel,
    systemMessage,
    history: [...historyAsModelMessages, llmUserMessage],
    tools: { wrap_up: wrapTool },
    stopWhen: stepCountIs(2),
    contextLabel: "interview",
    contextId: session.id,
    responseHeaders: {
      "x-interview-session-id": session.id,
      "x-question-count": String(session.question_count),
      "x-max-questions": String(session.max_questions),
    },
    onUserPersist: async (_text, safetyFlag) => {
      if (userTextForPersist) {
        await appendInterviewMessage({
          sessionId: session.id,
          role: "user",
          content: userTextForPersist,
          safetyFlag,
        });
      }
    },
    onAssistantFinish: async (args) => {
      // Detect wrap_up tool fire by inspecting the assistant text — empty
      // text + completed_at on row means tool ran.
      const fresh = await getInterviewSession(session.id);
      wrapToolFired = !!fresh?.completed_at;
      wrapToolWrappedSuccessfully = wrapToolFired;

      // Persist assistant turn (may be empty if only the tool fired).
      await appendInterviewMessage({
        sessionId: session.id,
        role: "assistant",
        content: args.text,
        safetyFlag: args.safetyFlag,
        cacheReadTokens: args.cacheReadTokens,
        cacheWriteTokens: args.cacheWriteTokens,
      });

      // Only count the turn as a "question" if it wasn't a wrap and wasn't a safety fallback.
      if (!wrapToolFired && !args.safetyFlag) {
        await incrementQuestionCount(session.id);
      }

      // ESCALATION: if we were already in Mode B (question_count == max) and the
      // model didn't fire wrap_up, attempt a repair call. If that fails, write
      // templated fallback.
      const afterCount = (await getInterviewSession(session.id))?.question_count ?? 0;
      if (!wrapToolFired && session.question_count >= session.max_questions) {
        const fullHistory = await loadInterviewMessages(session.id);
        const transcript = fullHistory.map((m) => ({ role: m.role, content: m.content }));
        const repaired = await runWrapRepairCall(transcript, session.target_role_he);
        if (repaired) {
          await completeInterviewSession(session.id, { ...repaired, forcedWrap: true });
          console.warn(`[interview] forced wrap via repair call session=${session.id}`);
        } else {
          await completeInterviewSession(session.id, {
            summary_he: he.interview.fallback.modelFailedToWrap,
            strengths_he: ["—"],
            improvements_he: ["—"],
            next_practice_focus_he: "תרגל ראיון נוסף.",
            per_question: [],
            forcedWrap: true,
          });
          console.error(`[interview] templated fallback session=${session.id}`);
        }
      }

      void afterCount; // silence unused
    },
    onError: async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await appendInterviewMessage({
        sessionId: session.id,
        role: "system",
        content: `[stream-error] ${message}`,
        safetyFlag: "stream-error",
      }).catch(() => {});
    },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean

> Note: if `@/content/occupations/_index.json` import path differs in this repo, adjust to whatever Phase 4 actually uses (`content/occupations/*.json` per CLAUDE.md). If the catalog is stored as one file per occupation rather than an index, swap for the appropriate loader from `lib/matching` or `lib/db/occupations.ts`. Verify via `ls content/occupations` before relying on this import.

- [ ] **Step 3: Commit**

```bash
git add app/api/interview/route.ts
git commit -m "feat(api): /api/interview start + turn

Single route handles session start and per-turn streaming. Server
resolves target_role_he canonically (catalog or trimmed free-text).
Mode A/B preamble switches when question_count >= max_questions.
Forced-wrap escalation: repair call before templated fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `GET /api/interview/history` + `POST /api/interview/wrap`

**Files:**
- Create: `app/api/interview/history/route.ts`
- Create: `app/api/interview/wrap/route.ts`

- [ ] **Step 1: Write history route**

```ts
// app/api/interview/history/route.ts
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { listSessionsForUser } from "@/lib/db/interview";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);
  const sessions = await listSessionsForUser(userId, 5);
  return Response.json({ sessions });
}
```

- [ ] **Step 2: Write wrap route (user-triggered "I'm done")**

```ts
// app/api/interview/wrap/route.ts
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import {
  getInterviewSession,
  loadInterviewMessages,
  completeInterviewSession,
} from "@/lib/db/interview";
import { runWrapRepairCall } from "@/lib/interview/tools";
import { he } from "@/lib/i18n/he";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ sessionId: z.string().uuid() });

export async function POST(req: Request) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  const session = await getInterviewSession(parsed.sessionId);
  if (!session) return Response.json({ error: "session_not_found" }, { status: 404 });
  if (session.user_id !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
  if (session.completed_at) return Response.json({ ok: true, alreadyCompleted: true });

  if (session.question_count < 3) {
    return Response.json({ error: "too_early", retry_after_questions: 3 }, { status: 409 });
  }

  // User-triggered wrap → run repair call to build feedback from transcript.
  const history = await loadInterviewMessages(session.id);
  const transcript = history.map((m) => ({ role: m.role, content: m.content }));
  const repaired = await runWrapRepairCall(transcript, session.target_role_he);
  if (repaired) {
    await completeInterviewSession(session.id, { ...repaired, forcedWrap: false });
    return Response.json({ ok: true });
  }
  await completeInterviewSession(session.id, {
    summary_he: he.interview.fallback.modelFailedToWrap,
    strengths_he: ["—"],
    improvements_he: ["—"],
    next_practice_focus_he: "תרגל ראיון נוסף.",
    per_question: [],
    forcedWrap: true,
  });
  return Response.json({ ok: true, fallback: true });
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add app/api/interview/history/route.ts app/api/interview/wrap/route.ts
git commit -m "feat(api): /api/interview/history and /api/interview/wrap

History returns latest 5 sessions for the current user.
Wrap is the user-triggered 'I'm done' before the natural cap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `/interview` landing page + `InterviewLanding` composer

**Files:**
- Create: `app/(app)/interview/page.tsx`
- Create: `components/interview/InterviewLanding.tsx`

- [ ] **Step 1: Server page**

```tsx
// app/(app)/interview/page.tsx
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { listSessionsForUser } from "@/lib/db/interview";
import { getLatestRecommendation } from "@/lib/db/recommendations";
import { InterviewLanding } from "@/components/interview/InterviewLanding";

export const dynamic = "force-dynamic";

export default async function InterviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  const [history, latestRecs] = await Promise.all([
    listSessionsForUser(userId, 5),
    getLatestRecommendation(userId).catch(() => null),
  ]);

  const topRoles =
    latestRecs?.ranking
      ?.slice(0, 5)
      .map((r) => ({ id: r.occupation_id, name_he: r.name_he })) ?? [];

  return <InterviewLanding history={history} topRoles={topRoles} />;
}
```

> If `getLatestRecommendation` has a different name in `lib/db/recommendations.ts`, swap to whatever Phase 4 actually exposed. Verify before assuming. Same with the `ranking` shape — it may be `r.occupation.id`/`r.occupation.name_he` depending on the join.

- [ ] **Step 2: Client landing composer**

```tsx
// components/interview/InterviewLanding.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";
import { PERSONA_IDS, type PersonaId, type InterviewSession } from "@/lib/interview/types";
import { PersonaSelector } from "./PersonaSelector";
import { TargetRolePicker } from "./TargetRolePicker";
import { HistoryList } from "./HistoryList";

export function InterviewLanding({
  history,
  topRoles,
}: {
  history: InterviewSession[];
  topRoles: Array<{ id: string; name_he: string }>;
}) {
  const router = useRouter();
  const [persona, setPersona] = useState<PersonaId>("hr");
  const [targetOccupationId, setTargetOccupationId] = useState<string | null>(topRoles[0]?.id ?? null);
  const [targetFreeText, setTargetFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canStart =
    (targetOccupationId !== null || targetFreeText.trim().length > 0) && PERSONA_IDS.includes(persona);

  async function start() {
    if (!canStart) return;
    setBusy(true);
    setError(null);
    try {
      const body = targetOccupationId
        ? { action: "start", persona, target_occupation_id: targetOccupationId }
        : { action: "start", persona, target_role_he: targetFreeText.trim() };
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(he.interview.errors.startFailed);
        return;
      }
      const json = (await res.json()) as { sessionId: string };
      router.push(`/interview/${json.sessionId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{he.interview.landing.title}</h1>
        <p className="text-muted-foreground">{he.interview.landing.subtitle}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-medium">{he.interview.landing.personaSectionTitle}</h2>
        <PersonaSelector value={persona} onChange={setPersona} />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-medium">{he.interview.landing.targetSectionTitle}</h2>
        <TargetRolePicker
          topRoles={topRoles}
          occupationId={targetOccupationId}
          onSelectOccupation={(id) => {
            setTargetOccupationId(id);
            setTargetFreeText("");
          }}
          freeText={targetFreeText}
          onChangeFreeText={(t) => {
            setTargetFreeText(t);
            if (t.trim().length > 0) setTargetOccupationId(null);
          }}
        />
      </section>

      <div className="flex items-center justify-between">
        {error ? <span className="text-sm text-destructive">{error}</span> : <span />}
        <Button onClick={start} disabled={!canStart || busy}>
          {he.interview.landing.start}
        </Button>
      </div>

      <section className="space-y-3 border-t pt-6">
        <h2 className="text-base font-medium">{he.interview.landing.historyTitle}</h2>
        <HistoryList sessions={history} />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Commit (page + landing only — children come next)**

```bash
git add app/\(app\)/interview/page.tsx components/interview/InterviewLanding.tsx
git commit -m "feat(ui): /interview landing page

Composes PersonaSelector + TargetRolePicker + HistoryList. POSTs to
/api/interview start, routes to /interview/[sessionId] on success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: PersonaSelector + TargetRolePicker + HistoryList

**Files:**
- Create: `components/interview/PersonaSelector.tsx`
- Create: `components/interview/TargetRolePicker.tsx`
- Create: `components/interview/HistoryList.tsx`

- [ ] **Step 1: PersonaSelector**

```tsx
// components/interview/PersonaSelector.tsx
"use client";

import { he } from "@/lib/i18n/he";
import { PERSONA_IDS, type PersonaId } from "@/lib/interview/types";

export function PersonaSelector({
  value,
  onChange,
}: {
  value: PersonaId;
  onChange: (next: PersonaId) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {PERSONA_IDS.map((id) => {
        const selected = value === id;
        const persona = he.interview.persona[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={selected}
            className={`rounded-xl border p-4 text-right transition-shadow ${
              selected ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:shadow-sm"
            }`}
          >
            <div className="text-base font-semibold">{persona.label}</div>
            <div className="mt-1 text-xs text-muted-foreground">{persona.description}</div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: TargetRolePicker**

```tsx
// components/interview/TargetRolePicker.tsx
"use client";

import { useId } from "react";
import { he } from "@/lib/i18n/he";

export function TargetRolePicker({
  topRoles,
  occupationId,
  onSelectOccupation,
  freeText,
  onChangeFreeText,
}: {
  topRoles: Array<{ id: string; name_he: string }>;
  occupationId: string | null;
  onSelectOccupation: (id: string | null) => void;
  freeText: string;
  onChangeFreeText: (next: string) => void;
}) {
  const customId = useId();
  return (
    <div className="space-y-3">
      {topRoles.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{he.interview.landing.targetFromRecs}</label>
          <select
            value={occupationId ?? ""}
            onChange={(e) => onSelectOccupation(e.target.value || null)}
            className="w-full rounded-md border bg-background px-3 py-2"
          >
            <option value="">—</option>
            {topRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name_he}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={customId} className="mb-1 block text-xs text-muted-foreground">
          {he.interview.landing.targetCustom}
        </label>
        <input
          id={customId}
          type="text"
          value={freeText}
          onChange={(e) => onChangeFreeText(e.target.value)}
          placeholder="לדוגמה: ראש צוות פיתוח"
          maxLength={120}
          className="w-full rounded-md border bg-background px-3 py-2"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: HistoryList**

```tsx
// components/interview/HistoryList.tsx
"use client";

import Link from "next/link";
import { he } from "@/lib/i18n/he";
import type { InterviewSession } from "@/lib/interview/types";

export function HistoryList({ sessions }: { sessions: InterviewSession[] }) {
  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{he.interview.landing.historyEmpty}</p>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {sessions.map((s) => {
        const personaLabel = he.interview.persona[s.persona].label;
        const date = new Date(s.created_at).toLocaleDateString("he-IL", {
          day: "numeric",
          month: "short",
        });
        const status = s.completed_at ? "✓" : "…";
        return (
          <li key={s.id}>
            <Link
              href={`/interview/${s.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-accent"
            >
              <div>
                <div className="text-sm font-medium">{s.target_role_he}</div>
                <div className="text-xs text-muted-foreground">{personaLabel}</div>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{date}</span>
                <span aria-label={s.completed_at ? "completed" : "in-progress"}>{status}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/interview/PersonaSelector.tsx components/interview/TargetRolePicker.tsx components/interview/HistoryList.tsx
git commit -m "feat(ui): interview landing children

PersonaSelector: 3 selectable cards. TargetRolePicker: top-5 dropdown
+ free-text fallback. HistoryList: latest 5 sessions, completion
status, deep-link to session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: `/interview/[sessionId]` page (live or read-only)

**Files:**
- Create: `app/(app)/interview/[sessionId]/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/(app)/interview/[sessionId]/page.tsx
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getInterviewSession, loadInterviewMessages } from "@/lib/db/interview";
import { InterviewChat } from "@/components/interview/InterviewChat";
import { WrapUpScreen } from "@/components/interview/WrapUpScreen";

export const dynamic = "force-dynamic";

export default async function InterviewSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  const session = await getInterviewSession(sessionId);
  if (!session) notFound();
  if (session.user_id !== userId) redirect("/interview");

  const messages = await loadInterviewMessages(session.id);

  if (session.completed_at) {
    return (
      <div dir="rtl" className="mx-auto max-w-3xl space-y-6 p-6">
        <WrapUpScreen session={session} messages={messages} />
      </div>
    );
  }

  return <InterviewChat session={session} initialMessages={messages} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(app\)/interview/\[sessionId\]/page.tsx
git commit -m "feat(ui): /interview/[sessionId] page

Branches on completed_at: live chat for in-progress, WrapUpScreen
for completed (read-only transcript + feedback).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: InterviewChat + InterviewMessage + QuestionCounter

**Files:**
- Create: `components/interview/InterviewChat.tsx`
- Create: `components/interview/InterviewMessage.tsx`
- Create: `components/interview/QuestionCounter.tsx`

- [ ] **Step 1: QuestionCounter**

```tsx
// components/interview/QuestionCounter.tsx
"use client";

import { he } from "@/lib/i18n/he";

export function QuestionCounter({ current, total, wrappingUp }: { current: number; total: number; wrappingUp?: boolean }) {
  if (wrappingUp) return <span className="text-xs text-muted-foreground">{he.interview.counter.wrappingUp}</span>;
  return (
    <span className="text-xs text-muted-foreground">
      {he.interview.counter.label.replace("{current}", String(current)).replace("{total}", String(total))}
    </span>
  );
}
```

- [ ] **Step 2: InterviewMessage**

```tsx
// components/interview/InterviewMessage.tsx
"use client";

import { he } from "@/lib/i18n/he";

export function InterviewMessage({ role, content }: { role: "user" | "assistant" | "system"; content: string }) {
  if (role === "system") return null;
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
          isUser ? "bg-primary text-primary-foreground" : "bg-card border"
        }`}
      >
        <div className="mb-1 text-xs opacity-70">{isUser ? he.interview.chat.youSaid : he.interview.chat.interviewer}</div>
        <div dir="auto" className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: InterviewChat (composer + streaming)**

```tsx
// components/interview/InterviewChat.tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";
import type { InterviewSession, InterviewMessageRow } from "@/lib/interview/types";
import { InterviewMessage } from "./InterviewMessage";
import { QuestionCounter } from "./QuestionCounter";

const SENTINEL_START = "__start__";

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export function InterviewChat({
  session,
  initialMessages,
}: {
  session: InterviewSession;
  initialMessages: InterviewMessageRow[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>(
    initialMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [questionCount, setQuestionCount] = useState(session.question_count);
  const [wrappingUp, setWrappingUp] = useState(false);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (startedRef.current) return;
    if (initialMessages.length > 0) {
      startedRef.current = true;
      return;
    }
    startedRef.current = true;
    void send(SENTINEL_START);
  }, [initialMessages.length]);

  async function send(message: string) {
    setSending(true);
    if (message !== SENTINEL_START) {
      setMessages((m) => [...m, { role: "user", content: message }]);
    }
    setInput("");

    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "turn", sessionId: session.id, message }),
      });
      if (!res.ok || !res.body) {
        setMessages((m) => [...m, { role: "assistant", content: he.interview.errors.streamFailed }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      setMessages((m) => [...m, { role: "assistant", content: "", streaming: true }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === "text-delta" && typeof evt.delta === "string") {
              assistantText += evt.delta;
              setMessages((m) => {
                const next = [...m];
                next[next.length - 1] = { role: "assistant", content: assistantText, streaming: true };
                return next;
              });
            }
          } catch {
            // ignore non-json frames
          }
        }
      }

      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: "assistant", content: assistantText };
        return next;
      });

      // After turn finishes, the session row may have been completed (wrap_up
      // fired) — refresh.
      const updated = await fetch(`/api/interview/history`).then((r) => r.json());
      const fresh = (updated.sessions as InterviewSession[]).find((s) => s.id === session.id);
      if (fresh?.completed_at) {
        setWrappingUp(true);
        startTransition(() => router.refresh());
        return;
      }
      if (fresh) setQuestionCount(fresh.question_count);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    void send(text);
  }

  return (
    <div dir="rtl" className="mx-auto flex h-dvh max-w-3xl flex-col">
      <header className="flex items-center justify-between border-b p-4">
        <div>
          <div className="text-sm font-medium">{session.target_role_he}</div>
          <div className="text-xs text-muted-foreground">{he.interview.persona[session.persona].label}</div>
        </div>
        <QuestionCounter
          current={Math.min(questionCount + 1, session.max_questions)}
          total={session.max_questions}
          wrappingUp={wrappingUp}
        />
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <InterviewMessage key={i} role={m.role} content={m.content} />
        ))}
        <div ref={scrollRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t p-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={he.interview.chat.composerPlaceholder}
          disabled={sending || wrappingUp}
          className="flex-1 rounded-md border bg-background px-3 py-2"
        />
        <Button type="submit" disabled={sending || wrappingUp || input.trim().length === 0}>
          {he.interview.chat.send}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/interview/InterviewChat.tsx components/interview/InterviewMessage.tsx components/interview/QuestionCounter.tsx
git commit -m "feat(ui): InterviewChat live session view

Auto-fires SENTINEL_START on first mount when no history exists.
Streams text-delta frames into the latest assistant bubble.
Question counter updates from /api/interview/history poll after each
turn. Detects completed_at to flip into wrap state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: WrapUpScreen

**Files:**
- Create: `components/interview/WrapUpScreen.tsx`

- [ ] **Step 1: Write WrapUpScreen**

```tsx
// components/interview/WrapUpScreen.tsx
"use client";

import Link from "next/link";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";
import type { InterviewSession, InterviewMessageRow } from "@/lib/interview/types";
import { InterviewMessage } from "./InterviewMessage";

export function WrapUpScreen({
  session,
  messages,
}: {
  session: InterviewSession;
  messages: InterviewMessageRow[];
}) {
  const visible = messages.filter((m) => m.role === "user" || m.role === "assistant");
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{he.interview.wrap.heading}</h1>
        <p className="text-muted-foreground">
          {he.interview.persona[session.persona].label} · {session.target_role_he}
        </p>
        {session.forced_wrap && (
          <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {he.interview.wrap.forcedNote}
          </p>
        )}
      </header>

      {session.feedback_summary_he && (
        <section className="rounded-xl border bg-card p-5 text-base leading-relaxed">
          {session.feedback_summary_he}
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {session.feedback_strengths_he && session.feedback_strengths_he.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium">{he.interview.wrap.strengthsTitle}</h2>
            <ul className="space-y-1 text-sm">
              {session.feedback_strengths_he.map((s, i) => (
                <li key={i} className="list-disc list-inside">{s}</li>
              ))}
            </ul>
          </section>
        )}
        {session.feedback_improvements_he && session.feedback_improvements_he.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium">{he.interview.wrap.improvementsTitle}</h2>
            <ul className="space-y-1 text-sm">
              {session.feedback_improvements_he.map((s, i) => (
                <li key={i} className="list-disc list-inside">{s}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {session.feedback_next_practice_focus_he && (
        <section className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5">
          <h2 className="mb-1 text-sm font-medium">{he.interview.wrap.nextFocusTitle}</h2>
          <p className="text-base">{session.feedback_next_practice_focus_he}</p>
        </section>
      )}

      {session.feedback_per_question && session.feedback_per_question.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium">{he.interview.wrap.perQuestionTitle}</h2>
          <ol className="space-y-2 text-sm">
            {session.feedback_per_question.map((q) => (
              <li key={q.question_number} className="rounded-md bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">שאלה {q.question_number}</div>
                <div>{q.note_he}</div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <details className="rounded-lg border bg-muted/30 p-4">
        <summary className="cursor-pointer text-sm font-medium">תמליל</summary>
        <div className="mt-4 space-y-3">
          {visible.map((m) => (
            <InterviewMessage key={m.id} role={m.role as "user" | "assistant"} content={m.content} />
          ))}
        </div>
      </details>

      <div className="flex items-center justify-between pt-4">
        <Link href="/interview">
          <Button variant="ghost">{he.interview.wrap.doneCta}</Button>
        </Link>
        <Link href="/interview">
          <Button>{he.interview.wrap.restartCta}</Button>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add components/interview/WrapUpScreen.tsx
git commit -m "feat(ui): WrapUpScreen feedback view

Renders summary + strengths/improvements + next_practice_focus
highlight + per-question notes + collapsible transcript. Flags
forced_wrap sessions with a banner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Integration test + E2E script

**Files:**
- Create: `tests/integration/interview-flow.test.ts`
- Create: `scripts/e2e-test-interview.ts`

- [ ] **Step 1: Integration test (gated on ANTHROPIC_API_KEY)**

```ts
// tests/integration/interview-flow.test.ts
import { describe, it, expect } from "vitest";
import { composeTurnPreamble } from "@/lib/interview/prompt";

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!HAS_KEY)("interview flow (integration, requires ANTHROPIC_API_KEY)", () => {
  it("preamble mode switches at the cap", () => {
    expect(composeTurnPreamble({ questionCount: 7, maxQuestions: 8 })).toContain("שאלה 8 מתוך 8");
    expect(composeTurnPreamble({ questionCount: 8, maxQuestions: 8 })).toContain("wrap_up");
  });
  // The full streaming round-trip is exercised by scripts/e2e-test-interview.ts
  // which talks to a real DB + real Anthropic. Keeping unit-level tests here
  // and a manual e2e script avoids flaky CI integration runs.
});
```

- [ ] **Step 2: E2E script**

```ts
// scripts/e2e-test-interview.ts
/* eslint-disable no-console */
import "dotenv/config";
import { createInterviewSession, getInterviewSession, appendInterviewMessage } from "@/lib/db/interview";

const TARGET_USER_ID = process.env.E2E_USER_ID;
if (!TARGET_USER_ID) {
  console.error("Set E2E_USER_ID to a real users.id row in your local Supabase before running.");
  process.exit(1);
}

const SAMPLE_ANSWERS = [
  "עבדתי בצוות של 4 מתכנתים על מערכת ניטור. ניהלתי קונפליקט סביב בחירת בסיס נתונים על ידי כתיבת מסמך טרייד-אוף.",
  "אני לומד הכי טוב על ידי בנייה — קורא תיעוד תוך כדי כתיבת קוד, לא לפני.",
  "המוטיבציה שלי היא לבנות דברים שאנשים אמיתיים משתמשים בהם.",
  "סדרי עדיפויות אצלי הם לפי השפעה על המשתמש, לא לפי קושי טכני.",
  "טעות שעשיתי: דחפתי מיגרציה שגרמה לרגרסיה — למדתי לעשות בדיקות סטייג'ינג יותר עמוקות.",
  "אני מנהל זמן על ידי חלוקה ל-blocks של שעתיים, ללא פגישות בבוקר.",
  "הסגנון שלי הוא לכתוב קוד פשוט שיהיה קל לתחזק, גם אם זה אומר יותר שורות.",
  "האתגר הכי גדול שלי היה לבד על פרויקט שדרש 3 מומחים — ניהלתי על ידי learning loops קצרים.",
];

async function main() {
  const session = await createInterviewSession({
    userId: TARGET_USER_ID,
    persona: "hr",
    targetOccupationId: null,
    targetRoleHe: "מהנדס/ת תוכנה",
    maxQuestions: 8,
  });
  console.log(`[e2e] session ${session.id} created`);

  // Drive the route end-to-end via HTTP.
  const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  await fetch(`${base}/api/interview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "turn", sessionId: session.id, message: "__start__" }),
  });

  for (const answer of SAMPLE_ANSWERS) {
    const res = await fetch(`${base}/api/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "turn", sessionId: session.id, message: answer }),
    });
    // Consume the stream so onFinish fires server-side.
    const reader = res.body!.getReader();
    while ((await reader.read()).done === false) { /* drain */ }
    const fresh = await getInterviewSession(session.id);
    console.log(
      `[e2e] turn done: q_count=${fresh?.question_count} completed=${!!fresh?.completed_at} forced=${fresh?.forced_wrap}`,
    );
    if (fresh?.completed_at) break;
  }

  const final = await getInterviewSession(session.id);
  console.log("=== final state ===");
  console.log(JSON.stringify(final, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/interview-flow.test.ts scripts/e2e-test-interview.ts
git commit -m "test(interview): integration test scaffold + e2e script

Integration spec runs preamble mode-switch assertions in CI.
scripts/e2e-test-interview.ts drives the real /api/interview route
against a local stack (requires E2E_USER_ID + ANTHROPIC_API_KEY).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: CLAUDE.md architecture section + final verification + PR

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append Phase 6a architecture section**

Add this block to `CLAUDE.md` after the Phase 3b section (matching the style of 5a/5b/5c):

```markdown
## Phase 6a architecture (interview simulator)

A new `/interview` surface where a user picks a persona + target role and practices through a realistic Hebrew interview, with structured feedback at the end. Sits on a newly extracted shared LLM-turn helper (`lib/ai/engine.ts`) that also now powers `/chat`.

- **Shared engine** (`lib/ai/engine.ts`): `streamLlmTurn({ userText, systemMessage, history, tools?, onUserPersist, onAssistantFinish, ... })` runs the safety pre-check (or skips it via `skipSafetyCheck` for sentinel turns), short-circuits to an SSE safety fallback on hit, or runs `streamText` with persistence callbacks. Knows nothing about conversations/stages/sessions — callers own their domain. `/chat` and `/interview` both call it. The chat route lost ~80 lines in this refactor.
- **No stage machine, no profile extraction** in interview. The interview's job is *practice*, not assessment. The engine helper supports tool wiring; interview wires only `wrap_up`.
- **Mode A / Mode B preamble** (`lib/interview/prompt.ts`): `composeSystemPrompt` is per-session-stable (cached); `composeTurnPreamble` is per-turn. When `question_count >= max_questions` the preamble switches to a wrap instruction, so the model never sees "שאלה 9 מתוך 8". The function signatures enforce the cache rule by construction.
- **No interviewer names**: personas self-identify by role only. Removes a class of name-mismatch / bias issues. Personas: HR, Technical, First-job. Salary-negotiation is a structurally different flow (negotiation role-play) and lives in Phase 6a.5.
- **`wrap_up` tool**: same Anthropic tool-use pattern as `set_stage` from Phase 2. `makeWrapUpTool(sessionId, currentQuestionCount)` is constructed per turn; the timing guard in `execute()` rejects calls before question 5. Schema includes `next_practice_focus_he` so the user leaves with one actionable thing.
- **Forced-wrap escalation** when the model refuses to call `wrap_up` past `max_questions`: server runs a feedback-only `generateObject` repair call against the transcript (`runWrapRepairCall` in `lib/interview/tools.ts`). If THAT fails, fall back to a templated `feedback_summary_he`. `interview_sessions.forced_wrap` flags both paths for auditing.
- **Schema**: `interview_sessions` (persona, target_role_he, max_questions=8 default, completed_at, structured feedback columns including `feedback_next_practice_focus_he` and `forced_wrap`) + `interview_messages` (mirrors `messages`, FK'd to sessions). RLS allows SELECT for the owner via `users.auth_id = auth.uid()`. Inserts/updates via service role.
- **Target role resolution is server-side**: client sends `target_occupation_id` (catalog) OR `target_role_he` (free text), never both; server resolves the canonical Hebrew display name. Decouples the wire format from the catalog shape and lets free-text validation live in one place.
- **Resume model**: `/interview` always opens at the picker + history list (latest 5 sessions). An in-progress session is reachable by clicking its row; a completed session shows the WrapUpScreen. There's no auto-resume — each visit is a fresh decision.
- **Sentinel start**: the client posts `__start__` on first mount of an empty session so the model emits the first question without a user nudge. Safety pre-check is skipped specifically for `__start__`; the sentinel itself is never persisted.
```

- [ ] **Step 2: Run full verification**

Run all verifications in parallel:

```
npm run lint &&
npx tsc --noEmit &&
npm test &&
npm run build
```

Expected: all green.

- [ ] **Step 3: Apply migration to remote DB if not already**

Run: `npx supabase db push`
Expected: no diff or successful apply.

- [ ] **Step 4: Manual E2E in the browser**

1. Open `/interview` — picker + history list (empty if first run)
2. Select Technical persona, pick the top-1 role, start
3. Verify first question streams automatically
4. Answer 8 questions; verify `wrap_up` fires and WrapUpScreen renders with summary + strengths + improvements + next-practice-focus
5. Trigger a Hebrew distress phrase mid-interview, verify safety fallback persists and session continues
6. Close tab on question 4, revisit `/interview`, verify history shows the in-progress session, click it, verify transcript loads
7. Start a fresh session with free-text role ("ראש צוות"), verify session works without occupation skill injection
8. Try HR and First-job at least once each for vibe check

- [ ] **Step 5: Commit CLAUDE.md update + open PR**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): document Phase 6a architecture

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin HEAD

gh pr create --title "Phase 6a: interview simulator (3 personas, end-of-session feedback)" --body "$(cat <<'EOF'
## Summary

- Extracts \`lib/ai/engine.ts\` shared LLM-turn helper from \`/chat\`; \`/chat\` refactored to use it (no behavior change)
- New \`/interview\` surface: 3 personas (HR, Technical, First-job), pre-fill target role from top-1 recommendation or free-text fallback, end-of-session structured feedback via \`wrap_up\` tool
- Mode A/B preamble prevents off-by-one counter; forced-wrap escalation runs a feedback repair call before templated fallback

## Plan
\`docs/superpowers/plans/2026-05-13-career-os-06a-interview-sim.md\`

## Spec
\`docs/superpowers/specs/2026-05-13-career-os-06a-interview-sim-design.md\`

## Test plan
- [ ] \`npx vitest run\` all green
- [ ] \`npx tsc --noEmit\` clean
- [ ] \`npm run build\` clean
- [ ] Manual browser E2E per Task 18 step 4
- [ ] \`scripts/e2e-test-chat.ts stage\` still works (regression gate for the engine refactor)
- [ ] \`scripts/e2e-test-interview.ts\` completes a session with wrap_up

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Definition of Done (mirrors spec §12)

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

---

## Self-review notes (for the next person picking this up)

A few things to verify against the actual codebase before pushing — paths I inferred from the spec but didn't independently verify in this plan:

1. **Occupations catalog import path**: Task 10 references `@/content/occupations/_index.json`. The Phase 4 codebase may have one JSON per occupation rather than an index. Check `content/occupations/*.json` shape and adjust the loader. The pattern shown (`occupationsCatalog.occupations.find(...)`) assumes an index file; if it's per-file, use `lib/db/occupations.ts` or whatever Phase 4 exposes for loading.
2. **`getCachedSystemMessage` signature**: Task 10 passes the composed system prompt *text* to `getCachedSystemMessage`. The chat route passes a `Stage` enum. Check `lib/ai/client.ts` — if `getCachedSystemMessage` only accepts a Stage, add an overload that accepts a raw string, or build the `SystemModelMessage` inline with `providerOptions.anthropic.cacheControl: { type: "ephemeral" }`.
3. **`getLatestRecommendation` shape**: Task 12 server page reads `latestRecs.ranking[i].occupation_id` and `.name_he`. Adjust to the actual return shape from `lib/db/recommendations.ts`.
4. **AI SDK types**: `StopCondition` / `ToolSet` may need different import paths in AI SDK v6 — `ai` package exports change between minor versions. If type errors appear, check `node_modules/ai/dist/index.d.ts` or the install version in `package.json`.
5. **`Occupation` type import in Task 10**: I imported from `@/lib/matching/types`. If matching uses a different module name, adjust accordingly.

None of these change the architecture — they're just import-path nits that depend on what Phase 4/5 actually shipped. Verify before writing implementation code.
