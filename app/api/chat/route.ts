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

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    conversationId?: string;
  };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);
  const conversation = await getOrCreateConversation(internalUserId, body.conversationId);

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

  const messages: ModelMessage[] = [
    getCachedSystemMessage(),
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

  return result.toUIMessageStreamResponse({
    headers: { "x-conversation-id": conversation.id },
  });
}
