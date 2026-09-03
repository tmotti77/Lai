import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getProfile } from "@/lib/db/profile";
import { loadAllOccupations, loadCatalogVersion } from "@/lib/db/occupations";
import { getCached, saveRecommendation } from "@/lib/db/recommendations";
import { buildMatchingProfile } from "@/lib/matching/profile";
import { rankOccupations } from "@/lib/matching/engine";
import { pickPaths } from "@/lib/matching/paths";
import { profileHash } from "@/lib/matching/hash";
import { generateExplanations } from "@/lib/ai/prompts/explanations";
import { createServiceClient } from "@/lib/supabase/service";
import { requireConsent, NoConsentError } from "@/lib/consent";
import { track } from "@/lib/analytics";

async function loadThumbsForRecommendation(
  svc: ReturnType<typeof createServiceClient>,
  userId: string,
  recommendationId: string,
): Promise<Record<string, -1 | 1>> {
  const { data } = await svc
    .from("feedback")
    .select("target_id, thumbs_value")
    .eq("user_id", userId)
    .eq("surface", "recommendations")
    .eq("target_type", "recommendation_occupation")
    .like("target_id", `${recommendationId}:%`)
    .not("thumbs_value", "is", null);
  return Object.fromEntries(
    (data ?? [])
      .filter((r) => r.thumbs_value === 1 || r.thumbs_value === -1)
      .map((r) => [r.target_id, r.thumbs_value as -1 | 1])
  );
}

function dimensionCount(weightsUsed: Partial<Record<string, number>>): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return Object.keys(weightsUsed).length as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);

  try {
    await requireConsent(internalUserId);
  } catch (e) {
    if (e instanceof NoConsentError) {
      return Response.json({ error: "no_consent" }, { status: 403 });
    }
    throw e;
  }

  try {
    // Read optional force flag from body. Empty/missing body is fine.
    let body: { force?: boolean } = {};
    try {
      if (request.headers.get("content-type")?.includes("application/json")) {
        body = (await request.json().catch(() => ({}))) as { force?: boolean };
      }
    } catch {
      // ignore body parse failures — treat as no body
    }
    const force = body.force === true;

    const [profileRaw, occupations, catalogVersion] = await Promise.all([
      getMostRecentConversationProfile(internalUserId),
      loadAllOccupations(),
      loadCatalogVersion(),
    ]);

    const profile = buildMatchingProfile(profileRaw as Parameters<typeof buildMatchingProfile>[0]);
    const hash = profileHash(profile, catalogVersion);

    if (!force) {
      const cached = await getCached(internalUserId, hash);
      if (cached) {
        const svc = createServiceClient();
        const thumbs = await loadThumbsForRecommendation(svc, internalUserId, cached.id);
        track("recommendations_generated", {
          cache_hit: true,
          dimension_count: dimensionCount(cached.rankings[0]?.weights_used ?? {}),
        });
        return Response.json({
          rankings: cached.rankings,
          paths: cached.paths,
          prose: cached.prose,
          cached: true,
          generated_at: cached.generatedAt,
          recommendation_id: cached.id,
          thumbs,
        });
      }
    }

    const rankings = rankOccupations(profile, occupations);
    const paths = pickPaths(rankings, occupations);

    let prose: Record<string, string> = {};
    if (rankings.length > 0) {
      prose = await generateExplanations({
        profile, rankings, occupations, topN: 5,
      });
    }

    // Force regenerate: delete old recommendations for this user before inserting new one
    if (force) {
      const svc = createServiceClient();
      await svc
        .from("recommendations")
        .delete()
        .eq("user_id", internalUserId);
    }

    await saveRecommendation({
      userId: internalUserId,
      profileHash: hash,
      rankings: rankings.slice(0, 10),
      paths,
      prose,
    });

    const svc = createServiceClient();
    const { data: recRow } = await svc
      .from("recommendations")
      .select("id, generated_at")
      .eq("user_id", internalUserId)
      .eq("profile_hash", hash)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single();

    const recommendationId = recRow!.id;
    const generatedAt = recRow!.generated_at;
    // Fresh recommendations have no thumbs yet
    const thumbs: Record<string, -1 | 1> = {};

    track("recommendations_generated", {
      cache_hit: false,
      dimension_count: dimensionCount(rankings[0]?.weights_used ?? {}),
    });

    return Response.json({
      rankings: rankings.slice(0, 10),
      paths,
      prose,
      cached: false,
      generated_at: generatedAt,
      recommendation_id: recommendationId,
      thumbs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[recommendations] error", { message });
    return Response.json({ error: "recommendations_failed", message }, { status: 500 });
  }
}

/**
 * Loads and merges profile data from BOTH conversation-linked AND orphan (conversation_id=NULL) rows.
 * 
 * **Why this merge is needed:**
 * Anonymous users often have CV skills stored in a `career_profile` row with `conversation_id = NULL`,
 * while chat-extracted interests/values/constraints live in a conversation-linked row.
 * The old code only read the conversation-linked row, so CV skills were invisible to matching.
 * 
 * **Merge strategy:**
 * - Union skills from both rows
 * - Prefer non-null interests/values/constraints from conversation-linked row (chat is authoritative)
 * - If only orphan row exists, use it fully
 * - Return formal assessments from any existing submission
 */
async function getMostRecentConversationProfile(userId: string) {
  const svc = createServiceClient();
  
  // Load latest conversation to check if conversation-linked profile exists
  const { data: convs } = await svc
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const conversationId = convs?.[0]?.id;

  // Load formal assessments (always user-level, no conversation filter)
  const formal = await getProfile(userId, "00000000-0000-0000-0000-000000000000")
    .catch(() => null);
  type ProfileWithFormal = { formal?: { riasec: unknown; big5: unknown; values: unknown; constraints: unknown } | null };
  const formalData = (formal as ProfileWithFormal | null)?.formal ?? null;

  if (!conversationId) {
    // No conversation → use latest profile row by updated_at (includes NULL conversation_id)
    const { data: cp } = await svc
      .from("career_profile")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return cp ? { ...cp, formal: formalData } : { formal: formalData };
  }

  // Load BOTH conversation-linked profile AND latest user-level profile
  const [conversationProfile, userProfile] = await Promise.all([
    svc
      .from("career_profile")
      .select("*")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .maybeSingle()
      .then(({ data }) => data),
    svc
      .from("career_profile")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => data),
  ]);

  // If both are the same row, no merge needed
  if (conversationProfile && userProfile && conversationProfile.id === userProfile.id) {
    return { ...conversationProfile, formal: formalData };
  }

  // Merge strategy: union skills, prefer non-null chat fields from conversation profile
  type ProfileData = {
    skills?: Array<{ id: string; name_he: string; source?: string; evidence?: string }>;
    interests?: unknown;
    values?: unknown;
    constraints?: unknown;
    [key: string]: unknown;
  };

  const convData = (conversationProfile?.data ?? {}) as ProfileData;
  const userLevelData = (userProfile?.data ?? {}) as ProfileData;

  // Union skills from both sources (dedupe by id)
  const allSkills = [
    ...(convData.skills ?? []),
    ...(userLevelData.skills ?? []),
  ];
  const skillMap = new Map(allSkills.map((s) => [s.id, s]));
  const mergedSkills = Array.from(skillMap.values());

  const mergedData: ProfileData = {
    ...userLevelData,
    ...convData,
    skills: mergedSkills.length > 0 ? mergedSkills : undefined,
    // Prefer non-null chat-extracted fields from conversation profile
    interests: convData.interests ?? userLevelData.interests,
    values: convData.values ?? userLevelData.values,
    constraints: convData.constraints ?? userLevelData.constraints,
  };

  // Return shape matching getProfile return type
  if (conversationProfile) {
    return {
      ...conversationProfile,
      data: mergedData,
      formal: formalData,
    };
  }

  if (userProfile) {
    return {
      ...userProfile,
      data: mergedData,
      formal: formalData,
    };
  }

  return { formal: formalData };
}
