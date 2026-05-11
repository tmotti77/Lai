import type { MatchingProfile, Occupation } from "../types";

const REQUIRED_WEIGHT = 0.7;
const DESIRED_WEIGHT = 0.3;

/**
 * Match user's skills (with `level` 0..1) against occupation's required +
 * desired skills (with `importance` 0..1). User skills can be referenced by
 * canonical id OR free-form Hebrew/English label — we fuzzy-match labels via
 * lowercase substring containment, which handles "JavaScript / TypeScript" →
 * matches occupation skill_id "javascript".
 *
 * Returns 0..100. Null when profile has no skills.
 */
export function scoreSkills(profile: MatchingProfile, occupation: Occupation): number | null {
  if (!profile.skills || profile.skills.length === 0) return null;

  const userSkills = profile.skills.map((s) => ({
    id: s.id.toLowerCase().trim(),
    level: s.level,
  }));

  const requiredScore = matchSet(userSkills, occupation.required_skills);
  const desiredScore = matchSet(userSkills, occupation.desired_skills);

  const reqMax = sumImportance(occupation.required_skills);
  const desMax = sumImportance(occupation.desired_skills);

  const reqRatio = reqMax > 0 ? requiredScore / reqMax : 0;
  const desRatio = desMax > 0 ? desiredScore / desMax : 0;

  const hasDesired = occupation.desired_skills.length > 0;
  const totalWeight = hasDesired ? REQUIRED_WEIGHT + DESIRED_WEIGHT : REQUIRED_WEIGHT;
  const reqShare = REQUIRED_WEIGHT / totalWeight;
  const desShare = hasDesired ? DESIRED_WEIGHT / totalWeight : 0;

  const combined = reqRatio * reqShare + desRatio * desShare;
  return Math.round(combined * 100);
}

function sumImportance(set: { importance: number }[]): number {
  return set.reduce((acc, s) => acc + s.importance, 0);
}

function matchSet(
  userSkills: { id: string; level: number }[],
  occSkills: { skill_id: string; importance: number }[],
): number {
  let total = 0;
  for (const occSkill of occSkills) {
    const id = occSkill.skill_id.toLowerCase();
    const match = userSkills.find(
      (u) =>
        u.id === id ||
        u.id.includes(id) ||
        id.includes(u.id),
    );
    if (match) total += occSkill.importance * match.level;
  }
  return total;
}
