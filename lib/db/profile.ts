import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Stage } from "@/lib/ai/stages";

export async function updateConversationStage(
  conversationId: string,
  stage: Stage,
): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc
    .from("conversations")
    .update({ stage })
    .eq("id", conversationId);
  if (error) throw new Error(`updateConversationStage: ${error.message}`);
}

export async function mergeProfileExtraction(opts: {
  userId: string;
  conversationId: string;
  stage: Stage;
  data: Record<string, unknown>;
}): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc.rpc("merge_career_profile", {
    p_user_id: opts.userId,
    p_conversation_id: opts.conversationId,
    p_stage: opts.stage,
    p_data: opts.data as never,
  });
  if (error) throw new Error(`mergeProfileExtraction: ${error.message}`);
}

export async function getProfile(userId: string, conversationId: string) {
  const svc = createServiceClient();
  const { data } = await svc
    .from("career_profile")
    .select("*")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  return data;
}
