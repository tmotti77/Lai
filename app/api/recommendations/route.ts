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

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
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
    const [profileRaw, occupations, catalogVersion] = await Promise.all([
      getMostRecentConversationProfile(internalUserId),
      loadAllOccupations(),
      loadCatalogVersion(),
    ]);

    const profile = buildMatchingProfile(profileRaw as Parameters<typeof buildMatchingProfile>[0]);
    const hash = profileHash(profile, catalogVersion);

    const cached = await getCached(internalUserId, hash);
    if (cached) {
      return Response.json({
        rankings: cached.rankings,
        paths: cached.paths,
        prose: cached.prose,
        cached: true,
        generated_at: cached.generatedAt,
      });
    }

    const rankings = rankOccupations(profile, occupations);
    const paths = pickPaths(rankings, occupations);

    let prose: Record<string, string> = {};
    if (rankings.length > 0) {
      prose = await generateExplanations({
        profile, rankings, occupations, topN: 5,
      });
    }

    await saveRecommendation({
      userId: internalUserId,
      profileHash: hash,
      rankings: rankings.slice(0, 10),
      paths,
      prose,
    });

    return Response.json({
      rankings: rankings.slice(0, 10),
      paths,
      prose,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[recommendations] error", { message });
    return Response.json({ error: "recommendations_failed", message }, { status: 500 });
  }
}

async function getMostRecentConversationProfile(userId: string) {
  const svc = createServiceClient();
  const { data: convs } = await svc
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const conversationId = convs?.[0]?.id;
  if (!conversationId) {
    const { data: cp } = await svc
      .from("career_profile")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const formal = await getProfile(userId, "00000000-0000-0000-0000-000000000000")
      .catch(() => null);
    type ProfileWithFormal = { formal?: { riasec: unknown; big5: unknown; values: unknown; constraints: unknown } | null };
    const formalData = (formal as ProfileWithFormal | null)?.formal ?? null;
    return cp ? { ...cp, formal: formalData } : { formal: formalData };
  }
  return getProfile(userId, conversationId);
}
