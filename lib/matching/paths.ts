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

  // Safe path: high constraints fit + short training + high demand + reasonable overall match.
  // total_score ≥ 70 prevents occupations that only match on constraints (e.g., PM for a hands-on profile).
  const safe = findRank((r, occ) =>
    (r.breakdown.constraints ?? 0) >= 70 &&
    occ.constraints.typical_training_months <= 12 &&
    (occ.market.demand_he === "high" || occ.market.demand_he === "very_high") &&
    r.total_score >= 70,
  );

  // Growth path: prefer interest-driven (≥65) when interests exists, 
  // fall back to total_score (≥70) when interests is null (chat+CV profile).
  // Requires 6-24 month training + medium+ demand.
  const growth = findRank((r, occ) => {
    const interestScore = r.breakdown.interests;
    const meetsInterestThreshold = interestScore !== null 
      ? interestScore >= 65 
      : r.total_score >= 70; // fallback for chat+CV profiles without RIASEC
    
    return meetsInterestThreshold &&
      occ.constraints.typical_training_months >= 6 &&
      occ.constraints.typical_training_months <= 24 &&
      (occ.market.demand_he === "medium" || occ.market.demand_he === "high" || occ.market.demand_he === "very_high");
  });

  const wildcard = findRank((r) =>
    r.total_score >= 60,
  );

  return { safe, growth, wildcard };
}
