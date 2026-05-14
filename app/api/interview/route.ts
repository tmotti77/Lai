import "server-only";
import type { ModelMessage, SystemModelMessage } from "ai";
import { stepCountIs } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { streamLlmTurn } from "@/lib/ai/engine";
import { composeSystemPrompt, composeTurnPreamble } from "@/lib/interview/prompt";
import { makeWrapUpTool, runWrapRepairCall } from "@/lib/interview/tools";
import {
  createInterviewSession,
  getInterviewSession,
  loadInterviewMessages,
  appendInterviewMessage,
  incrementQuestionCount,
  completeInterviewSession,
} from "@/lib/db/interview";
import { loadAllOccupations } from "@/lib/db/occupations";
import { PERSONA_IDS } from "@/lib/interview/types";
import type { Occupation } from "@/lib/matching/types";
import taxonomy from "@/content/skills/taxonomy.json";
import { he } from "@/lib/i18n/he";

export const runtime = "nodejs";
export const maxDuration = 60;

const SENTINEL_START = "__start__";

const TAXONOMY_NAME_BY_ID = new Map<string, string>(
  (taxonomy as { skills: { id: string; name_he: string }[] }).skills.map((s) => [s.id, s.name_he]),
);

const StartSchema = z.object({
  action: z.literal("start"),
  persona: z.enum(PERSONA_IDS),
  target_occupation_id: z.string().min(1).optional(),
  target_role_he: z.string().min(1).max(120).optional(),
});

const TurnSchema = z.object({
  action: z.literal("turn"),
  sessionId: z.uuid(),
  message: z.string().min(1).max(8000),
});

const BodySchema = z.union([StartSchema, TurnSchema]);

async function lookupOccupation(id: string): Promise<Occupation | null> {
  const all = await loadAllOccupations();
  return all.find((o) => o.id === id) ?? null;
}

function resolveSkillNames(occ: Occupation | null): string[] | null {
  if (!occ) return null;
  const names = (occ.required_skills ?? [])
    .map((rs) => TAXONOMY_NAME_BY_ID.get(rs.skill_id) ?? rs.skill_id)
    .filter(Boolean);
  return names.length > 0 ? names : null;
}

export async function POST(req: Request): Promise<Response> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return Response.json({ error: "bad_request", detail: String(err) }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
      const occ = await lookupOccupation(body.target_occupation_id);
      if (!occ) return Response.json({ error: "unknown_occupation" }, { status: 400 });
      targetOccupationId = occ.id;
      targetRoleHe = occ.title_he;
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
  if (session.completed_at) {
    return Response.json({ error: "session_already_completed" }, { status: 409 });
  }

  // Compose per-session-stable system message with Anthropic prompt caching.
  // getCachedSystemMessage only accepts Stage, so we construct SystemModelMessage directly.
  const occupation = session.target_occupation_id
    ? await lookupOccupation(session.target_occupation_id)
    : null;
  const occupationSkills = resolveSkillNames(occupation);
  const systemPromptText = composeSystemPrompt({
    persona: session.persona,
    targetRoleHe: session.target_role_he,
    occupationSkills,
  });
  const systemMessage: SystemModelMessage = {
    role: "system",
    content: systemPromptText,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };

  // Load conversation history.
  const history = await loadInterviewMessages(session.id);
  const historyAsModelMessages: ModelMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Per-turn preamble: Mode A (progress counter) or Mode B (wrap-up instruction).
  const preamble = composeTurnPreamble({
    questionCount: session.question_count,
    maxQuestions: session.max_questions,
  });

  // Sentinel handling: auto-emitted first question uses a special token.
  const isSentinel = body.message === SENTINEL_START;
  const userTextForLlm = isSentinel ? "" : body.message;
  const userTextForPersist = isSentinel ? null : body.message;

  // Build the user message the LLM sees (preamble + actual text, or just preamble for sentinel).
  const llmUserMessage: ModelMessage = {
    role: "user",
    content: userTextForPersist ? `${preamble}\n\n${userTextForPersist}` : preamble,
  };

  const wrapTool = makeWrapUpTool(session.id, session.question_count);

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
      // Did wrap_up fire? Re-read session: tool's execute sets completed_at.
      const fresh = await getInterviewSession(session.id);
      const wrapToolFired = !!fresh?.completed_at;

      // Persist assistant turn (may be near-empty if tool fired without producing text).
      await appendInterviewMessage({
        sessionId: session.id,
        role: "assistant",
        content: args.text,
        safetyFlag: args.safetyFlag,
        cacheReadTokens: args.cacheReadTokens,
        cacheWriteTokens: args.cacheWriteTokens,
      });

      // Count this turn as a "question" only if wrap didn't fire and no safety fallback.
      if (!wrapToolFired && !args.safetyFlag) {
        await incrementQuestionCount(session.id);
      }

      // ESCALATION: if at/past max_questions and wrap_up still didn't fire,
      // attempt a repair call against the full transcript; fall back to templated if that fails.
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
