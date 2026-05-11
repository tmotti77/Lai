import type { Occupation } from "../types";

const DEMAND_SCORES = { low: 30, medium: 60, high: 85, very_high: 100 } as const;
const AI_RISK_PENALTY = { low: 0, medium: 15, high: 35 } as const;

/**
 * Pure function of the occupation's market data. Doesn't depend on profile.
 * Subtractive penalty from AI risk against demand baseline.
 */
export function scoreMarket(occupation: Occupation): number {
  const demand = DEMAND_SCORES[occupation.market.demand_he];
  const aiPenalty = AI_RISK_PENALTY[occupation.market.ai_risk];
  return Math.max(0, Math.min(100, Math.round(demand - aiPenalty)));
}
