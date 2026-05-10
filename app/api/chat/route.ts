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

export const runtime = "nodejs";
export const maxDuration = 60;

const ACTIVE_CONVERSATION_COOKIE = "co_conv";
const ACTIVE_CONVERSATION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    conversationId?: string;
  };

  // Resolve the active conversation. Priority:
  //   1. Explicit conversationId in body (future "resume specific chat" feature)
  //   2. co_conv cookie (continues the user's active chat across requests)
  //   3. Otherwise, getOrCreateConversation creates a fresh one
  // Without (2), useChat (which doesn't auto-include conversationId in body)
  // would create a brand-new conversation per turn — Claude would see only the
  // current user message and respond as if it's the first turn every time.
  const cookieStore = await cookies();
  const cookieConversationId = cookieStore.get(ACTIVE_CONVERSATION_COOKIE)?.value;
  const incomingConversationId = body.conversationId ?? cookieConversationId;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);
  const conversation = await getOrCreateConversation(internalUserId, incomingConversationId);

  // Persist the new user message that just arrived from the client.
  const lastUserMessage = body.messages[body.messages.length - 1];
  if (lastUserMessage?.role === "user") {
    const text = lastUserMessage.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("");
    if (text) {
      await appendMessage({
        conversationId: conversation.id,
        role: "user",
        content: text,
      });
    }
  }

  // Load full history from DB (single source of truth) and build ModelMessages.
  // We do NOT use convertToModelMessages here because we're constructing model
  // messages directly from persisted plain-text rows, not from UIMessage parts.
  const history = await loadMessages(conversation.id);
  const historyAsModelMessages: ModelMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // TODO(Phase 2 Task 13): pass conversation.stage instead of hardcoded onboarding
  const messages: ModelMessage[] = [
    getCachedSystemMessage("onboarding"),
    ...historyAsModelMessages,
  ];

  const result = streamText({
    model: anthropic(MODEL_ID),
    messages,
    onFinish: async ({ text, usage, providerMetadata }) => {
      const cache = extractAnthropicCacheUsage(providerMetadata);
      await appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: text,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: cache.cacheReadInputTokens,
        cacheWriteTokens: cache.cacheCreationInputTokens,
      });
    },
    onError: async ({ error }) => {
      // Log to server logs and persist a system row so the conversation has a record
      // of the failure. This prevents the half-streamed-then-silent-close UX where the
      // client's `useChat` shows an error but the DB has no trace of what went wrong.
      const message = error instanceof Error ? error.message : String(error);
      console.error("[chat] streamText error", { conversationId: conversation.id, error: message });
      await appendMessage({
        conversationId: conversation.id,
        role: "system",
        content: `[stream-error] ${message}`,
        safetyFlag: "stream-error",
      }).catch((err) => {
        console.error("[chat] failed to persist error row", err);
      });
    },
  });

  // Set/refresh the cookie so subsequent turns land in the same conversation.
  // We send it on every response (not just on creation) so the Max-Age slides forward
  // as long as the user keeps chatting. SameSite=Lax is enough for first-party use.
  const setCookie = `${ACTIVE_CONVERSATION_COOKIE}=${conversation.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ACTIVE_CONVERSATION_MAX_AGE_SECONDS}${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;

  return result.toUIMessageStreamResponse({
    headers: {
      "x-conversation-id": conversation.id,
      "Set-Cookie": setCookie,
    },
  });
}
