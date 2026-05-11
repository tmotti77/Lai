import { he } from "@/lib/i18n/he";
import { loadAllOccupations } from "@/lib/db/occupations";
import { RecommendationsClient } from "@/components/recommendations/RecommendationsClient";

export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  const occupations = await loadAllOccupations();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{he.recommendations.title}</h1>
        <p className="text-base text-muted-foreground">{he.recommendations.subtitle}</p>
      </header>
      <RecommendationsClient occupations={occupations} />
    </div>
  );
}
