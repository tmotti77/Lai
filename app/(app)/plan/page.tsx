import { he } from "@/lib/i18n/he";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getNpsEligibility } from "@/lib/db/nps";
import { PlanClient } from "@/components/plan/PlanClient";
import { NpsPrompt } from "@/components/feedback/NpsPrompt";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  const eligibility = await getNpsEligibility(userId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {eligibility.show && eligibility.trigger && (
        <NpsPrompt trigger={eligibility.trigger} />
      )}
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{he.plan.title}</h1>
        <p className="text-base text-muted-foreground">{he.plan.subtitle}</p>
      </header>
      <PlanClient />
    </div>
  );
}
