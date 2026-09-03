import { ChatShell } from "@/components/chat/ChatShell";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { loadMessages } from "@/lib/db/queries";
import { isValidStage, type Stage } from "@/lib/ai/stages";
import type { UIMessage } from "ai";

export const dynamic = "force-dynamic";

const ACTIVE_CONVERSATION_COOKIE = "co_conv";

/**
 * Server-side preload of the active conversation's messages so a page refresh
 * doesn't wipe the chat history from the UI. The conversation itself is
 * persisted across refreshes via the co_conv cookie + DB; this just hydrates
 * the AI SDK's local message state on initial render.
 *
 * Resolution order:
 *   1. Read co_conv cookie for the active conversation_id
 *   2. Verify the conversation belongs to this anonymous/authed user
 *   3. Load all persisted messages and map to AI SDK UIMessage shape
 *
 * If any step fails, we return [] and the chat starts fresh — defensive
 * fallback that never blocks the chat from rendering.
 */
async function loadInitialMessages(): Promise<{ messages: UIMessage[]; stage: Stage }> {
  try {
    const cookieStore = await cookies();
    const conversationId = cookieStore.get(ACTIVE_CONVERSATION_COOKIE)?.value;
    if (!conversationId) return { messages: [], stage: "onboarding" };

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const internalUserId = await getOrCreateAnonymousUserId(user?.id);

    // Verify ownership before exposing messages: a stale or stolen co_conv
    // cookie shouldn't surface another user's conversation.
    const svc = createServiceClient();
    const { data: conv } = await svc
      .from("conversations")
      .select("id, stage")
      .eq("id", conversationId)
      .eq("user_id", internalUserId)
      .maybeSingle();
    if (!conv) return { messages: [], stage: "onboarding" };

    const stage: Stage = conv.stage && isValidStage(conv.stage) ? conv.stage : "onboarding";

    const rows = await loadMessages(conversationId);
    const messages = rows
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0)
      .map((m, idx): UIMessage => ({
        id: `loaded-${idx}`,
        role: m.role as "user" | "assistant",
        parts: [{ type: "text", text: m.content }],
      }));
    
    return { messages, stage };
  } catch {
    return { messages: [], stage: "onboarding" };
  }
}

export default async function ChatPage() {
  const { messages, stage } = await loadInitialMessages();
  return <ChatShell initialMessages={messages} initialStage={stage} />;
}
