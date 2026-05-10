import { WEIGHTS, DIMENSIONS } from "./weights";
import type {
  MatchingProfile,
  Occupation,
  Ranking,
  ScoreBreakdown,
  DimensionName,
} from "./types";
import { scoreInterests } from "./score/interests";
import { scoreSkills } from "./score/skills";
import { scoreValues } from "./score/values";
import { scoreBig5 } from "./score/big5";
import { scoreConstraints } from "./score/constraints";
import { scoreMarket } from "./score/market";

export function rankOccupations(
  profile: MatchingProfile,
  occupations: Occupation[],
): Ranking[] {
  return occupations
    .map((occ) => scoreOne(profile, occ))
    .sort((a, b) => b.total_score - a.total_score);
}

function scoreOne(profile: MatchingProfile, occupation: Occupation): Ranking {
  const breakdown: ScoreBreakdown = {
    interests: scoreInterests(profile, occupation),
    skills: scoreSkills(profile, occupation),
    values: scoreValues(profile, occupation),
    big5: scoreBig5(profile, occupation),
    constraints: scoreConstraints(profile, occupation),
    market: scoreMarket(occupation),
  };

  const present = DIMENSIONS.filter((d) => breakdown[d] !== null);
  const totalWeight = present.reduce((acc, d) => acc + WEIGHTS[d], 0);

  const weights_used: Partial<Record<DimensionName, number>> = {};
  for (const d of present) {
    weights_used[d] = (WEIGHTS[d] / totalWeight) * 100;
  }

  let total = 0;
  for (const d of present) {
    total += (breakdown[d] as number) * (weights_used[d] as number) / 100;
  }

  return {
    occupation_id: occupation.id,
    total_score: Math.round(total),
    breakdown,
    weights_used,
  };
}
