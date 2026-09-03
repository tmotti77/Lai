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
import { requireConsent, NoConsentError } from "@/lib/consent";
import { track } from "@/lib/analytics";
import { ensureRecommendationsLink } from "@/lib/ai/ensure-wrap-link";

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

  try {
    await requireConsent(internalUserId);
  } catch (e) {
    if (e instanceof NoConsentError) {
      return Response.json({ error: "no_consent" }, { status: 403 });
    }
    throw e;
  }

  const conversation = await getOrCreateConversation(internalUserId, incomingConversationId);
  const wasFirstMessage = conversation.message_count === 0;

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
    // Anthropic rejects requests where any message has empty text content
    // ("messages: text content blocks must be non-empty"). This happens when a
    // tool-only assistant turn (e.g. Claude calling set_stage with no surrounding
    // prose) gets persisted as content="". Skip empties on history replay.
    .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Append the current user turn so the LLM sees it. The engine persists via
  // onUserPersist AFTER loadMessages, so without this, streamText only sees
  // prior history — Claude would answer to stale context.
  const messagesForLlm: ModelMessage[] = userText
    ? [...historyAsModelMessages, { role: "user", content: userText }]
    : historyAsModelMessages;

  const setCookie = `${ACTIVE_CONVERSATION_COOKIE}=${conversation.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ACTIVE_CONVERSATION_MAX_AGE_SECONDS}${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;

  if (wasFirstMessage) {
    track("conversation_started", { surface: "chat" });
  }

  return streamLlmTurn({
    userText,
    systemMessage: getCachedSystemMessage(currentStage),
    history: messagesForLlm,
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
      // Tool-only turns (e.g. Claude calling set_stage with no prose) leave
      // args.text empty. Persisting that and replaying it as history poisons
      // future turns because Anthropic rejects empty text content blocks.
      // Skip the persist when there's nothing to say.
      if (args.text && args.text.trim().length > 0) {
        // When advancing to complete, ensure the message has a clickable link
        // to /recommendations. The model sometimes emits bare paths (e.g., "פנה ל- /recommendations")
        // which MessageBubble can't detect as links. This guarantees a proper markdown link exists.
        let finalText = args.text;
        if (advancedToStage === "complete") {
          finalText = ensureRecommendationsLink(args.text);
        }

        await appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: finalText,
          inputTokens: args.inputTokens,
          outputTokens: args.outputTokens,
          cacheReadTokens: args.cacheReadTokens,
          cacheWriteTokens: args.cacheWriteTokens,
          safetyFlag: args.safetyFlag,
        });
      }

      // Run extraction BEFORE the stream returns so the profile is ready when
      // the user navigates to /recommendations. Prior async fire-and-forget
      // caused a race where the page loaded before extraction completed.
      if (advancedToStage && EXTRACTION_STAGES.has(currentStage)) {
        const stageJustCompleted = currentStage;
        try {
          await runExtraction({
            userId: internalUserId,
            conversationId: conversation.id,
            stage: stageJustCompleted,
          });
          console.log(`[chat] extraction done conv=${conversation.id} stage=${stageJustCompleted}`);
        } catch (err) {
          // Log but don't block the response — extraction failure shouldn't
          // prevent the user from continuing, though recommendations may be incomplete.
          console.error(
            `[chat] extraction failed conv=${conversation.id} stage=${stageJustCompleted} error=${err instanceof Error ? err.message : String(err)}`,
          );
        }
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
