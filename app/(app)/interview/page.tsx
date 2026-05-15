import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { listSessionsForUser } from "@/lib/db/interview";
import { getLatestRecommendationForUser } from "@/lib/db/recommendations";
import { loadAllOccupations } from "@/lib/db/occupations";
import { InterviewLanding } from "@/components/interview/InterviewLanding";

export const dynamic = "force-dynamic";

export default async function InterviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  const [history, latestRecs] = await Promise.all([
    listSessionsForUser(userId, 5),
    getLatestRecommendationForUser(userId).catch(() => null),
  ]);

  // Resolve top-5 occupation_ids → Hebrew titles via the occupations catalog.
  let topRoles: Array<{ id: string; name_he: string }> = [];
  if (latestRecs && latestRecs.rankings.length > 0) {
    const allOccs = await loadAllOccupations();
    const occById = new Map(allOccs.map((o) => [o.id, o]));
    topRoles = latestRecs.rankings.slice(0, 5).flatMap((r) => {
      const occ = occById.get(r.occupation_id);
      return occ ? [{ id: occ.id, name_he: occ.title_he }] : [];
    });
  }

  return <InterviewLanding history={history} topRoles={topRoles} />;
}
