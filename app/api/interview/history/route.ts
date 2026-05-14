import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { listSessionsForUser } from "@/lib/db/interview";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);
  const sessions = await listSessionsForUser(userId, 5);
  return Response.json({ sessions });
}
