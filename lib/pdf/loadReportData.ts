import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { loadAllOccupations } from "@/lib/db/occupations";
import { getProfile } from "@/lib/db/profile";
import { buildMatchingProfile } from "@/lib/matching/profile";
import type { ReportData } from "./types";
import type { Ranking, Paths } from "@/lib/matching/types";

export async function loadReportData(userId: string): Promise<ReportData | null> {
  const svc = createServiceClient();

  const [recResult, occupations, userResult] = await Promise.all([
    svc
      .from("recommendations")
      .select("rankings, paths, prose, generated_at")
      .eq("user_id", userId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadAllOccupations(),
    svc
      .from("users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  const rec = recResult.data;
  if (!rec) return null;

  // Re-derive the profile from the user's most-recent conversation, to mirror
  // what the cached recommendation was actually computed against.
  const { data: convs } = await svc
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const conversationId = convs?.[0]?.id;
  let rawProfile: Awaited<ReturnType<typeof getProfile>> | null = null;
  if (conversationId) {
    rawProfile = await getProfile(userId, conversationId).catch(() => null);
  }
  type RawProfileParam = Parameters<typeof buildMatchingProfile>[0];
  const profile = buildMatchingProfile(rawProfile as RawProfileParam);

  const profileSummaryHe =
    rawProfile && typeof rawProfile === "object" && "data" in rawProfile
      ? ((rawProfile.data as { summary_he?: string } | null)?.summary_he ?? null)
      : null;

  return {
    generatedAt: rec.generated_at,
    userDisplayName: userResult.data?.display_name ?? null,
    profile,
    profileSummaryHe,
    rankings: rec.rankings as unknown as Ranking[],
    paths: rec.paths as unknown as Paths,
    prose: rec.prose as unknown as Record<string, string>,
    occupations,
  };
}
