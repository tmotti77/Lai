import type { MatchingProfile, Occupation } from "../types";

const RANK_WEIGHTS = [3, 2, 1];
const ALSO_WEIGHT = 0.5;
const MAX_POSSIBLE_TOP3 = 3 + 2 + 1;

export function scoreValues(profile: MatchingProfile, occupation: Occupation): number | null {
  if (!profile.values) return null;

  const fitSet = new Set(occupation.values_fit);
  let achieved = 0;

  for (let i = 0; i < profile.values.topThree.length && i < 3; i++) {
    const valId = profile.values.topThree[i];
    if (fitSet.has(valId)) achieved += RANK_WEIGHTS[i];
  }
  for (const valId of profile.values.alsoPicked) {
    if (fitSet.has(valId)) achieved += ALSO_WEIGHT;
  }

  const score = Math.min(100, Math.round((achieved / MAX_POSSIBLE_TOP3) * 100));
  return score;
}
