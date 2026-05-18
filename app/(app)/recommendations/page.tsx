import { he } from "@/lib/i18n/he";
import { loadAllOccupations } from "@/lib/db/occupations";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getNpsEligibility } from "@/lib/db/nps";
import { RecommendationsClient } from "@/components/recommendations/RecommendationsClient";
import { NpsPrompt } from "@/components/feedback/NpsPrompt";

export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  const [occupations, eligibility] = await Promise.all([
    loadAllOccupations(),
    getNpsEligibility(userId),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {eligibility.show && eligibility.trigger && (
        <NpsPrompt trigger={eligibility.trigger} />
      )}
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{he.recommendations.title}</h1>
        <p className="text-base text-muted-foreground">{he.recommendations.subtitle}</p>
      </header>
      <RecommendationsClient occupations={occupations} />
    </div>
  );
}
