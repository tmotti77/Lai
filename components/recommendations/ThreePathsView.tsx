import { he } from "@/lib/i18n/he";
import { PathCard } from "./PathCard";
import type { Ranking, Occupation, Paths } from "@/lib/matching/types";

export function ThreePathsView({
  rankings,
  paths,
  occupations,
  prose,
}: {
  rankings: Ranking[];
  paths: Paths;
  occupations: Occupation[];
  prose: Record<string, string>;
}) {
  const occMap = new Map(occupations.map((o) => [o.id, o]));
  const rankMap = new Map(rankings.map((r) => [r.occupation_id, r]));
  const labels = he.recommendations.pathLabels;
  const descriptions = he.recommendations.pathDescriptions;

  const slots: { key: "safe" | "growth" | "wildcard"; id: string | null }[] = [
    { key: "safe", id: paths.safe },
    { key: "growth", id: paths.growth },
    { key: "wildcard", id: paths.wildcard },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {slots.map(({ key, id }) => {
        if (!id) {
          return (
            <div key={key} className="rounded-xl border border-dashed bg-muted/20 p-5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels[key]}</div>
              <p className="mt-3 text-sm text-muted-foreground">{he.recommendations.noPathOption}</p>
            </div>
          );
        }
        const ranking = rankMap.get(id);
        const occupation = occMap.get(id);
        if (!ranking || !occupation) return null;
        return (
          <PathCard
            key={key}
            pathLabel={labels[key]}
            pathDescription={descriptions[key]}
            ranking={ranking}
            occupation={occupation}
            prose={prose[id]}
          />
        );
      })}
    </div>
  );
}
