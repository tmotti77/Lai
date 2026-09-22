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
  let safe = findRank((r, occ) =>
    (r.breakdown.constraints ?? 0) >= 70 &&
    occ.constraints.typical_training_months <= 12 &&
    (occ.market.demand_he === "high" || occ.market.demand_he === "very_high") &&
    r.total_score >= 70,
  );

  // Growth path: highest remaining score ≥60.
  // Soft preference for 3-36 month training + medium+ demand, but ALWAYS fill if any unused ≥60 exists.
  let growth = findRank((r, occ) =>
    r.total_score >= 60 &&
    occ.constraints.typical_training_months >= 3 &&
    occ.constraints.typical_training_months <= 36 &&
    (occ.market.demand_he === "medium" || occ.market.demand_he === "high" || occ.market.demand_he === "very_high"),
  );
  
  // Explicit guarantee: if preferred criteria found nothing, take ANY unused ≥60
  if (growth === null) {
    growth = findRank((r) => r.total_score >= 60);
  }

  // Wildcard path: next highest remaining score ≥60
  let wildcard = findRank((r) => r.total_score >= 60);

  // Final fallbacks: fill any remaining null slot with the best unused ranking, no score floor.
  // `findRank` walks `rankings` in descending-score order and marks each pick used, so these
  // three calls yield distinct occupations, best-first. An empty path card is worse for the
  // user than a weak-but-honest one.
  //
  // Deliberately NOT title-based. An earlier revision preferred "hands-on trades" by regex
  // matching occ.title_he, which silently demoted the two highest-scoring matches: for the
  // 2026-09-17 production case it returned hvac(52)/electrician(49)/security-installer(48)
  // and skipped paramedic(58) and plumber(56), whose Hebrew titles did not match. Ranking
  // order is the source of truth.
  if (safe === null) safe = findRank(() => true);
  if (growth === null) growth = findRank(() => true);
  if (wildcard === null) wildcard = findRank(() => true);

  return { safe, growth, wildcard };
}
