import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidStage, type Stage } from "@/lib/ai/stages";

const ACTIVE_CONVERSATION_COOKIE = "co_conv";

export const runtime = "nodejs";
export const maxDuration = 5;

/**
 * Returns the current stage of the active conversation.
 * Called by ChatShell after each turn to detect stage transitions.
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const conversationId = cookieStore.get(ACTIVE_CONVERSATION_COOKIE)?.value;
    if (!conversationId) {
      return Response.json({ stage: "onboarding" });
    }

    const svc = createServiceClient();
    const { data } = await svc
      .from("conversations")
      .select("stage")
      .eq("id", conversationId)
      .maybeSingle();

    const stage: Stage = data?.stage && isValidStage(data.stage) ? data.stage : "onboarding";
    return Response.json({ stage });
  } catch {
    return Response.json({ stage: "onboarding" });
  }
}
