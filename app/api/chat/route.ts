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
