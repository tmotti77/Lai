import type { MatchingProfile, Occupation } from "../types";

const ENGLISH_LEVELS = ["none", "basic", "intermediate", "advanced", "fluent"] as const;

/**
 * Penalty-based: start at 100 and subtract for each constraint violation.
 * Returns null when user has no constraints. Bounded 0..100.
 */
export function scoreConstraints(profile: MatchingProfile, occupation: Occupation): number | null {
  if (!profile.constraints) return null;
  const c = profile.constraints;
  const oc = occupation.constraints;

  let penalty = 0;

  if (c.location_he && oc.typical_locations.length > 0) {
    const locationFits = oc.typical_locations.includes(c.location_he);
    const bothRemote = c.remote_ok === true && oc.remote_ok === true;
    if (!locationFits && !bothRemote) penalty += 35;
  }

  if (c.training_budget_nis !== undefined && oc.typical_training_cost_nis > c.training_budget_nis) {
    const overspend = oc.typical_training_cost_nis - c.training_budget_nis;
    const ratio = overspend / Math.max(1, c.training_budget_nis);
    if (ratio > 0.5) penalty += 35;
    else if (ratio > 0) penalty += 18;
  }

  if (c.english_level) {
    const userIdx = ENGLISH_LEVELS.indexOf(c.english_level);
    const reqIdx = ENGLISH_LEVELS.indexOf(oc.requires_english_level);
    if (reqIdx > userIdx) penalty += 20 * (reqIdx - userIdx);
  }

  if (c.needs_immediate_income && c.months_until_income_required !== undefined) {
    const slack = c.months_until_income_required - oc.typical_training_months;
    if (slack < 0) {
      const monthsOver = -slack;
      penalty += Math.min(70, monthsOver * 7);
    }
  }

  const score = Math.max(0, 100 - penalty);
  return Math.round(score);
}
