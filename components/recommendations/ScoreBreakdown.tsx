import { he } from "@/lib/i18n/he";
import type { ScoreBreakdown as Breakdown } from "@/lib/matching/types";

const ROW_ORDER: (keyof Breakdown)[] = ["interests", "skills", "values", "big5", "constraints", "market"];

export function ScoreBreakdown({ breakdown }: { breakdown: Breakdown }) {
  const labels = he.recommendations.breakdown.labels;
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{he.recommendations.breakdown.title}</div>
      <ul className="space-y-1.5">
        {ROW_ORDER.map((key) => {
          const v = breakdown[key];
          return (
            <li key={key} className="flex items-center gap-3">
              <div className="w-24 shrink-0 text-sm">{labels[key]}</div>
              {v === null ? (
                <span className="text-xs text-muted-foreground">{he.recommendations.breakdown.missing}</span>
              ) : (
                <>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${v}%` }} />
                  </div>
                  <div className="w-10 text-end text-xs tabular-nums" dir="ltr">{v}</div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
