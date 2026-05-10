import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export async function getOrCreateConversation(userId: string, conversationId?: string) {
  const svc = createServiceClient();
  if (conversationId) {
    const { data } = await svc
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return data;
  }
  const { data, error } = await svc
    .from("conversations")
    .insert({ user_id: userId })
    .select()
    .single();
  if (error || !data) throw new Error(`Conversation create failed: ${error?.message}`);
  return data;
}

export async function loadMessages(conversationId: string) {
  const svc = createServiceClient();
  const { data } = await svc
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function appendMessage(opts: {
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  safetyFlag?: string;
}) {
  const svc = createServiceClient();
  await svc.from("messages").insert({
    conversation_id: opts.conversationId,
    role: opts.role,
    content: opts.content,
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    cache_read_tokens: opts.cacheReadTokens,
    cache_write_tokens: opts.cacheWriteTokens,
    safety_flag: opts.safetyFlag,
  });
  await svc.rpc("increment_conversation_counters", {
    p_conversation_id: opts.conversationId,
    p_input_tokens: opts.inputTokens ?? 0,
    p_output_tokens: opts.outputTokens ?? 0,
  });
}
