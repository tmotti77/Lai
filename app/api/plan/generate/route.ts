import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { loadAllOccupations } from "@/lib/db/occupations";
import { selectArchetype } from "@/lib/plan/selectArchetype";
import { composePlan } from "@/lib/plan/compose";
import { createPlan } from "@/lib/db/plans";
import { getProfile } from "@/lib/db/profile";
import { buildMatchingProfile } from "@/lib/matching/profile";
import type { Ranking, Paths } from "@/lib/matching/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const internalUserId = await getOrCreateAnonymousUserId(user?.id);

    const svc = createServiceClient();
    const { data: rec } = await svc
      .from("recommendations")
      .select("id, rankings, paths")
      .eq("user_id", internalUserId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!rec) {
      return Response.json({ error: "no_recommendation" }, { status: 400 });
    }

    const rankings = rec.rankings as unknown as Ranking[];
    const paths = rec.paths as unknown as Paths;
    const archetype = selectArchetype(paths);
    if (!archetype) {
      return Response.json({ error: "no_path_available" }, { status: 400 });
    }

    // Top occupation = the one matching the chosen archetype's path slot,
    // not necessarily the highest-ranked overall.
    const targetSlotId =
      archetype === "apply" ? paths.safe :
      archetype === "taste_test" ? paths.growth :
      paths.wildcard;
    const topRanking = rankings.find((r) => r.occupation_id === targetSlotId) ?? rankings[0];
    if (!topRanking) {
      return Response.json({ error: "no_ranking" }, { status: 400 });
    }

    const occupations = await loadAllOccupations();
    const topOccupation = occupations.find((o) => o.id === topRanking.occupation_id);
    if (!topOccupation) {
      return Response.json({ error: "occupation_not_found" }, { status: 400 });
    }

    // Load profile for personalization (mirrors loadReportData)
    const { data: convs } = await svc
      .from("conversations")
      .select("id")
      .eq("user_id", internalUserId)
      .order("updated_at", { ascending: false })
      .limit(1);
    const conversationId = convs?.[0]?.id;
    let rawProfile = null as Awaited<ReturnType<typeof getProfile>> | null;
    if (conversationId) {
      rawProfile = await getProfile(internalUserId, conversationId).catch(() => null);
    }
    type RawProfileParam = Parameters<typeof buildMatchingProfile>[0];
    const profile = buildMatchingProfile(rawProfile as RawProfileParam);

    // Look up the prose for the top role from the recommendation
    const { data: recProse } = await svc
      .from("recommendations")
      .select("prose")
      .eq("id", rec.id)
      .single();
    const proseMap = (recProse?.prose as unknown as Record<string, string> | null) ?? null;
    const topProse = proseMap?.[topOccupation.id] ?? null;

    const tasks = await composePlan({
      archetype,
      topOccupation,
      topRanking,
      topProse,
      profile,
    });

    const plan = await createPlan({
      userId: internalUserId,
      recommendationId: rec.id,
      archetype,
      tasks,
    });

    return Response.json(plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[plan/generate] error", { message });
    return Response.json({ error: "generate_failed", message }, { status: 500 });
  }
}
