import type { DimensionName } from "./types";

// Master roadmap §9: 25/20/15/15/15/10. Sum = 100.
export const WEIGHTS: Record<DimensionName, number> = {
  interests: 25,
  skills: 20,
  values: 15,
  big5: 15,
  constraints: 15,
  market: 10,
};

export const DIMENSIONS: DimensionName[] = [
  "interests", "skills", "values", "big5", "constraints", "market",
];
