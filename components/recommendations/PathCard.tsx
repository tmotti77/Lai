import { he } from "@/lib/i18n/he";
import { ScoreBreakdown } from "./ScoreBreakdown";
import type { Ranking, Occupation } from "@/lib/matching/types";

export function PathCard({
  pathLabel,
  pathDescription,
  ranking,
  occupation,
  prose,
}: {
  pathLabel: string;
  pathDescription: string;
  ranking: Ranking;
  occupation: Occupation;
  prose?: string;
}) {
  const market = he.recommendations.market;
  const demandLabels = he.recommendations.demandLabels;
  const aiRiskLabels = he.recommendations.aiRiskLabels;
  const trainingMonths = occupation.constraints.typical_training_months;

  return (
    <article className="flex h-full flex-col gap-4 rounded-xl border bg-card p-5">
      <header className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wide text-primary">{pathLabel}</div>
        <p className="text-xs text-muted-foreground">{pathDescription}</p>
      </header>
      <div>
        <h3 className="text-xl font-semibold">{occupation.title_he}</h3>
        <p className="mt-1 text-sm text-muted-foreground" dir="auto">{occupation.description_he}</p>
      </div>
      {prose && (
        <p className="rounded-md bg-primary/5 p-3 text-sm leading-relaxed" dir="auto">{prose}</p>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{market.demand}</dt>
          <dd>{demandLabels[occupation.market.demand_he]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{market.salary}</dt>
          <dd dir="ltr">
            ₪{occupation.market.typical_salary_nis_min.toLocaleString()}–{occupation.market.typical_salary_nis_max.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{market.training}</dt>
          <dd>{trainingMonths === 0 ? market.noTraining : `${trainingMonths} ${market.months}`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{market.ai_risk}</dt>
          <dd>{aiRiskLabels[occupation.market.ai_risk]}</dd>
        </div>
      </dl>
      <ScoreBreakdown breakdown={ranking.breakdown} />
    </article>
  );
}
