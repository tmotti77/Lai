import type { Ranking, Occupation, Paths } from "./types";

export function pickPaths(rankings: Ranking[], occupations: Occupation[]): Paths {
  const occMap = new Map(occupations.map((o) => [o.id, o]));
  const used = new Set<string>();

  const findRank = (predicate: (r: Ranking, occ: Occupation) => boolean): string | null => {
    for (const r of rankings) {
      if (used.has(r.occupation_id)) continue;
      const occ = occMap.get(r.occupation_id);
      if (!occ) continue;
      if (predicate(r, occ)) {
        used.add(r.occupation_id);
        return r.occupation_id;
      }
    }
    return null;
  };

  const safe = findRank((r, occ) =>
    (r.breakdown.constraints ?? 0) >= 75 &&
    occ.constraints.typical_training_months <= 6 &&
    (occ.market.demand_he === "high" || occ.market.demand_he === "very_high"),
  );

  const growth = findRank((r, occ) =>
    (r.breakdown.interests ?? 0) >= 70 &&
    occ.constraints.typical_training_months >= 6 &&
    occ.constraints.typical_training_months <= 18 &&
    (occ.market.demand_he === "medium" || occ.market.demand_he === "high" || occ.market.demand_he === "very_high"),
  );

  const wildcard = findRank((r) =>
    r.total_score >= 60,
  );

  return { safe, growth, wildcard };
}
