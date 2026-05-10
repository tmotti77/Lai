import { cookies } from "next/headers";
import { streamText, stepCountIs, type UIMessage, type ModelMessage } from "ai";
import {
  anthropic,
  MODEL_ID,
  getCachedSystemMessage,
  extractAnthropicCacheUsage,
} from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getOrCreateConversation, appendMessage, loadMessages } from "@/lib/db/queries";
import { isValidStage, EXTRACTION_STAGES, type Stage } from "@/lib/ai/stages";
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
      // Persist user msg + safety-handoff assistant msg, both flagged.
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
  const currentStage: Stage = isValidStage(conversation.stage) ? conversation.stage : "onboarding";

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
    // Allow up to 2 steps so Claude can call set_stage AND optionally add a closing
    // text after the tool result. Default of 1 step would stop the stream right after
    // the tool call with no follow-up text.
    stopWhen: stepCountIs(2),
    experimental_onToolCallStart: async ({ toolCall }) => {
      console.log("[chat] tool call start", {
        conversationId: conversation.id,
        toolName: toolCall.toolName,
        stage: currentStage,
      });
    },
    experimental_onToolCallFinish: async ({ toolCall }) => {
      console.log("[chat] tool call finish", {
        conversationId: conversation.id,
        toolName: toolCall.toolName,
        stage: currentStage,
      });
    },
    onFinish: async ({ text, usage, providerMetadata }) => {
      const cache = extractAnthropicCacheUsage(usage, providerMetadata);

      console.log("[chat] turn finished", {
        conversationId: conversation.id,
        stage: currentStage,
        advancedTo: advancedToStage ?? "(no advance)",
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
      // Extract for the stage that JUST ENDED, not the new one.
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
