import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Stage } from "@/lib/ai/stages";
import { getLatestByType } from "./assessments";
import { mergeProfileRows, type ProfileRow } from "@/lib/matching/profile-rows";

// Matches supabase/config.toml's api.max_rows, which PostgREST enforces on
// every unbounded select regardless of whether .limit() is called.
const PROFILE_PAGE_SIZE = 1000;

// Sanity cap: no real user should have 10k+ career_profile rows. Guards
// against an infinite loop if pagination ever misbehaves (e.g. a bad range
// or a server that never reports a short final page).
const PROFILE_PAGE_CAP = 10;

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
  const formal = await getLatestByType(userId);
  return data ? { ...data, formal } : { formal };
}

/**
 * Loads ALL of a user's career_profile rows (paginated — PostgREST caps any
 * unbounded select at max_rows regardless of .limit()), the user's latest
 * conversation id, and formal assessments, then merges the rows via
 * lib/matching/profile-rows.ts. See docs/plans/61-profile-loader-all-rows.md.
 */
export async function loadMergedProfile(userId: string) {
  const svc = createServiceClient();

  const [latestConversationId, rows, formal] = await Promise.all([
    loadLatestConversationId(svc, userId),
    loadAllProfileRows(svc, userId),
    // Silent swallow mirrors the previous (single-row) loader's behavior:
    // a formal-assessment read failure degrades to formal: null rather than
    // failing the whole profile load.
    getLatestByType(userId).catch(() => null),
  ]);

  const merged = mergeProfileRows(rows, latestConversationId);
  return merged ? { ...merged, formal } : { formal };
}

async function loadLatestConversationId(
  svc: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await svc
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw new Error(`loadMergedProfile: ${error.message}`);
  return data?.[0]?.id ?? null;
}

async function loadAllProfileRows(
  svc: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<ProfileRow[]> {
  const rows: ProfileRow[] = [];
  let offset = 0;
  for (let page = 0; ; page++) {
    if (page >= PROFILE_PAGE_CAP) {
      throw new Error(
        `loadMergedProfile: exceeded PROFILE_PAGE_CAP (${PROFILE_PAGE_CAP}) pages ` +
          `for user ${userId}; refusing to keep paginating`,
      );
    }
    const { data, error } = await svc
      .from("career_profile")
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(offset, offset + PROFILE_PAGE_SIZE - 1);
    if (error) throw new Error(`loadMergedProfile: ${error.message}`);
    const rowsPage = data ?? [];
    rows.push(...(rowsPage as unknown as ProfileRow[]));
    if (rowsPage.length < PROFILE_PAGE_SIZE) break;
    offset += PROFILE_PAGE_SIZE;
  }
  return rows;
}
